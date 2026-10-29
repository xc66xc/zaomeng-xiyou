# 造梦西游5攻击倍率助手

macOS 原生攻击倍率控制面板，仅支持造梦西游5。目前适配 V47.8，软件版本以 `zm5-only/Info.plist` 为准。支持角色、宠物及幻兽的单人副本普通/技能伤害；不包含录制、自动操作及其他章节。退出助手后约4秒恢复原倍率。

## 使用与构建

需要 Apple Silicon Mac、macOS 12+、Xcode Command Line Tools，以及自己安装的兼容 Electron/Flash 游戏客户端。当前客户端路径为 `/Applications/摩尔庄园.app`，未打包在本仓库。首次接入前保存进度并完全退出客户端；打开助手点击「接入并打开游戏」，进入造梦5后输入正整数倍率并应用，1倍还原。

本仓库不分发游戏、原始或修改后的 SWF、客户端和反编译结果。构建需要自行准备本地 V47.8 补丁文件：

```sh
ZMXY_PATCH_PATH=/absolute/path/to/patched-zm5.swf zsh zm5-only/build.sh
```

输出项目根目录 `造梦西游爆率助手.app`。只完成本地 ad-hoc 签名，未做 Apple Developer ID 签名或公证；本机构建仅验证 arm64，不能据此声称兼容 Intel。

可使用自备 JPEXS FFDec 和 Java 生成补丁。将自行取得的原始游戏保存为本地工作目录的 `original.swf`，导出 XML 和指定类 P-code，再运行补丁脚本：

```sh
export FFDEC_JAR=/absolute/path/to/ffdec.jar
export ZMXY_PATCH_WORKDIR=/absolute/path/to/local/workdir
java -jar "$FFDEC_JAR" -swf2xml "$ZMXY_PATCH_WORKDIR/original.swf" "$ZMXY_PATCH_WORKDIR/original.xml"
java -jar "$FFDEC_JAR" -selectclass prefabs.controls.DamageControl -format script:pcode -export script "$ZMXY_PATCH_WORKDIR/pcode" "$ZMXY_PATCH_WORKDIR/original.swf"
python3 tools/build_patch.py
```

输出 `release.swf`。补丁只为已核对的 V47.8 伤害位置设计，不保证未来游戏版本兼容；更新后必须重新核对原始代码及补丁差异。

## 验证与协作

```sh
node --test zm5-only/attack.test.cjs
swiftc -typecheck zm5-only/main.swift -framework AppKit
```

CI 验证倍率边界、过期还原、协议、章节隔离、精确资源拦截、复制粘贴快捷键和 Swift 编译。在线账号实际战斗结果需另行验证，CI 不模拟完整游戏。

从最新 main 创建 `feat/*`、`fix/*`、`docs/*` 或 `chore/*` 短期分支；外部贡献使用 Fork + PR。通过验证后提交具体意图的 commit，PR 使用 Squash merge。软件升级沿用 manifest 版本，发布使用匹配的 annotated `vX.Y.Z` Tag；不因普通源码提交自动升级软件版本。

配置每秒写一次，客户端每秒轮询两次，预期生效延迟主要受500ms轮询和调度影响。伤害回调执行常数次判断和乘法；不截图、不监听输入，不新增持续外部服务调用。实际战斗性能和峰值内存未基准测试。

## 许可

MIT 只覆盖本仓库自写代码，见 LICENSE。第三方游戏及相关资源不属于该授权范围，需自行确保相应使用权限。不要上传账号、存档、截图、客户端或第三方游戏文件。
