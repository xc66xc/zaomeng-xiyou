import Foundation
import CryptoKit
import zlib

struct PatchRecipe: Decodable {
    struct Operation: Decodable {
        let offset: Int?
        let length: Int?
        let add: String?
    }
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

    func apply(_ input: Data) throws -> Data {
        let source = try Self.unpack(input)
        if Self.hash(source) == resultHash { return source }
        guard Self.hash(source) == sourceHash, resultSize > 0, resultSize <= 32_000_000 else { throw Self.invalid() }
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

    static func invalid() -> NSError {
        NSError(domain: "ZMXY", code: 2, userInfo: [NSLocalizedDescriptionKey: "游戏文件版本或校验不符，请使用 V47.8 官方原始 SWF。"])
    }
}
