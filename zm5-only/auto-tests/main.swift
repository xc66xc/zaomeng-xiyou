import Foundation
func rejects(_ operation: () throws -> Void) {
    do { try operation(); fatalError("Expected rejection") } catch {}
}
let base = ChapterFiveAuto.base
let frame = URL(string: base + "v9990z.htm")!
let topic = Data("game_url_arr[5]='\(frame.absoluteString)';".utf8)
let parsedFrame = try ChapterFiveAuto.frameURL(from: topic)
assert(parsedFrame == frame)
let page = Data("<param name='movie' value='v9990.swf'><embed src='v9990.swf'>".utf8)
let discovered = try ChapterFiveAuto.discovery(frameURL: frame, frameData: page)
assert(discovered.gameURL.absoluteString == base + "v9990.swf")
assert(discovered.filename == "v9990.swf")
assert(ChapterFiveAuto.validGameURL(discovered.gameURL))
for invalid in ["http://sda.4399.com/4399swf/upload_swf/ftp22/csya/20170622/1/v9990.swf", base+"v9990.swf?x=1", base+"../v9990.swf", base+"v9990.swf#x", "https://evil.example/v9990.swf"] {
    assert(!ChapterFiveAuto.validGameURL(URL(string: invalid)!))
}
for invalid in ["game_url_arr[5]='https://evil.example/v9990z.htm'", "game_url_arr[5]='\(base)v9990z.htm';game_url_arr[5]='\(base)v9991z.htm'", "game_url_arr[5]='\(base)v9990z.htm?x=1'", "game_url_arr[4]='\(base)v9990z.htm'"] {
    rejects { _ = try ChapterFiveAuto.frameURL(from: Data(invalid.utf8)) }
}
rejects { _ = try ChapterFiveAuto.discovery(frameURL: frame, frameData: Data("<embed src='v9991.swf'>".utf8)) }
rejects { _ = try ChapterFiveAuto.discovery(frameURL: frame, frameData: Data("<embed src='v9990.swf'><embed src='v9991.swf'>".utf8)) }
rejects { _ = try ChapterFiveAuto.discovery(frameURL: URL(string: "https://evil.example/v9990z.htm")!, frameData: page) }
let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
let service = ChapterFiveAuto(support: temporary, resources: temporary) { url, referer, maximum in
    if url.host == "www.4399.com" {
        assert(url.query?.contains("zmxy_auto=") == true)
        assert(referer == nil && maximum == 2_500_000)
        return topic
    }
    assert(url.path == frame.path && url.query?.contains("zmxy_auto=") == true)
    assert(referer == ChapterFiveAuto.topic)
    return page
}
let fromService = try service.discover()
assert(fromService.gameURL == discovered.gameURL)
print("PASS: native discovery fixtures, cache-busting, host/path/version/ambiguity rejection")

// A fixture-only executable checks invocation and cache behavior, without starting Electron or a game.
let fm = FileManager.default
let fixtureRoot = fm.temporaryDirectory.appendingPathComponent("zmxy-native-test-" + UUID().uuidString)
try fm.createDirectory(at: fixtureRoot, withIntermediateDirectories: true)
defer { try? fm.removeItem(at: fixtureRoot) }
let client = fixtureRoot.appendingPathComponent("Fixture.app")
let macOS = client.appendingPathComponent("Contents/MacOS")
try fm.createDirectory(at: macOS, withIntermediateDirectories: true)
let plist = try PropertyListSerialization.data(fromPropertyList: ["CFBundleExecutable":"fixture-runner"], format: .xml, options: 0)
try plist.write(to: client.appendingPathComponent("Contents/Info.plist"))
let runner = macOS.appendingPathComponent("fixture-runner")
let script = """
#!/bin/sh
[ "$ELECTRON_RUN_AS_NODE" = 1 ] || exit 21
[ -z "$NODE_OPTIONS" ] || exit 22
[ "$#" = 4 ] || exit 23
cp "$2" "$3" || exit 24
printf '\\002' | dd of="$3" bs=1 seek=3 conv=notrunc 2>/dev/null
"""
try Data(script.utf8).write(to: runner)
try fm.setAttributes([.posixPermissions:0o755], ofItemAtPath: runner.path)
let resource = fixtureRoot.appendingPathComponent("resources")
try fm.createDirectory(at: resource, withIntermediateDirectories: true)
try Data("fixture-engine".utf8).write(to: resource.appendingPathComponent("auto-patch.cjs"))
try Data("fixture-rule".utf8).write(to: resource.appendingPathComponent("auto-patch-rule.json"))
var original = Data([70,87,83,1,9,0,0,0,11])
var downloads = 0
let cacheSupport = fixtureRoot.appendingPathComponent("support")
let caching = ChapterFiveAuto(support: cacheSupport, resources: resource) { url, referer, _ in
    assert(url == discovered.gameURL && referer == discovered.frameURL)
    downloads += 1
    return original
}
let first = try caching.prepare(client: client, discovery: discovered)
assert(!first.reused && downloads == 1)
let second = try caching.prepare(client: client, discovery: discovered)
assert(second.reused && downloads == 2 && first.patched == second.patched)
original[8] = 12
let changedSameURL = try caching.prepare(client: client, discovery: discovered)
assert(!changedSameURL.reused && downloads == 3 && changedSameURL.original != first.original)
let cacheRoot = cacheSupport.appendingPathComponent("auto-zm5-cache")
for folder in try fm.contentsOfDirectory(at: cacheRoot, includingPropertiesForKeys: nil) {
    try Data("broken-cache".utf8).write(to: folder.appendingPathComponent("patch.swf"))
}
let recovered = try caching.prepare(client: client, discovery: discovered)
assert(!recovered.reused && downloads == 4)
try caching.install(recovered)
let installedPatch = try Data(contentsOf: cacheSupport.appendingPathComponent("patched-zm5.swf"))
assert(installedPatch == recovered.patched)
let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: cacheSupport.appendingPathComponent("auto-zm5.json"))) as! [String:Any]
assert(manifest["result_hash"] as? String == PatchRecipe.hash(recovered.patched))
for marker in UInt8(13)...UInt8(17) {
    original[8] = marker
    _ = try caching.prepare(client: client, discovery: discovered)
}
let cacheFolders = try fm.contentsOfDirectory(at: cacheRoot, includingPropertiesForKeys: nil)
assert(cacheFolders.count == 3)
print("PASS: native engine environment, fresh-content cache reuse, same-URL update, corruption regeneration, install pair and bounded pruning")
