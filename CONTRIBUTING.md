# Contributing to `antigravity-context-monitor`

Thank you for helping improve **`antigravity-context-monitor`**! Before opening an issue or pull request, please review the architectural principles and local verification checks below.

---

## Architecture Invariants (Strict)

1. **100% Read-Only Telemetry**: Never mutate conversation logs, send agent messages, or inject hidden prompt tokens / extra LLM calls. All telemetry comes strictly from Antigravity's local `transcript.jsonl` files, `annotations/*.pbtxt`, read-only SQLite (`conversations/<id>.db`), and lightweight metadata read calls (see [SECURITY.md](./SECURITY.md)).
2. **Zero Client Patching**: Never modify files inside `Antigravity.app`, never bypass code signing, and never require enabling remote debugging (`--remote-debugging-port` / CDP injection).
3. **Zero External Runtime Dependencies**: Keep `sidecars/context_monitor` dependency-free beyond Node.js built-in modules (`node:*`), `sidecar_sdk`, and standard macOS system frameworks (`Cocoa`, `CoreGraphics`) for `hud_bar.swift`.
4. **No Compiled Binaries in Git**: Do not commit compiled `hud_bar` binaries, `dist/` outputs, or `.DS_Store` files. macOS users build automatically on first startup via `swiftc`, or build locally via `./scripts/build-hud-universal.sh`.
5. **Cross-Platform Graceful Degradation**: The Auxiliary Pane web dashboard (`index.html`, `styles.css`, `app.js`, `main.mjs`) must work on macOS, Linux, and Windows, hiding macOS-only HUD controls when `hudSupported === false`.

---

## Development Setup

Clone into your working tree or directly symlink/copy into `~/.gemini/config/plugins/context-monitor`:

```bash
git clone https://github.com/heywalter/antigravity-context-monitor.git
cd antigravity-context-monitor
```

Key files:
- `plugin.json` & `hooks.json` — Official Antigravity plugin & hook manifests
- `hooks/track_active.sh` — POSIX shell hook tracking active conversation & model metadata
- `sidecars/context_monitor/main.mjs` — Sidecar HTTP/API server and macOS HUD supervisor
- `sidecars/context_monitor/prefs.mjs` — Pure HUD preference normalization & platform capability helpers
- `sidecars/context_monitor/titles.mjs` — Live conversation title resolver (`annotations/*.pbtxt` + optional `conversation_summaries.db` fallback)
- `sidecars/context_monitor/ttft.mjs` — Read-only protobuf + optional SQLite step TTFT (`time_to_first_token`) extractor from `<appData>/conversations/<conv>.db`
- `sidecars/context_monitor/metrics.mjs` — Streaming-safe `transcript.jsonl` step parser
- `sidecars/context_monitor/history.mjs` — Cross-session Desktop + CLI aggregator & 84-day heatmap builder
- `sidecars/context_monitor/index.html`, `styles.css`, `app.js` — Cross-platform Auxiliary Pane Web UI
- `sidecars/context_monitor/hud_bar.swift` — AppKit titlebar floating capsule, menu bar item & 3-tab `NSPopover`

---

## Verification Checklist Before Submitting

Run all checks locally before pushing:

```bash
# 1. Validate shell hook syntax
sh -n hooks/track_active.sh

# 2. Syntax check all JavaScript / ESM files
cd sidecars/context_monitor
node --check main.mjs && node --check prefs.mjs && node --check titles.mjs && node --check ttft.mjs && node --check metrics.mjs && node --check history.mjs && node --check app.js

# 3. Run unit tests (node:test)
npm test

# 4. Validate plugin manifest & hooks with Antigravity CLI (if installed)
cd ../..
agy plugin validate .

# 5. Build & self-test macOS Universal Binary (on macOS)
./scripts/build-hud-universal.sh
rm -rf dist
```

---

## Privacy & Fixture Hygiene

All test fixtures, sample JSON payloads, CI logs, and screenshots committed to this repository must use synthetic UUIDs, generic session titles, and public model names — never personal home paths (`/Users/...`), real conversation IDs, internal model codenames, or private prompts.
