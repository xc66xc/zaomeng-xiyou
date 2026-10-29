#!/bin/zsh
set -euo pipefail
source_dir=$(cd "$(dirname "$0")" && pwd)
project_dir=$(dirname "$source_dir")
app_dir=${1:-"$project_dir/造梦西游爆率助手.app"}
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
swiftc -target arm64-apple-macos12.0 "$source_dir/main.swift" -o "$app_dir/Contents/MacOS/DropControl" -framework AppKit
cp "$source_dir/bridge.cjs" "$source_dir/attack.cjs" "$app_dir/Contents/Resources/"
patch_path=${ZMXY_PATCH_PATH:-"$project_dir/research/zm5-v4780/release.swf"}
if [[ ! -f "$patch_path" ]]; then
  print -u2 "Set ZMXY_PATCH_PATH to your local patched V47.8 SWF."
  exit 1
fi
cp "$patch_path" "$app_dir/Contents/Resources/patched-zm5.swf"
cp "$source_dir/Info.plist" "$app_dir/Contents/Info.plist"
codesign --force --sign - "$app_dir"
codesign --verify --strict "$app_dir"
