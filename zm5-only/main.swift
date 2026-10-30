import AppKit
import CryptoKit
import UniformTypeIdentifiers

// Native button tracking, keyboard and accessibility remain provided by NSButton.
private final class HelperButton: NSButton {
    enum Style { case outlined, primary, ghost }
    var style: Style = .outlined
    private let accent = NSColor(calibratedRed: 0.70, green: 0.43, blue: 0.11, alpha: 1)

    override var intrinsicContentSize: NSSize {
        NSSize(width: super.intrinsicContentSize.width + 20, height: 38)
    }

    override func draw(_ dirtyRect: NSRect) {
        let rect = bounds.insetBy(dx: 2, dy: 2)
        let shape = NSBezierPath(roundedRect: rect, xRadius: 7, yRadius: 7)
        if style != .ghost {
            let fill = style == .primary
                ? NSColor(calibratedRed: 0.83, green: 0.60, blue: 0.29, alpha: 1)
                : NSColor.white
            (isHighlighted ? fill.blended(withFraction: 0.12, of: .black)! : fill).setFill()
            shape.fill()
            (style == .primary ? accent : NSColor(calibratedWhite: 0.82, alpha: 1)).setStroke()
            shape.lineWidth = 1
            shape.stroke()
        }
        let text = NSAttributedString(string: title, attributes: [
            .font: font ?? NSFont.systemFont(ofSize: 14),
            .foregroundColor: style == .ghost ? accent : NSColor(calibratedWhite: 0.14, alpha: 1)
        ])
        let size = text.size()
        text.draw(at: NSPoint(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2))
        if window?.firstResponder === self {
            NSColor.keyboardFocusIndicatorColor.setStroke()
            let focus = NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: 8, yRadius: 8)
            focus.lineWidth = 2
            focus.stroke()
        }
    }
}

private enum GameChapter: Int, CaseIterable {
    case two = 2, three = 3, four = 4, five = 5
    var game: String { "zm\(rawValue)" }
    var protocolName: String {
        switch self {
        case .two: return "zm2-helper-1.0"
        case .three: return "zm3-helper-2.0"
        case .four: return "zm4-attack-1.0"
        case .five: return "zm5-attack-1.2"
        }
    }
    var hasExtendedFeatures: Bool { self == .two || self == .three }
    var title: String {
        switch self { case .two: return "十殿阎罗篇"; case .three: return "大闹天庭篇"; case .four: return "洪荒大劫篇"; case .five: return "上古天帝篇" }
    }
    var version: String {
        switch self { case .two: return "v25928"; case .three: return "v261029"; case .four: return "V58.8"; case .five: return "V47.8" }
    }
    var filename: String {
        switch self { case .two: return "v25928"; case .three: return "v261029"; case .four: return "v5880"; case .five: return "v4780" }
    }
    var recipe: String { "patch-\(filename)" }
    var patchFile: String { "patched-\(game).swf" }
    var settingsFile: String { self == .five ? "settings.json" : "settings-\(game).json" }
    var statusFile: String { self == .five ? "status.json" : "status-\(game).json" }
    var baseURL: String {
        let path: String
        switch self {
        case .two: path = "ftp6/hanbao/20110927/4/"
        case .three: path = "ftp7/hanbao/20120107/6/"
        case .four: path = "ftp15/csya/20150127/1/"
        case .five: path = "ftp22/csya/20170622/1/"
        }
        let host = self == .two ? "sbai.4399.com" : "sda.4399.com"
        return "https://\(host)/4399swf/upload_swf/" + path
    }
    var gameURL: String { baseURL + filename + ".swf" }
    var referer: String {
        let suffix: String
        switch self { case .two, .three: suffix = ".htm"; case .four: suffix = "gg.htm"; case .five: suffix = "d.htm" }
        return baseURL + filename + suffix
    }
    var scopeLabel: String {
        switch self {
        case .two: return "本地双人角色 · 唐僧回血不变"
        case .three: return "四角色 · 仅本地副本"
        case .four: return "本人角色 · 仅单人副本"
        case .five: return "角色、宠物、幻兽 · 仅单人副本"
        }
    }
    var scopeNote: String {
        switch self {
        case .two: return "普通与技能伤害生效，唐僧与影子的回血动作不变。"
        case .three: return "仅修改本地角色伤害，回血、辅助和联网竞技模式不变。"
        case .four: return "本人角色的普通与技能伤害生效。"
        case .five: return "普通与技能伤害生效，独立真实伤害不变。"
        }
    }
}

