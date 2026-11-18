#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT_DIR/sidecars/context_monitor/hud_bar.swift"
OUT_DIR="$ROOT_DIR/dist"
ARM_BIN="$OUT_DIR/hud_bar-arm64"
X64_BIN="$OUT_DIR/hud_bar-x86_64"
UNI_BIN="$OUT_DIR/hud_bar"

mkdir -p "$OUT_DIR"
rm -f "$ARM_BIN" "$X64_BIN" "$UNI_BIN"

swiftc -O -target arm64-apple-macosx13.0 -o "$ARM_BIN" "$SRC" -framework Cocoa -framework CoreGraphics
swiftc -O -target x86_64-apple-macosx13.0 -o "$X64_BIN" "$SRC" -framework Cocoa -framework CoreGraphics
lipo -create -output "$UNI_BIN" "$ARM_BIN" "$X64_BIN"
chmod 755 "$UNI_BIN"
rm -f "$ARM_BIN" "$X64_BIN"

"$UNI_BIN" --self-test
echo "Universal binary built at dist/hud_bar"
