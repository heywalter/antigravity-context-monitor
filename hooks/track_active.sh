#!/bin/sh
# Records the active Antigravity conversation hook payload atomically for context-monitor.
PAYLOAD="$(cat 2>/dev/null || true)"

write_hook_target() {
  TARGET_DIR="$1"
  [ -n "$TARGET_DIR" ] || return 0
  mkdir -p "$TARGET_DIR" 2>/dev/null || return 0
  TMP_FILE="$TARGET_DIR/.active_hook.$$.tmp"
  if printf '%s\n' "$PAYLOAD" > "$TMP_FILE" 2>/dev/null; then
    mv -f "$TMP_FILE" "$TARGET_DIR/active_hook.json" 2>/dev/null || rm -f "$TMP_FILE" 2>/dev/null
  fi
}

STATE_DIR="$HOME/.gemini/antigravity/sidecar_data/context-monitor/context_monitor"
write_hook_target "$STATE_DIR"

if [ -n "${ANTIGRAVITY_EXECUTABLE_DATA_DIR:-}" ] && [ "$ANTIGRAVITY_EXECUTABLE_DATA_DIR" != "$STATE_DIR" ]; then
  write_hook_target "$ANTIGRAVITY_EXECUTABLE_DATA_DIR"
fi

printf '{}\n'
exit 0