final class AttackApp: NSObject, NSApplicationDelegate {
    private var client: URL {
        let paths = [UserDefaults.standard.string(forKey: "clientPath"),
                     "/Applications/造梦西游.app", "/Applications/摩尔庄园.app"].compactMap { $0 }
        return URL(fileURLWithPath: paths.first { FileManager.default.fileExists(atPath: $0) } ?? paths[1])
    }
    private let support = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/ZMXYDropControl")
    private var chapter: GameChapter = .five
    private var proto: String { chapter.protocolName }
    private var window: NSWindow!
    private var field = NSTextField(string: "1")
    private var status = NSTextField(wrappingLabelWithString: "先接入游戏，再应用倍率。")
    private var multipliers: [GameChapter: Int64] = [.two: 1, .three: 1, .four: 1, .five: 1]
    private var multiplier: Int64 {
        get { multipliers[chapter] ?? 1 }
        set { multipliers[chapter] = newValue }
    }
    private var featureSettings: [GameChapter: [String: Any]] = [
        .two: ["mode": "original", "multiplier": 1, "boss_drop_enabled": false,
            "boss_drop_item": "", "strength_guaranteed": false, "fusion_guaranteed": false],
        .three: ["mode": "original", "multiplier": 1, "experience_multiplier": 1,
            "boss_drop_enabled": false, "boss_drop_item": "", "strength_guaranteed": false,
            "craft_max_attributes": false, "craft_elements": ""]
    ]
    private var extras: [String: Any] {
        get { featureSettings[chapter] ?? [:] }
        set { featureSettings[chapter] = newValue }
    }
    private var featurePages: [GameChapter: Int] = [.two: 0, .three: 0]
    private var featurePage: Int {
        get { featurePages[chapter] ?? 0 }
        set { featurePages[chapter] = newValue }
    }
    private var featureMode = NSPopUpButton()
    private var dropField = NSTextField(string: "1")
    private var experienceField = NSTextField(string: "1")
    private var bossToggle = NSButton()
    private var bossChoice = NSPopUpButton()
    private var strengthToggle = NSButton()
    private var fusionToggle = NSButton()
    private var bestToggle = NSButton()
    private var elementsChoice = NSPopUpButton()
    private var itemCategory = NSPopUpButton()
    private var itemChoice = NSPopUpButton()
    private var amountField = NSTextField(string: "1")
    private var itemPlayer = NSPopUpButton()
    private var selectedPlayer = 1
    private var commandMessage = NSTextField(wrappingLabelWithString: "")
    private var pendingCommands: [GameChapter: [String: Any]] = [:]
    private var pendingCommand: [String: Any]? {
        get { pendingCommands[chapter] }
        set { pendingCommands[chapter] = newValue }
    }
    private var commandFeedbacks: [GameChapter: String] = [:]
    private var commandFeedback: String {
        get { commandFeedbacks[chapter] ?? "点击执行才操作一次；请在游戏中自行保存。" }
        set { commandFeedbacks[chapter] = newValue }
    }
    private var itemCatalogs: [GameChapter: [[String: Any]]] = [:]
    private var bossCatalogs: [GameChapter: [[String: Any]]] = [:]
    private var itemCatalog: [[String: Any]] { itemCatalogs[chapter] ?? [] }
    private var bossCatalog: [[String: Any]] { bossCatalogs[chapter] ?? [] }
    private var visibleItems: [[String: Any]] = []
    private let elementValues = ["", "jin", "mu", "shui", "huo", "tu", "jin+mu", "jin+shui",
        "jin+huo", "jin+tu", "mu+shui", "mu+huo", "mu+tu", "shui+huo", "shui+tu", "huo+tu"]
    private var timer: Timer?
    private var downloadingChapter: GameChapter?
    private var messageUntil = Date.distantPast

    private let ink = NSColor(calibratedWhite: 0.14, alpha: 1)
    private let muted = NSColor(calibratedWhite: 0.43, alpha: 1)
    private let amber = NSColor(calibratedRed: 0.70, green: 0.43, blue: 0.11, alpha: 1)
    private let surface = NSColor(calibratedRed: 0.98, green: 0.98, blue: 0.97, alpha: 1)
    private var connection = NSTextField(labelWithString: "游戏未打开")

    private func label(_ text: String, size: CGFloat = 14, weight: NSFont.Weight = .regular,
                       secondary: Bool = false) -> NSTextField {
        let value = NSTextField(wrappingLabelWithString: text)
        value.font = .systemFont(ofSize: size, weight: weight)
        value.textColor = secondary ? muted : ink
        return value
    }

    private func line() -> NSView {
        let value = NSView()
        value.wantsLayer = true
        value.layer?.backgroundColor = NSColor(calibratedWhite: 0.87, alpha: 1).cgColor
        value.heightAnchor.constraint(equalToConstant: 1).isActive = true
        return value
    }

    private func row(_ views: [NSView], spacing: CGFloat = 12) -> NSStackView {
        let value = NSStackView(views: views)
        value.orientation = .horizontal
        value.alignment = .centerY
        value.spacing = spacing
        return value
    }

