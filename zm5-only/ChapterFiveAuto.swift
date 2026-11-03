import Foundation
import Darwin

// Discovery and transformation run on a worker queue, never in the damage path.
final class ChapterFiveAuto {
    static let engineVersion = "1"
    static let protocolName = "zm5-attack-1.2"
    static let base = "https://sda.4399.com/4399swf/upload_swf/ftp22/csya/20170622/1/"
    static let topic = URL(string: "https://www.4399.com/flash/zmhj.htm")!
    static let maximumSize = 32_000_000
    typealias Fetch = (URL, URL?, Int) throws -> Data

    struct Discovery {
        let frameURL: URL
        let gameURL: URL
        var filename: String { gameURL.lastPathComponent }
        var version: String { gameURL.deletingPathExtension().lastPathComponent }
    }

    struct Prepared {
        let discovery: Discovery
        let original: Data
        let patched: Data
        let manifest: Data
        let reused: Bool
    }

    private struct Record: Codable {
        let schema_version: Int
        let game: String
        let `protocol`: String
        let game_url: String
        let frame_url: String
        let source_hash: String
        let result_hash: String
        let engine_version: String
        let engine_hash: String
        let rule_hash: String
    }

    private let support: URL
    private let resources: URL
    private let fetch: Fetch
    private let fm = FileManager.default

    init(support: URL, resources: URL, fetch: @escaping Fetch = ChapterFiveAuto.fetchBounded) {
        self.support = support
        self.resources = resources
        self.fetch = fetch
    }

    static func failure(_ text: String) -> NSError {
        NSError(domain: "ZMXYAuto", code: 1, userInfo: [NSLocalizedDescriptionKey: text])
    }

    private static func captures(_ pattern: String, in text: String) throws -> [String] {
        let regex = try NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
        let range = NSRange(text.startIndex..., in: text)
        return regex.matches(in: text, range: range).compactMap { match in
            guard let value = Range(match.range(at: 1), in: text) else { return nil }
            return String(text[value])
        }
    }

    static func validGameURL(_ url: URL) -> Bool {
        guard url.scheme == "https", url.host == "sda.4399.com", url.port == nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else { return false }
        return url.absoluteString.range(of: "^" + NSRegularExpression.escapedPattern(for: base) + "v[0-9]{3,12}\\.swf$", options: .regularExpression) != nil
    }

    static func frameURL(from topicData: Data) throws -> URL {
        guard topicData.count <= 2_500_000 else { throw failure("官方专题页面过大。") }
        // The URLs are ASCII even when the surrounding page uses GBK.
        let text = String(decoding: topicData, as: UTF8.self)
        let matches = try captures("game_url_arr\\s*\\[\\s*5\\s*\\]\\s*=\\s*['\"]([^'\"]+)['\"]", in: text)
        let values = Set(matches)
        guard values.count == 1, let string = values.first, let url = URL(string: string),
              url.scheme == "https", url.host == "sda.4399.com", url.port == nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              string.range(of: "^" + NSRegularExpression.escapedPattern(for: base) + "v[0-9]{3,12}[a-z]{0,8}\\.htm$", options: .regularExpression) != nil else {
            throw failure("无法唯一识别造梦5官方入口，未使用旧版地址。")
        }
        return url
    }

    static func discovery(frameURL: URL, frameData: Data) throws -> Discovery {
        guard frameData.count <= 2_500_000 else { throw failure("官方游戏页面过大。") }
        let validatedFrame = try self.frameURL(from: Data("game_url_arr[5]='\(frameURL.absoluteString)'".utf8))
        guard validatedFrame == frameURL else { throw failure("官方游戏页面地址无效。") }
        let text = String(decoding: frameData, as: UTF8.self)
        let candidates = try captures("(?:src|value)\\s*=\\s*['\"]([^'\"]+\\.swf)['\"]", in: text)
        let urls = Set(candidates.compactMap { value -> URL? in
            guard let url = URL(string: value, relativeTo: frameURL)?.absoluteURL,
                  validGameURL(url) else { return nil }
            return url
        })
        guard urls.count == 1, let game = urls.first,
              let frameDigits = frameURL.lastPathComponent.range(of: "^v[0-9]+", options: .regularExpression),
              String(frameURL.lastPathComponent[frameDigits]) == game.deletingPathExtension().lastPathComponent else {
            throw failure("官方页面的游戏文件路径不明确或与版本不符。")
        }
        return Discovery(frameURL: frameURL, gameURL: game)
    }

