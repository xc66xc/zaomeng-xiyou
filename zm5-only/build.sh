#!/bin/zsh
set -euo pipefail
source_dir=$(cd "$(dirname "$0")" && pwd)
project_dir=$(dirname "$source_dir")
app_dir=${1:-"$project_dir/造梦西游爆率助手.app"}
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
build_dir=$(mktemp -d /tmp/zmxy-build.XXXXXX)
trap 'rm -rf "$build_dir"' EXIT
xcrun clang -target arm64-apple-macos12.0 -c "$source_dir/PatchDecoder.c" -o "$build_dir/PatchDecoder.o"
swiftc -import-objc-header "$source_dir/PatchDecoder.h" "$source_dir/PatchEngine.swift" "$build_dir/PatchDecoder.o" -lz -llzma -target arm64-apple-macos12.0 "$source_dir/main.swift" -o "$app_dir/Contents/MacOS/DropControl" -framework AppKit
cp "$source_dir/patch-v4780.json" "$source_dir/patch-v5880.json" "$source_dir/bridge.cjs" "$source_dir/attack.cjs" "$app_dir/Contents/Resources/"
if [[ ${ZMXY_PACKAGE_WITHOUT_GAME:-0} == 1 ]]; then
  rm -f "$app_dir/Contents/Resources/patched-zm4.swf" "$app_dir/Contents/Resources/patched-zm5.swf"
else
  patch_path=${ZMXY_PATCH_PATH:-"$project_dir/research/zm5-v4780/release.swf"}
  if [[ ! -f "$patch_path" ]]; then
    print -u2 "Set ZMXY_PATCH_PATH or use ZMXY_PACKAGE_WITHOUT_GAME=1."
    exit 1
  fi
  cp "$patch_path" "$app_dir/Contents/Resources/patched-zm5.swf"
fi
cp "$source_dir/Info.plist" "$app_dir/Contents/Info.plist"
codesign --force --sign - "$app_dir"
codesign --verify --strict "$app_dir"