    private func stretch() -> NSView {
        let value = NSView()
        value.setContentHuggingPriority(.defaultLow, for: .horizontal)
        return value
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        makeMenu()
        do {
            for game in [GameChapter.two, .three] {
                for name in ["\(game.game)-items", "boss-items-\(game.game)"] {
                    guard let url = Bundle.main.url(forResource: name, withExtension: "json"),
                          let values = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]],
                          !values.isEmpty else { throw PatchRecipe.invalid() }
                    if name == "\(game.game)-items" { itemCatalogs[game] = values }
                    else { bossCatalogs[game] = values }
                }
            }
        } catch {
            let alert = NSAlert()
            alert.messageText = "造梦2/3功能目录加载失败，请重新下载完整助手。"
            alert.runModal(); NSApp.terminate(nil); return
        }
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 760, height: 620),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "造梦西游助手"
        window.appearance = NSAppearance(named: .aqua)
        window.backgroundColor = surface
        window.isReleasedWhenClosed = false
        buildInterface()
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
        tick()
    }

    @objc private func selectChapter(_ sender: NSButton) {
        guard let selected = GameChapter(rawValue: sender.tag), selected != chapter else { return }
        // Finish editing while callbacks still address the previous chapter.
        window.makeFirstResponder(nil)
        chapter = selected
        window.setContentSize(NSSize(width: 760, height: chapter.hasExtendedFeatures ? 740 : 620))
        messageUntil = .distantPast
        buildInterface()
        if let downloading = downloadingChapter {
            show("正在下载并校验造梦\(downloading.rawValue)游戏文件…")
            messageUntil = .distantFuture
        }
        tick()
    }

    private func buildInterface() {
        field = NSTextField(string: String(multiplier))
        status = NSTextField(wrappingLabelWithString: "")
        connection = NSTextField(labelWithString: "游戏未打开")
        window.contentView = NSView()
        let content = window.contentView!

        let chapters = row([], spacing: 0)
        chapters.distribution = .fillEqually
        for number in 1...5 {
            let available = GameChapter(rawValue: number) != nil
            let selected = chapter.rawValue == number
            let title = NSButton(title: "造梦\(number)", target: self, action: #selector(selectChapter(_:)))
            title.tag = number
            title.isEnabled = available
            title.isBordered = false
            title.font = .systemFont(ofSize: 16, weight: selected ? .semibold : .regular)
            title.contentTintColor = selected ? amber : (available ? ink : muted)
            title.setAccessibilityLabel("造梦\(number)，\(selected ? "当前章节" : (available ? "切换章节" : "暂未支持"))")
            let detail = label(selected ? "当前章节" : (available ? "点击切换" : "暂未支持"), size: 11, secondary: true)
            detail.alignment = .center
            let item = NSStackView(views: [title, detail])
            item.orientation = .vertical
            item.spacing = 3
            item.wantsLayer = true
            item.layer?.backgroundColor = selected
                ? NSColor(calibratedRed: 1, green: 0.95, blue: 0.87, alpha: 1).cgColor : surface.cgColor
            item.heightAnchor.constraint(equalToConstant: 60).isActive = true
            chapters.addArrangedSubview(item)
        }
        chapters.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(chapters)
        if chapter.hasExtendedFeatures {
            buildExtendedInterface(content: content, chapters: chapters)
            return
        }

        let heading = row([label("造梦西游 \(chapter.rawValue)", size: 18, weight: .semibold),
                           label(chapter.title, secondary: true), stretch(), connection,
                           button("接入并打开游戏", #selector(connect))])
        connection.font = .systemFont(ofSize: 12)
        connection.textColor = muted
        connection.setAccessibilityLabel("客户端运行状态")
        field.placeholderString = "输入正整数"
        field.font = .monospacedDigitSystemFont(ofSize: 40, weight: .regular)
        field.textColor = ink
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.setAccessibilityLabel("攻击倍率，正整数，1 倍还原")
        field.target = self
        field.action = #selector(apply)
        field.translatesAutoresizingMaskIntoConstraints = false
        let input = NSView()
        input.wantsLayer = true
        input.layer?.backgroundColor = NSColor.white.cgColor
        input.layer?.borderWidth = 1
        input.layer?.borderColor = amber.cgColor
        input.layer?.cornerRadius = 8
        let unit = label("倍", size: 20, secondary: true)
        unit.translatesAutoresizingMaskIntoConstraints = false
        input.addSubview(field)
        input.addSubview(unit)
        NSLayoutConstraint.activate([
            input.heightAnchor.constraint(equalToConstant: 76),
            field.leadingAnchor.constraint(equalTo: input.leadingAnchor, constant: 18),
            field.trailingAnchor.constraint(equalTo: unit.leadingAnchor, constant: -12),
            field.centerYAnchor.constraint(equalTo: input.centerYAnchor),
            unit.trailingAnchor.constraint(equalTo: input.trailingAnchor, constant: -18),
            unit.centerYAnchor.constraint(equalTo: input.centerYAnchor),
            unit.widthAnchor.constraint(equalToConstant: 24)
        ])
        let applyButton = button("应用", #selector(apply))
        applyButton.style = .primary
        applyButton.heightAnchor.constraint(equalToConstant: 76).isActive = true
        applyButton.font = .systemFont(ofSize: 20, weight: .semibold)
        applyButton.widthAnchor.constraint(equalToConstant: 142).isActive = true
        let inputRow = row([input, applyButton], spacing: 16)
        let resetButton = button("恢复 1 倍", #selector(reset))
        resetButton.style = .ghost
        resetButton.isBordered = false
        resetButton.contentTintColor = amber
        resetButton.setContentHuggingPriority(.required, for: .horizontal)
        let feedback = row([resetButton, stretch()])
        status.font = .systemFont(ofSize: 12)
        status.textColor = muted
        status.setAccessibilityLabel("操作与接入结果")
        status.heightAnchor.constraint(equalToConstant: 40).isActive = true
        let stack = NSStackView(views: [heading, line(),
            label("攻击倍率", size: 30, weight: .semibold),
            label(chapter.scopeLabel, size: 16, secondary: true),
            inputRow, feedback,
            label(chapter.scopeNote, secondary: true),
            status, line(), label("游戏接入", size: 20, weight: .semibold),
            label("首次使用：从官方准备客户端和游戏文件，再接入游戏。", secondary: true),
            row([button("官方客户端", #selector(downloadClient)),
                 button("官方游戏文件", #selector(downloadGame)), stretch()]),
            line(), label("倍率范围 1～2147483647 · 单次伤害最高 2147483647\n退出助手后约 4 秒恢复原倍率。", size: 12, secondary: true)])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        for view in stack.arrangedSubviews {
            view.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        }
        NSLayoutConstraint.activate([
            chapters.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            chapters.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            chapters.topAnchor.constraint(equalTo: content.topAnchor),
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 30),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -30),
            stack.topAnchor.constraint(equalTo: chapters.bottomAnchor, constant: 22),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -20)
        ])
    }

    private func popup(_ titles: [String], label text: String, action: Selector? = nil) -> NSPopUpButton {
        let value = NSPopUpButton(frame: .zero, pullsDown: false)
        value.addItems(withTitles: titles)
        value.setAccessibilityLabel(text)
        value.font = .systemFont(ofSize: 14)
        if let action = action { value.target = self; value.action = action }
        return value
    }

    private func smallField(_ value: Int, label text: String) -> NSTextField {
        let field = NSTextField(string: String(value))
        field.font = .monospacedDigitSystemFont(ofSize: 16, weight: .regular)
        field.setAccessibilityLabel(text)
        field.widthAnchor.constraint(equalToConstant: 96).isActive = true
        return field
    }

    private func toggle(_ title: String, key: String) -> NSButton {
        let value = NSButton(checkboxWithTitle: title, target: self, action: #selector(applyFeatures))
        value.state = extras[key] as? Bool == true ? .on : .off
        value.font = .systemFont(ofSize: 14)
        return value
    }

    private func buildExtendedInterface(content: NSView, chapters: NSView) {
        let heading = row([label("造梦西游 \(chapter.rawValue)", size: 20, weight: .semibold),
            label(chapter.title, secondary: true), stretch(), connection,
            button("接入并打开游戏", #selector(connect))])
        connection.font = .systemFont(ofSize: 12)
        connection.textColor = muted
        connection.setAccessibilityLabel("客户端运行状态")
        field = smallField(Int(multiplier), label: "攻击倍率，1～2147483647")
        field.target = self; field.action = #selector(apply)
        let attackRow = row([label("攻击倍率", size: 18, weight: .semibold), field,
            label("倍", secondary: true), button("应用", #selector(apply)),
            button("恢复 1 倍", #selector(reset)), stretch()])
        let sections = chapter == .two ? ["战斗与掉落", "强化与合成", "强化石与翅膀"]
            : ["战斗与掉落", "炼丹与强化", "物品与宠物"]
        let navigation = NSSegmentedControl(labels: sections,
            trackingMode: .selectOne, target: self, action: #selector(selectFeature(_:)))
        navigation.selectedSegment = featurePage
        navigation.segmentDistribution = .fillEqually
        navigation.setAccessibilityLabel("造梦\(chapter.rawValue)功能分类")
        let body = NSStackView()
        body.orientation = .vertical; body.alignment = .leading; body.spacing = 14
        switch featurePage {
        case 0:
            featureMode = popup(["原始爆率", "爆率倍率", "必掉"], label: "爆率模式", action: #selector(applyFeatures))
            let modes = ["original", "multiplier", "guaranteed"]
            featureMode.selectItem(at: modes.firstIndex(of: extras["mode"] as? String ?? "original") ?? 0)
            dropField = smallField(extras["multiplier"] as? Int ?? 1, label: "爆率倍率，1～1000")
            experienceField = smallField(extras["experience_multiplier"] as? Int ?? 1, label: "经验倍率，1～1000")
            for input in [dropField, experienceField] { input.target = self; input.action = #selector(applyFeatures) }
            body.addArrangedSubview(row([label("爆率"), featureMode, dropField, label("倍 · 1～1000", secondary: true), stretch()]))
            if chapter == .three {
                body.addArrangedSubview(row([label("经验"), experienceField, label("倍 · 1～1000", secondary: true),
                    button("应用设置", #selector(applyFeatures)), stretch()]))
            } else {
                body.addArrangedSubview(row([button("应用设置", #selector(applyFeatures)), stretch()]))
            }
            bossToggle = toggle("Boss 指定掉落", key: "boss_drop_enabled")
            bossChoice = popup(bossCatalog.map { ($0["name"] as? String ?? "") + " · " + ($0["role"] as? String ?? "") },
                label: "Boss指定掉落物品", action: #selector(applyFeatures))
            if let index = bossCatalog.firstIndex(where: { $0["id"] as? String == extras["boss_drop_item"] as? String }) {
                bossChoice.selectItem(at: index)
            }
            body.addArrangedSubview(bossToggle)
            body.addArrangedSubview(bossChoice)
            body.addArrangedSubview(label("指定掉落替换 Boss 的普通掉落；任务和关卡奖励沿用游戏逻辑。", size: 12, secondary: true))
        case 1:
            strengthToggle = toggle("装备强化必成", key: "strength_guaranteed")
            body.addArrangedSubview(strengthToggle)
            if chapter == .two {
                fusionToggle = toggle("装备合成必成", key: "fusion_guaranteed")
                body.addArrangedSubview(fusionToggle)
                body.addArrangedSubview(label("仍需游戏要求的材料；开关只影响成功率。\n强化石请在「强化石与翅膀」中选择玩家后添加。", secondary: true))
                body.addArrangedSubview(button("关闭强化与合成修改", #selector(resetCraft)))
            } else {
                bestToggle = toggle("炼丹炉最高基础属性", key: "craft_max_attributes")
                body.addArrangedSubview(bestToggle)
                elementsChoice = popup(["随机五行", "金", "木", "水", "火", "土", "金 + 木", "金 + 水", "金 + 火", "金 + 土",
                    "木 + 水", "木 + 火", "木 + 土", "水 + 火", "水 + 土", "火 + 土"],
                    label: "法宝五行", action: #selector(applyFeatures))
                elementsChoice.selectItem(at: elementValues.firstIndex(of: extras["craft_elements"] as? String ?? "") ?? 0)
                body.addArrangedSubview(row([label("法宝五行"), elementsChoice, stretch()]))
                body.addArrangedSubview(label("仅影响炼丹炉制作、合成时生成的属性。\n仍需游戏要求的材料；已有装备不会自动改变。", secondary: true))
                body.addArrangedSubview(button("关闭强化与炼丹修改", #selector(resetCraft)))
            }
        default:
            let categories = Array(Set(itemCatalog.compactMap { $0["category"] as? String })).sorted()
            itemCategory = popup(categories, label: "物品分类", action: #selector(changeItemCategory))
            itemChoice = popup([], label: chapter == .two ? "强化石或翅膀修复" : "添加物品或宠物潜能",
                action: #selector(changeItem))
            amountField = smallField(1, label: "添加数量")
            refreshItemChoices()
            if chapter == .two {
                itemPlayer = popup(["玩家一", "玩家二"], label: "操作目标玩家", action: #selector(changePlayer))
                itemPlayer.selectItem(at: selectedPlayer - 1)
                body.addArrangedSubview(row([label("目标"), itemPlayer, label("分类"), itemCategory, stretch()]))
            } else {
                body.addArrangedSubview(row([label("分类"), itemCategory, stretch()]))
            }
            body.addArrangedSubview(itemChoice)
            body.addArrangedSubview(row([label("数量"), amountField,
                button(chapter == .two ? "执行一次" : "添加一次", #selector(addItem)), stretch()]))
            commandMessage = label(commandFeedback, size: 12, secondary: true)
            body.addArrangedSubview(commandMessage)
            let note = chapter == .two
                ? "强化石1～4级，每种最多999；选择实际在场的玩家。\n翅膀修复只把背包中放错位置的翅膀移回时装栏，不新增翅膀。"
                : "材料放入背包；潜能加给当前出战宠物（只有一只时选该宠物）。\n背包满或对象不明确时停止；结果不明时先检查游戏，避免重复添加。"
            body.addArrangedSubview(label(note, size: 12, secondary: true))
        }
        for view in body.arrangedSubviews { view.widthAnchor.constraint(equalTo: body.widthAnchor).isActive = true }
        body.heightAnchor.constraint(greaterThanOrEqualToConstant: 232).isActive = true
        status.font = .systemFont(ofSize: 12); status.textColor = muted
        status.setAccessibilityLabel("操作与接入结果")
        status.heightAnchor.constraint(equalToConstant: 38).isActive = true
        let stack = NSStackView(views: [heading, line(), attackRow,
            label(chapter == .two
                ? "仅本地角色 · 唐僧和影子回血不变 · 关闭助手后约 4 秒恢复开关与倍率"
                : "仅本地副本 · 唐僧回血和辅助不变 · 关闭助手后约 4 秒恢复开关与倍率", size: 12, secondary: true),
            status, navigation, body, line(),
            row([button("官方客户端", #selector(downloadClient)), button("官方游戏文件", #selector(downloadGame)), stretch()]),
            label("首次或更新后：保存并完全退出游戏，再接入。物品操作需自行在游戏里保存。\n新功能默认关闭；仅支持当前造梦\(chapter.rawValue) \(chapter.version)。", size: 12, secondary: true)])
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        for view in stack.arrangedSubviews { view.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true }
        NSLayoutConstraint.activate([
            chapters.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            chapters.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            chapters.topAnchor.constraint(equalTo: content.topAnchor),
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 30),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -30),
            stack.topAnchor.constraint(equalTo: chapters.bottomAnchor, constant: 22),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -20)
        ])
    }

    @objc private func selectFeature(_ sender: NSSegmentedControl) {
        guard saveFeatures() else { sender.selectedSegment = featurePage; return }
        featurePage = sender.selectedSegment
        buildInterface(); tick()
    }

    @discardableResult private func saveFeatures() -> Bool {
        guard chapter.hasExtendedFeatures else { return true }
        if featurePage == 0 {
            func integer(_ field: NSTextField) -> Int? {
                let text = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty, text.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }),
                      let value = Int(text), (1...1000).contains(value) else { return nil }
                return value
            }
            guard let drop = integer(dropField) else {
                show("爆率倍率请输入 1～1000 的整数。"); return false
            }
            if chapter == .three {
                guard let experience = integer(experienceField) else {
                    show("经验倍率请输入 1～1000 的整数。"); return false
                }
                extras["experience_multiplier"] = experience
            }
            extras["mode"] = ["original", "multiplier", "guaranteed"][max(0, featureMode.indexOfSelectedItem)]
            extras["multiplier"] = drop
            extras["boss_drop_enabled"] = bossToggle.state == .on
            let index = bossChoice.indexOfSelectedItem
            extras["boss_drop_item"] = bossCatalog.indices.contains(index) ? bossCatalog[index]["id"] : ""
        } else if featurePage == 1 {
            extras["strength_guaranteed"] = strengthToggle.state == .on
            if chapter == .two {
                extras["fusion_guaranteed"] = fusionToggle.state == .on
            } else {
                extras["craft_max_attributes"] = bestToggle.state == .on
                extras["craft_elements"] = elementValues[max(0, elementsChoice.indexOfSelectedItem)]
            }
        }
        do { try writeSettings(); return true }
        catch { show("保存设置失败：\(error.localizedDescription)"); return false }
    }

    @objc private func applyFeatures() {
        if saveFeatures() { show("造梦\(chapter.rawValue)设置已应用。") }
    }

    @objc private func resetCraft() {
        strengthToggle.state = .off
        if chapter == .two { fusionToggle.state = .off }
        else { bestToggle.state = .off; elementsChoice.selectItem(at: 0) }
        applyFeatures()
    }

    private func refreshItemChoices() {
        let category = itemCategory.titleOfSelectedItem ?? ""
        visibleItems = itemCatalog.filter { $0["category"] as? String == category }
        itemChoice.removeAllItems()
        itemChoice.addItems(withTitles: visibleItems.map { $0["name"] as? String ?? "" })
        changeItem()
    }

    @objc private func changeItemCategory() { refreshItemChoices() }
    @objc private func changeItem() {
        let index = itemChoice.indexOfSelectedItem
        amountField.stringValue = String(visibleItems.indices.contains(index) ? (visibleItems[index]["default_amount"] as? Int ?? 1) : 1)
        amountField.isEnabled = !(visibleItems.indices.contains(index) && visibleItems[index]["kind"] as? String == "repair")
    }

    @objc private func changePlayer() { selectedPlayer = max(1, itemPlayer.indexOfSelectedItem + 1) }

    private func freshStatus(for chapter: GameChapter) -> [String: Any]? {
        guard let game = runningGame(),
              let data = try? Data(contentsOf: support.appendingPathComponent(chapter.statusFile)),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              value["protocol"] as? String == chapter.protocolName,
              (value["pid"] as? NSNumber)?.int32Value == game.processIdentifier,
              let updated = value["updated_at"] as? Double,
              abs(Date().timeIntervalSince1970 * 1000 - updated) < 2500 else { return nil }
        return value
    }

    @objc private func addItem() {
        guard pendingCommand == nil else { show("上次添加尚未返回，请先等待结果。"); return }
        guard let state = freshStatus(for: chapter), state["patched_loaded"] as? Bool == true,
              state["command_ready"] as? Bool == true, let game = runningGame() else {
            show("物品接口尚未就绪。请保存并退出游戏，接入新版后再试。"); return
        }
        let index = itemChoice.indexOfSelectedItem
        guard visibleItems.indices.contains(index) else { show("请先选择物品。"); return }
        let item = visibleItems[index]
        let text = amountField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }),
              let amount = Int(text), amount > 0, amount <= (item["max_amount"] as? Int ?? 1),
              let id = item["id"] as? String else {
            show("数量请输入 1～\(item["max_amount"] as? Int ?? 1) 的整数。"); return
        }
        let kind = item["kind"] as? String
        let action = kind == "pet" ? "pet_potential" : (kind == "repair" ? "repair_wings" : "add_item")
        pendingCommand = ["id": UUID().uuidString, "action": action,
            "item": id, "amount": amount, "created_at": Date().timeIntervalSince1970 * 1000,
            "client_pid": game.processIdentifier]
        if chapter == .two { pendingCommand?["player"] = selectedPlayer }
        commandFeedback = "请求已发送，等待游戏回执…"
        commandMessage.stringValue = commandFeedback
        do { try writeSettings() }
        catch {
            pendingCommand = nil
            commandFeedback = "请求写入失败，结果不明；请先检查游戏后再决定是否添加。"
            commandMessage.stringValue = commandFeedback
            show("请求写入失败：\(error.localizedDescription)")
        }
    }

    private func updateCommandReceipt() {
        for target in [GameChapter.two, .three] {
            guard let command = pendingCommands[target], let id = command["id"] as? String else { continue }
            if let value = freshStatus(for: target), let result = value["command_result"] as? [String: Any],
               result["id"] as? String == id, let state = result["state"] as? String, state != "processing" {
                let messages = ["not_ready": "玩家或宠物尚未就绪", "busy": "请先完成游戏中的交易或物品操作",
                    "full": "背包空间不足", "missing": "物品或宠物未找到", "duplicate_stack": "存在重复物品堆叠，请先整理背包",
                    "limit": "数量已达上限", "invalid": "请求参数无效", "unknown": "结果不明，请检查游戏，避免重复操作"]
                if state == "ok" {
                    let added = (result["added"] as? NSNumber)?.intValue ?? 0
                    let total = (result["total"] as? NSNumber)?.intValue ?? 0
                    commandFeedbacks[target] = command["action"] as? String == "repair_wings"
                        ? "已修复 \(added) 件，时装栏当前 \(total) 件。请在游戏中自行保存。"
                        : "已添加 \(added)，当前 \(total)。请在游戏中自行保存。"
                } else { commandFeedbacks[target] = messages[state] ?? "请求未完成，请检查游戏。" }
                pendingCommands[target] = nil
            } else if let created = command["created_at"] as? Double,
                      Date().timeIntervalSince1970 * 1000 - created > 16000 {
                pendingCommands[target] = nil
                commandFeedbacks[target] = "未收到回执，结果不明。请先检查游戏，不会自动重试。"
            }
        }
        if chapter.hasExtendedFeatures { commandMessage.stringValue = commandFeedback }
    }

    private func makeMenu() {
        let menu = NSMenu()
        let item = NSMenuItem()
        menu.addItem(item)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "退出造梦西游攻击助手", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
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

    private func button(_ title: String, _ action: Selector) -> HelperButton {
        let value = HelperButton(title: title, target: self, action: action)
        value.bezelStyle = .regularSquare
        value.isBordered = false
        value.controlSize = .large
        value.font = .systemFont(ofSize: 14, weight: .medium)
        return value
    }

    private func writeSettings(expired: Bool = false) throws {
        try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        for game in GameChapter.allCases {
            var value: [String: Any] = ["protocol": game.protocolName, "game": game.game,
                "attack_multiplier": expired ? 1 : (multipliers[game] ?? 1),
                "updated_at": expired ? 0 : Date().timeIntervalSince1970 * 1000]
            if game.hasExtendedFeatures && !expired {
                value.merge(featureSettings[game] ?? [:]) { _, new in new }
                if let command = pendingCommands[game] { value["command"] = command }
            }
            try JSONSerialization.data(withJSONObject: value)
                .write(to: support.appendingPathComponent(game.settingsFile), options: .atomic)
        }
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
        do { try writeSettings(); show("已设置 \(value) 倍。") }
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
        for name in ["bridge.cjs", "attack.cjs", "zm2-items.json", "boss-items-zm2.json", "zm3-items.json", "boss-items-zm3.json"] {
            let source = Bundle.main.resourceURL!.appendingPathComponent(name)
            try Data(contentsOf: source).write(to: support.appendingPathComponent(name), options: .atomic)
        }
        try patch.write(to: support.appendingPathComponent(chapter.patchFile), options: .atomic)
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
        let targetChapter = chapter
        do {
            if runningGame() != nil {
                show("请保存并完全退出游戏，再点击接入，以便更新客户端名称和模块。"); return
            }
            try prepareClient(); try install(); try signClient(); try writeSettings()
            NSWorkspace.shared.openApplication(at: client, configuration: NSWorkspace.OpenConfiguration()) { [weak self] _, error in
                DispatchQueue.main.async {
                    self?.show(error.map { "打开失败：\($0.localizedDescription)" } ?? "客户端已打开，请进入造梦西游\(targetChapter.rawValue)。")
                }
            }
        } catch { show("接入失败：\(error.localizedDescription)") }
    }

    private func localPatch() throws -> Data {
        let recipe = try JSONDecoder().decode(PatchRecipe.self,
            from: Data(contentsOf: Bundle.main.url(forResource: chapter.recipe, withExtension: "json")!))
        func verified(_ url: URL) -> Data? {
            guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
                  size > 0, size < 32_000_000, let data = try? Data(contentsOf: url) else { return nil }
            return try? recipe.apply(data)
        }
        for url in [support.appendingPathComponent(chapter.patchFile),
                    Bundle.main.resourceURL!.appendingPathComponent(chapter.patchFile)] {
            if let data = verified(url) { return data }
        }
        let panel = NSOpenPanel()
        panel.title = "选择造梦\(chapter.rawValue) \(chapter.version)游戏文件"
        panel.message = "请选择从官方自行下载的 \(chapter.filename).swf。助手只在本机生成补丁；已有此版补丁也可使用。"
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else {
            throw NSError(domain: "ZMXY", code: 1, userInfo: [NSLocalizedDescriptionKey: "已取消选择本地补丁。"])
        }
        guard let data = verified(url) else {
            throw NSError(domain: "ZMXY", code: 2, userInfo: [NSLocalizedDescriptionKey: "补丁校验不符，请使用造梦\(chapter.rawValue) \(chapter.version)官方文件。"])
        }
        return data
    }

    @objc private func downloadClient() {
        NSWorkspace.shared.open(URL(string: "https://webres.61.com/common/flash/common_micro.html?game=mole")!)
    }

    @objc private func downloadGame() {
        if let downloading = downloadingChapter {
            show("正在下载造梦\(downloading.rawValue)游戏文件，请稍候。")
            messageUntil = .distantFuture
            return
        }
        let chapter = self.chapter
        let panel = NSSavePanel()
        panel.title = "从4399官方保存造梦\(chapter.rawValue) \(chapter.version) 原始游戏文件"
        panel.nameFieldStringValue = chapter.filename + ".swf"
        panel.allowedContentTypes = [UTType(filenameExtension: "swf") ?? .data]
        guard panel.runModal() == .OK, let destination = panel.url else { return }
        downloadingChapter = chapter
        show("正在从4399官方源下载并校验游戏文件…")
        messageUntil = .distantFuture
        var request = URLRequest(url: URL(string: chapter.gameURL)!)
        request.setValue(chapter.referer, forHTTPHeaderField: "Referer")
        request.timeoutInterval = 60
        URLSession.shared.downloadTask(with: request) { [weak self] file, response, error in
            let result: Result<Void, Error> = Result {
                if let error = error { throw error }
                guard (response as? HTTPURLResponse)?.statusCode == 200, let file = file,
                      let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize,
                      size > 0, size < 32_000_000 else { throw PatchRecipe.invalid() }
                let data = try Data(contentsOf: file)
                let recipe = try JSONDecoder().decode(PatchRecipe.self,
                    from: Data(contentsOf: Bundle.main.url(forResource: chapter.recipe, withExtension: "json")!))
                let original = try PatchRecipe.unpack(data)
                guard PatchRecipe.hash(original) == recipe.sourceHash else { throw PatchRecipe.invalid() }
                try data.write(to: destination, options: .atomic)
            }
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.downloadingChapter = nil
                switch result {
                case .success: self.show("造梦\(chapter.rawValue)官方游戏文件已保存。接入时选择该文件即可。")
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
        updateCommandReceipt()
        let game = runningGame()
        connection.stringValue = game == nil ? "游戏未打开" : "客户端运行中"
        guard Date() > messageUntil else { return }
        guard let game = game else { status.stringValue = "游戏客户端未打开。"; return }
        guard let data = try? Data(contentsOf: support.appendingPathComponent(chapter.statusFile)),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              value["protocol"] as? String == proto,
              (value["pid"] as? NSNumber)?.int32Value == game.processIdentifier,
              let updated = value["updated_at"] as? Double,
              abs(Date().timeIntervalSince1970 * 1000 - updated) < 2500 else {
            status.stringValue = "客户端尚未接入此版本。请点击接入，保存后重开游戏。"; return
        }
        if let error = value["error"] as? String, !error.isEmpty { status.stringValue = error; return }
        guard value["patched_loaded"] as? Bool == true else {
            status.stringValue = "已连接客户端，请进入造梦西游\(chapter.rawValue)（当前补丁适配 \(chapter.version)）。"; return
        }
        if let base = value["base_attack"] as? Double, let power = value["effective_attack"] as? Double {
            status.stringValue = String(format: "已接入 · 当前 %lld 倍 · 最近伤害 %.0f → %.0f", multiplier, base, power)
        } else { status.stringValue = "造梦西游\(chapter.rawValue)已接入 · 当前 \(multiplier) 倍，等待战斗伤害。" }
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