    func discover() throws -> Discovery {
        var components = URLComponents(url: Self.topic, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "zmxy_auto", value: UUID().uuidString)]
        let page = try fetch(components.url!, nil, 2_500_000)
        let frame = try Self.frameURL(from: page)
        var freshFrame = URLComponents(url: frame, resolvingAgainstBaseURL: false)!
        freshFrame.queryItems = [URLQueryItem(name: "zmxy_auto", value: UUID().uuidString)]
        return try Self.discovery(frameURL: frame, frameData: fetch(freshFrame.url!, Self.topic, 2_500_000))
    }

    private func boundedFile(_ url: URL, maximum: Int = ChapterFiveAuto.maximumSize) throws -> Data {
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              let size = values.fileSize, size > 0, size <= maximum else { throw Self.failure("自动适配缓存文件无效。") }
        return try Data(contentsOf: url)
    }

    private func cached(_ discovery: Discovery, sourceHash: String, engineHash: String, ruleHash: String) -> Prepared? {
        let cache = support.appendingPathComponent("auto-zm5-cache", isDirectory: true)
        guard let folders = try? fm.contentsOfDirectory(at: cache, includingPropertiesForKeys: [.isDirectoryKey]) else { return nil }
        for folder in folders.prefix(128) {
            guard folder.lastPathComponent.range(of: "^[a-f0-9]{64}-[a-f0-9]{12}-[a-f0-9]{12}$", options: .regularExpression) != nil,
                  let folderValues = try? folder.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey]),
                  folderValues.isDirectory == true, folderValues.isSymbolicLink != true,
                  let data = try? boundedFile(folder.appendingPathComponent("manifest.json"), maximum: 16_384),
                  let record = try? JSONDecoder().decode(Record.self, from: data),
                  record.schema_version == 1, record.game == "zm5", record.protocol == Self.protocolName,
                  record.engine_version == Self.engineVersion, record.engine_hash == engineHash,
                  record.rule_hash == ruleHash, record.source_hash == sourceHash, record.game_url == discovery.gameURL.absoluteString,
                  record.frame_url == discovery.frameURL.absoluteString,
                  let original = try? boundedFile(folder.appendingPathComponent("source.swf")),
                  let patched = try? boundedFile(folder.appendingPathComponent("patch.swf")),
                  PatchRecipe.hash(original) == record.source_hash,
                  PatchRecipe.hash(patched) == record.result_hash,
                  (try? PatchRecipe.unpack(original)) == original,
                  (try? PatchRecipe.unpack(patched)) == patched else { continue }
            return Prepared(discovery: discovery, original: original, patched: patched, manifest: data, reused: true)
        }
        return nil
    }

    func prepare(client: URL, discovery: Discovery? = nil) throws -> Prepared {
        let latest = try discovery ?? discover()
        let engine = resources.appendingPathComponent("auto-patch.cjs")
        let rule = resources.appendingPathComponent("auto-patch-rule.json")
        let engineHash = PatchRecipe.hash(try boundedFile(engine, maximum: 2_000_000))
        let ruleHash = PatchRecipe.hash(try boundedFile(rule, maximum: 2_000_000))
        // The official server can replace bytes at the same URL; cache by fresh content, not URL.
        let compressed = try fetch(latest.gameURL, latest.frameURL, Self.maximumSize)
        let original = try PatchRecipe.unpack(compressed)
        let sourceHash = PatchRecipe.hash(original)
        if let ready = cached(latest, sourceHash: sourceHash, engineHash: engineHash, ruleHash: ruleHash) { return ready }
        let temporary = fm.temporaryDirectory.appendingPathComponent("zmxy-auto-" + UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: temporary) }
        let input = temporary.appendingPathComponent("source.swf")
        let output = temporary.appendingPathComponent("patch.swf")
        try original.write(to: input, options: .atomic)
        try runEngine(client: client, engine: engine, rule: rule, input: input, output: output, directory: temporary)
        let patched = try boundedFile(output)
        guard try PatchRecipe.unpack(patched) == patched, patched != original else {
            throw Self.failure("自动适配没有生成有效的新补丁。")
        }
        let record = Record(schema_version: 1, game: "zm5", protocol: Self.protocolName,
            game_url: latest.gameURL.absoluteString, frame_url: latest.frameURL.absoluteString,
            source_hash: sourceHash, result_hash: PatchRecipe.hash(patched), engine_version: Self.engineVersion,
            engine_hash: engineHash, rule_hash: ruleHash)
        let manifest = try JSONEncoder().encode(record)
        let ready = Prepared(discovery: latest, original: original, patched: patched, manifest: manifest, reused: false)
        try store(ready, record: record)
        return ready
    }

    private func runEngine(client: URL, engine: URL, rule: URL, input: URL, output: URL, directory: URL) throws {
        let info = try PropertyListSerialization.propertyList(from: Data(contentsOf: client.appendingPathComponent("Contents/Info.plist")), format: nil) as? [String: Any]
        guard let executable = info?["CFBundleExecutable"] as? String,
              !executable.isEmpty, !executable.contains("/") else { throw Self.failure("客户端运行环境信息无效。") }
        let process = Process()
        process.executableURL = client.appendingPathComponent("Contents/MacOS").appendingPathComponent(executable)
        process.arguments = [engine.path, input.path, output.path, rule.path]
        process.environment = ["ELECTRON_RUN_AS_NODE": "1", "PATH": "/usr/bin:/bin", "HOME": NSHomeDirectory(), "TMPDIR": directory.path]
        let diagnostics = directory.appendingPathComponent("diagnostics.txt")
        fm.createFile(atPath: diagnostics.path, contents: nil)
        let log = try FileHandle(forWritingTo: diagnostics)
        defer { try? log.close() }
        process.standardOutput = log
        process.standardError = log
        let exited = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in exited.signal() }
        try process.run()
        if exited.wait(timeout: .now() + 45) == .timedOut {
            process.terminate()
            if exited.wait(timeout: .now() + 3) == .timedOut {
                kill(process.processIdentifier, SIGKILL)
                _ = exited.wait(timeout: .now() + 3)
            }
            throw Self.failure("本地结构校验超时，未接入游戏。")
        }
        guard process.terminationStatus == 0 else {
            let text = (try? boundedFile(diagnostics, maximum: 64_000)).map { String(decoding: $0, as: UTF8.self) } ?? ""
            throw Self.failure("当前游戏结构无法自动适配，未接入游戏。\n" + String(text.prefix(1200)))
        }
    }

    private func store(_ ready: Prepared, record: Record) throws {
        let root = support.appendingPathComponent("auto-zm5-cache", isDirectory: true)
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        let name = record.source_hash + "-" + record.engine_hash.prefix(12) + "-" + record.rule_hash.prefix(12)
        let final = root.appendingPathComponent(name, isDirectory: true)
        let temporary = root.appendingPathComponent("staging-" + UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: temporary) }
        try ready.original.write(to: temporary.appendingPathComponent("source.swf"), options: .atomic)
        try ready.patched.write(to: temporary.appendingPathComponent("patch.swf"), options: .atomic)
        try ready.manifest.write(to: temporary.appendingPathComponent("manifest.json"), options: .atomic)
        if fm.fileExists(atPath: final.path) { try fm.removeItem(at: final) }
        try fm.moveItem(at: temporary, to: final)
        let folders = try fm.contentsOfDirectory(at: root, includingPropertiesForKeys: [.creationDateKey, .isDirectoryKey, .isSymbolicLinkKey])
            .filter { url in
                guard url.lastPathComponent.range(of: "^[a-f0-9]{64}-[a-f0-9]{12}-[a-f0-9]{12}$", options: .regularExpression) != nil,
                      let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey]) else { return false }
                return values.isDirectory == true && values.isSymbolicLink != true
            }.sorted { left, right in
                let a = (try? left.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
                let b = (try? right.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
                return a > b
            }
        for old in folders.dropFirst(3) { try fm.removeItem(at: old) }
    }

    // Manifest is committed last: interruption can only invalidate a pair, never serve it as valid.
    func install(_ ready: Prepared) throws {
        try fm.createDirectory(at: support, withIntermediateDirectories: true)
        try ready.patched.write(to: support.appendingPathComponent("patched-zm5.swf"), options: .atomic)
        try ready.manifest.write(to: support.appendingPathComponent("auto-zm5.json"), options: .atomic)
    }

    static func fetchBounded(_ url: URL, referer: URL?, maximum: Int) throws -> Data {
        let receiver = BoundedFetch(maximum: maximum)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 45
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        let session = URLSession(configuration: configuration, delegate: receiver, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url)
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        if let referer = referer { request.setValue(referer.absoluteString, forHTTPHeaderField: "Referer") }
        request.timeoutInterval = 30
        let task = session.dataTask(with: request)
        task.resume()
        guard receiver.finished.wait(timeout: .now() + 50) == .success else {
            task.cancel()
            throw failure("官方文件请求超时，请稍后重试。")
        }
        if let error = receiver.error { throw error }
        guard !receiver.data.isEmpty else { throw failure("官方源返回空文件。") }
        return receiver.data
    }
}

private final class BoundedFetch: NSObject, URLSessionDataDelegate {
    let maximum: Int
    let finished = DispatchSemaphore(value: 0)
    var data = Data()
    var error: Error?
    init(maximum: Int) { self.maximum = maximum }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        error = ChapterFiveAuto.failure("官方源发生跳转，未继续下载。")
        completionHandler(nil)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse, response.statusCode == 200,
              response.expectedContentLength <= maximum else {
            error = ChapterFiveAuto.failure("官方源响应状态或文件大小无效。")
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive bytes: Data) {
        guard bytes.count <= maximum - data.count else {
            error = ChapterFiveAuto.failure("官方文件超过大小限制。")
            dataTask.cancel()
            return
        }
        data.append(bytes)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError failure: Error?) {
        if error == nil { error = failure }
        finished.signal()
    }
}
