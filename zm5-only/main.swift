import AppKit
import CryptoKit
import UniformTypeIdentifiers

final class AttackApp: NSObject, NSApplicationDelegate {
    private var client: URL {
        let paths = [UserDefaults.standard.string(forKey: "clientPath"),
                     "/Applications/造梦西游.app", "/Applications/摩尔庄园.app"].compactMap { $0 }
        return URL(fileURLWithPath: paths.first { FileManager.default.fileExists(atPath: $0) } ?? paths[1])
    }
    private let support = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/ZMXYDropControl")
    private let proto = "zm5-attack-1.2"
    private var window: NSWindow!
    private let field = NSTextField(string: "1")
    private let status = NSTextField(wrappingLabelWithString: "先接入游戏，再应用倍率。")
    private var multiplier: Int64 = 1
    private var timer: Timer?
    private var downloading = false
    private var messageUntil = Date.distantPast

    func applicationDidFinishLaunching(_ notification: Notification) {
        makeMenu()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 500),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "造梦西游5 · 攻击倍率"
        window.isReleasedWhenClosed = false
        let title = NSTextField(labelWithString: "攻击倍率，随时调整")
        title.font = .systemFont(ofSize: 25, weight: .semibold)
        let subtitle = NSTextField(labelWithString: "造梦西游5 · 角色 / 宠物 / 幻兽 · 单人副本")
        subtitle.textColor = .secondaryLabelColor
        field.placeholderString = "输入正整数，1 倍还原"
        field.font = .monospacedDigitSystemFont(ofSize: 20, weight: .regular)
        field.setAccessibilityLabel("攻击倍率，正整数，1 倍还原")
        field.target = self; field.action = #selector(apply)
        let row = NSStackView(views: [field, NSTextField(labelWithString: "倍"), button("应用", #selector(apply)),
                                      button("恢复1倍", #selector(reset))])
        row.spacing = 10
        field.widthAnchor.constraint(equalToConstant: 230).isActive = true
        let note = NSTextField(wrappingLabelWithString:
            "倍率范围 1～2147483647，单次伤害最高 2147483647。仅单人副本普通和技能伤害生效，独立真实伤害不变。退出助手后约4秒恢复原倍率。")
        note.font = .systemFont(ofSize: 12)
        note.textColor = .secondaryLabelColor
        status.setAccessibilityLabel("接入状态")
        let links = NSStackView(views: [button("官方下载客户端", #selector(downloadClient)),
            button("官方下载游戏文件", #selector(downloadGame))])
        links.spacing = 12
        let setup = NSTextField(wrappingLabelWithString: "首次使用：从官方自行下载兼容客户端和原始游戏文件。接入时会选择本地文件并生成补丁，发布包不含游戏资源。")
        setup.font = .systemFont(ofSize: 12)
        let stack = NSStackView(views: [title, subtitle, row, button("接入并打开游戏", #selector(connect)), links, setup, status, note])
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 24),
            setup.widthAnchor.constraint(equalTo: stack.widthAnchor),
            status.widthAnchor.constraint(equalTo: stack.widthAnchor),
            note.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
        window.center(); window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
        tick()
    }

    private func makeMenu() {
        let menu = NSMenu()
        let item = NSMenuItem()
        menu.addItem(item)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "退出造梦西游5攻击助手", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = appMenu
        let editItem = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu; menu.addItem(editItem)
        NSApp.mainMenu = menu
    }

    private func button(_ title: String, _ action: Selector) -> NSButton {
        let value = NSButton(title: title, target: self, action: action)
        value.bezelStyle = .rounded
        return value
    }

    private func writeSettings(expired: Bool = false) throws {
        try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        let value: [String: Any] = ["protocol": proto, "game": "zm5",
            "attack_multiplier": expired ? 1 : multiplier,
            "updated_at": expired ? 0 : Date().timeIntervalSince1970 * 1000]
        try JSONSerialization.data(withJSONObject: value)
            .write(to: support.appendingPathComponent("settings.json"), options: .atomic)
    }

    private func show(_ text: String) {
        status.stringValue = text
        messageUntil = Date().addingTimeInterval(8)
    }

    @objc private func apply() {
        let text = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }),
              let value = Int64(text), (1...2147483647).contains(value) else {
            show("请输入 1～2147483647 之间的整数。"); return
        }
        multiplier = value; field.stringValue = String(value)
        do { try writeSettings(); show("已设置 \(value) 倍，接入生效状态见下方更新。") }
        catch { show("保存失败：\(error.localizedDescription)") }
    }

    @objc private func reset() {
        field.stringValue = "1"; apply()
    }

    private func install() throws {
        let fm = FileManager.default
        let main = client.appendingPathComponent("Contents/Resources/app/main.js")
        let current = try String(contentsOf: main, encoding: .utf8)
        try fm.createDirectory(at: support, withIntermediateDirectories: true)
        let patch = try localPatch()
        for name in ["bridge.cjs", "attack.cjs"] {
            let source = Bundle.main.resourceURL!.appendingPathComponent(name)
            try Data(contentsOf: source).write(to: support.appendingPathComponent(name), options: .atomic)
        }
        try patch.write(to: support.appendingPathComponent("patched-zm5.swf"), options: .atomic)
        if !current.hasPrefix("// ZMXY_DROP_CONTROL_BEGIN\n") {
            let backup = support.appendingPathComponent("main-before-zm5-only-\(Int(Date().timeIntervalSince1970)).js")
            try current.write(to: backup, atomically: true, encoding: .utf8)
            let data = try JSONSerialization.data(withJSONObject: [support.appendingPathComponent("bridge.cjs").path])
            let array = String(data: data, encoding: .utf8)!
            let quoted = String(array.dropFirst().dropLast())
            let marker = "// ZMXY_DROP_CONTROL_BEGIN\nrequire(\(quoted));\n// ZMXY_DROP_CONTROL_END\n"
            try (marker + current).write(to: main, atomically: true, encoding: .utf8)
        }
    }

    @objc private func connect() {
        do {
            if runningGame() != nil {
                show("请保存并完全退出游戏，再点击接入，以便更新客户端名称和模块。"); return
            }
            try prepareClient(); try install(); try signClient(); try writeSettings()
            NSWorkspace.shared.openApplication(at: client, configuration: NSWorkspace.OpenConfiguration()) { [weak self] _, error in
                DispatchQueue.main.async {
                    self?.show(error.map { "打开失败：\($0.localizedDescription)" } ?? "客户端已打开，请进入造梦西游5。")
                }
            }
        } catch { show("接入失败：\(error.localizedDescription)") }
    }

    private func localPatch() throws -> Data {
        let recipe = try JSONDecoder().decode(PatchRecipe.self,
            from: Data(contentsOf: Bundle.main.url(forResource: "patch-v4780", withExtension: "json")!))
        func verified(_ url: URL) -> Data? {
            guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
                  size > 0, size < 32_000_000, let data = try? Data(contentsOf: url) else { return nil }
            return try? recipe.apply(data)
        }
        for url in [support.appendingPathComponent("patched-zm5.swf"),
                    Bundle.main.resourceURL!.appendingPathComponent("patched-zm5.swf")] {
            if let data = verified(url) { return data }
        }
        let panel = NSOpenPanel()
        panel.title = "选择造梦5 V47.8游戏文件"
        panel.message = "请选择从官方自行下载的 v4780.swf。助手只在本机生成补丁；已有此版补丁也可使用。"
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else {
            throw NSError(domain: "ZMXY", code: 1, userInfo: [NSLocalizedDescriptionKey: "已取消选择本地补丁。"])
        }
        guard let data = verified(url) else {
            throw NSError(domain: "ZMXY", code: 2, userInfo: [NSLocalizedDescriptionKey: "补丁校验不符，请使用此版本支持的 V47.8 补丁。"])
        }
        return data
    }

    @objc private func downloadClient() {
        NSWorkspace.shared.open(URL(string: "https://webres.61.com/common/flash/common_micro.html?game=mole")!)
    }

    @objc private func downloadGame() {
        guard !downloading else { return }
        let panel = NSSavePanel()
        panel.title = "从4399官方保存 V47.8 原始游戏文件"
        panel.nameFieldStringValue = "v4780.swf"
        panel.allowedContentTypes = [UTType(filenameExtension: "swf") ?? .data]
        guard panel.runModal() == .OK, let destination = panel.url else { return }
        downloading = true
        show("正在从4399官方源下载并校验游戏文件…")
        messageUntil = .distantFuture
        var request = URLRequest(url: URL(string: "https://sda.4399.com/4399swf/upload_swf/ftp22/csya/20170622/1/v4780.swf")!)
        request.setValue("https://sda.4399.com/4399swf/upload_swf/ftp22/csya/20170622/1/v4780d.htm", forHTTPHeaderField: "Referer")
        request.timeoutInterval = 60
        URLSession.shared.downloadTask(with: request) { [weak self] file, response, error in
            let result: Result<Void, Error> = Result {
                if let error = error { throw error }
                guard (response as? HTTPURLResponse)?.statusCode == 200, let file = file,
                      let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize,
                      size > 0, size < 32_000_000 else { throw PatchRecipe.invalid() }
                let data = try Data(contentsOf: file)
                let recipe = try JSONDecoder().decode(PatchRecipe.self,
                    from: Data(contentsOf: Bundle.main.url(forResource: "patch-v4780", withExtension: "json")!))
                let original = try PatchRecipe.unpack(data)
                guard PatchRecipe.hash(original) == recipe.sourceHash else { throw PatchRecipe.invalid() }
                try data.write(to: destination, options: .atomic)
            }
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.downloading = false
                switch result {
                case .success: self.show("官方游戏文件已保存。接入时选择该文件即可。")
                case .failure(let error): self.show("官方下载失败：\(error.localizedDescription)")
                }
            }
        }.resume()
    }

    private func prepareClient() throws {
        let fm = FileManager.default
        if !fm.fileExists(atPath: client.path) {
            let panel = NSOpenPanel()
            panel.title = "选择已从官方安装的兼容 Mac 客户端"
            panel.allowedContentTypes = [.applicationBundle]
            panel.canChooseDirectories = false
            guard panel.runModal() == .OK, let url = panel.url else {
                throw NSError(domain: "ZMXY", code: 3, userInfo: [NSLocalizedDescriptionKey: "请先从官方下载安装客户端。"])
            }
            UserDefaults.standard.set(url.path, forKey: "clientPath")
        }
        let old = client
        guard fm.fileExists(atPath: old.appendingPathComponent("Contents/Resources/app/main.js").path),
              fm.fileExists(atPath: old.appendingPathComponent("Contents/Resources/app/plugins/PepperFlashPlayer.plugin").path) else {
            throw NSError(domain: "ZMXY", code: 4, userInfo: [NSLocalizedDescriptionKey: "此客户端不兼容。需要带 PepperFlash 的 Electron 微端，不能使用手游或普通浏览器。"])
        }
        let destination = old.deletingLastPathComponent().appendingPathComponent("造梦西游.app")
        if old != destination && fm.fileExists(atPath: destination.path) {
            throw NSError(domain: "ZMXY", code: 5, userInfo: [NSLocalizedDescriptionKey: "同目录已有造梦西游.app，请先确认客户端位置。"])
        }
        let info = old.appendingPathComponent("Contents/Info.plist")
        let previous = try Data(contentsOf: info)
        var values = try PropertyListSerialization.propertyList(from: previous, format: nil) as! [String: Any]
        values["CFBundleDisplayName"] = "造梦西游"
        // Electron 11 derives helper paths from this internal name. Keep it
        // aligned with the unmodified executable/helper bundles.
        values["CFBundleName"] = values["CFBundleExecutable"]
        do {
            try PropertyListSerialization.data(fromPropertyList: values, format: .xml, options: 0).write(to: info, options: .atomic)
            if old != destination { try fm.moveItem(at: old, to: destination) }
            UserDefaults.standard.set(destination.path, forKey: "clientPath")
        } catch {
            try? previous.write(to: info, options: .atomic)
            throw error
        }
    }

    private func signClient() throws {
        let configURL = client.appendingPathComponent("Contents/Resources/app/config.json")
        var config = try JSONSerialization.jsonObject(with: Data(contentsOf: configURL)) as! [String: Any]
        config["appUrl"] = "https://www.4399.com/flash/zmhj.htm"
        try JSONSerialization.data(withJSONObject: config).write(to: configURL, options: .atomic)
        let signer = Process()
        signer.executableURL = URL(fileURLWithPath: "/usr/bin/codesign")
        signer.arguments = ["--force", "--sign", "-", client.path]
        try signer.run(); signer.waitUntilExit()
        guard signer.terminationStatus == 0 else {
            throw NSError(domain: "ZMXY", code: 6, userInfo: [NSLocalizedDescriptionKey: "客户端本地签名失败，请检查目录写入权限。"])
        }
    }

    private func runningGame() -> NSRunningApplication? {
        NSWorkspace.shared.runningApplications.first { $0.bundleURL?.path == client.path }
    }

    private func tick() {
        do { try writeSettings() } catch { show("配置保存失败：\(error.localizedDescription)"); return }
        guard Date() > messageUntil else { return }
        guard let game = runningGame() else { status.stringValue = "游戏客户端未打开。"; return }
        guard let data = try? Data(contentsOf: support.appendingPathComponent("status.json")),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              value["protocol"] as? String == proto,
              (value["pid"] as? NSNumber)?.int32Value == game.processIdentifier,
              let updated = value["updated_at"] as? Double,
              abs(Date().timeIntervalSince1970 * 1000 - updated) < 2500 else {
            status.stringValue = "客户端尚未接入此版本。请点击接入，保存后重开游戏。"; return
        }
        if let error = value["error"] as? String, !error.isEmpty { status.stringValue = error; return }
        guard value["patched_loaded"] as? Bool == true else {
            status.stringValue = "已连接客户端，请进入造梦西游5（当前补丁适配 V47.8）。"; return
        }
        if let base = value["base_attack"] as? Double, let power = value["effective_attack"] as? Double {
            status.stringValue = String(format: "已接入 · 当前 %lld 倍 · 最近伤害 %.0f → %.0f", multiplier, base, power)
        } else { status.stringValue = "造梦西游5已接入 · 当前 \(multiplier) 倍，等待战斗伤害。" }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate(); try? writeSettings(expired: true)
    }
}

let app = NSApplication.shared
let delegate = AttackApp()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
