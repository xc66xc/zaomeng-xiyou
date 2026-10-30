import Foundation
import CryptoKit
import zlib

struct PatchRecipe: Decodable {
    struct Operation: Decodable {
        let offset: Int?
        let length: Int?
        let add: String?
    }
    // One embedded DefineBinaryData transformation, deliberately not recursive.
    struct EmbeddedPatch: Decodable {
        let binaryID: Int
        let sourceHash: String
        let resultHash: String
        let resultSize: Int
        let operations: [Operation]
    }
    let embedded: EmbeddedPatch?
    let sourceHash: String
    let resultHash: String
    let resultSize: Int
    let operations: [Operation]

    static func hash(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func unpack(_ data: Data) throws -> Data {
        guard data.count >= 8 else { throw invalid() }
        let count = (0..<4).reduce(0) { $0 | Int(data[4 + $1]) << (8 * $1) }
        guard count >= 8, count <= 32_000_000 else { throw invalid() }
        if data.prefix(3) == Data("FWS".utf8) {
            guard count == data.count else { throw invalid() }
            return data
        }
        if data.prefix(3) == Data("ZWS".utf8) {
            guard data.count > 17 else { throw invalid() }
            var body = [UInt8](repeating: 0, count: count - 8)
            let code = data.withUnsafeBytes { input in
                zmxy_decode_lzma(input.bindMemory(to: UInt8.self).baseAddress!.advanced(by: 12),
                    input.bindMemory(to: UInt8.self).baseAddress!.advanced(by: 17), data.count - 17,
                    &body, body.count)
            }
            guard code == 0 else { throw invalid() }
            return Data("FWS".utf8) + data[3..<8] + Data(body)
        }
        guard data.prefix(3) == Data("CWS".utf8) else { throw invalid() }
        var body = [UInt8](repeating: 0, count: count - 8)
        var length = uLongf(body.count)
        let code = data.dropFirst(8).withUnsafeBytes { input in
            uncompress(&body, &length, input.bindMemory(to: UInt8.self).baseAddress!, uLong(input.count))
        }
        guard code == Z_OK, length == count - 8 else { throw invalid() }
        return Data("FWS".utf8) + data[3..<8] + Data(body)
    }

    private static func applyOperations(_ source: Data, sourceHash: String, resultHash: String,
                                        resultSize: Int, operations: [Operation]) throws -> Data {
        guard resultSize >= 8, resultSize <= 32_000_000,
              Self.hash(source) == sourceHash else { throw Self.invalid() }
        var result = Data()
        result.reserveCapacity(resultSize)
        for op in operations {
            if let text = op.add, op.offset == nil, op.length == nil,
               let bytes = Data(base64Encoded: text), bytes.count <= resultSize - result.count {
                result.append(bytes)
            } else if op.add == nil, let offset = op.offset, let length = op.length,
                      offset >= 0, offset <= source.count, length >= 0,
                      length <= source.count - offset, length <= resultSize - result.count {
                result.append(source[offset..<(offset + length)])
            } else { throw Self.invalid() }
        }
        guard result.count == resultSize, Self.hash(result) == resultHash else { throw Self.invalid() }
        return result
    }

    private static func word(_ source: Data, at offset: Int, bytes: Int) throws -> Int {
        guard offset >= 0, bytes <= source.count - offset else { throw invalid() }
        return (0..<bytes).reduce(0) { $0 | Int(source[offset + $1]) << (8 * $1) }
    }

    private static func littleEndian(_ number: Int, bytes: Int) -> Data {
        Data((0..<bytes).map { UInt8((number >> (8 * $0)) & 255) })
    }

    private func applyEmbedded(_ source: Data, _ patch: EmbeddedPatch) throws -> Data {
        guard source.count >= 13, operations.isEmpty, (0...65535).contains(patch.binaryID) else {
            throw Self.invalid()
        }
        // SWF RECT begins with a five-bit coordinate width, followed by four coordinates.
        let rectLength = (5 + 4 * Int(source[8] >> 3) + 7) / 8
        var cursor = 8 + rectLength + 4
        var selected: (start: Int, payload: Int, end: Int)?
        while cursor < source.count {
            let start = cursor
            let header = try Self.word(source, at: cursor, bytes: 2)
            cursor += 2
            let code = header >> 6
            var length = header & 63
            if length == 63 {
                length = try Self.word(source, at: cursor, bytes: 4)
                cursor += 4
            }
            guard cursor <= source.count, length <= source.count - cursor else { throw Self.invalid() }
            if code == 87 {
                guard length >= 6 else { throw Self.invalid() }
                if try Self.word(source, at: cursor, bytes: 2) == patch.binaryID {
                    guard selected == nil, length >= 14 else { throw Self.invalid() }
                    selected = (start, cursor, cursor + length)
                }
            }
            cursor += length
            if code == 0 { break }
        }
        guard let tag = selected else { throw Self.invalid() }
        let inner = try Self.unpack(Data(source[(tag.payload + 6)..<tag.end]))
        let changed = try Self.applyOperations(inner, sourceHash: patch.sourceHash,
            resultHash: patch.resultHash, resultSize: patch.resultSize, operations: patch.operations)
        let payloadSize = 6 + changed.count
        guard source.count - (tag.end - tag.start) + 6 + payloadSize == resultSize else {
            throw Self.invalid()
        }
        var result = Data()
        result.reserveCapacity(resultSize)
        result.append(source[..<tag.start])
        result.append(Self.littleEndian((87 << 6) | 63, bytes: 2))
        result.append(Self.littleEndian(payloadSize, bytes: 4))
        result.append(source[tag.payload..<(tag.payload + 6)])
        result.append(changed)
        result.append(source[tag.end...])
        result.replaceSubrange(4..<8, with: Self.littleEndian(result.count, bytes: 4))
        guard result.count == resultSize, Self.hash(result) == resultHash else { throw Self.invalid() }
        return result
    }

    func apply(_ input: Data) throws -> Data {
        let source = try Self.unpack(input)
        guard resultSize >= 8, resultSize <= 32_000_000 else { throw Self.invalid() }
        if Self.hash(source) == resultHash {
            guard source.count == resultSize else { throw Self.invalid() }
            return source
        }
        guard Self.hash(source) == sourceHash else { throw Self.invalid() }
        if let patch = embedded { return try applyEmbedded(source, patch) }
        return try Self.applyOperations(source, sourceHash: sourceHash, resultHash: resultHash,
            resultSize: resultSize, operations: operations)
    }

    static func invalid() -> NSError {
        NSError(domain: "ZMXY", code: 2, userInfo: [NSLocalizedDescriptionKey: "游戏文件版本或校验不符，请使用所选章节支持的官方原始 SWF。"])
    }
}
