# Changelog

All notable changes to **`antigravity-context-monitor`** are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-11-25

### Fixed
- **Eliminated `events/` Disk Bloat (`0 B` sidecar events)**: Removed background `agentapi get-conversation-metadata` CLI fallback polling from `main.mjs`. In `v0.2.0`, polling untitled/subagent conversations every 15s caused Antigravity's `agentapi` runner to log full `conversationMetadata` JSON payloads (up to ~200 KB per subagent call) into `<sidecar_data>/events/`, growing to gigabytes over days. Title resolution now runs 100% locally via `annotations/*.pbtxt`, read-only `conversation_summaries.db`, and `transcript.jsonl` previews with zero subprocess spawns.
  - *Upgrading from `v0.2.0`*: You can safely delete legacy event logs with `rm -rf ~/.gemini/antigravity/sidecar_data/context-monitor/context_monitor/events`.
- **Subagent Active-Session Protection (`titles.mjs`, `main.mjs`)**: Reads `parent_conversation_id` and `nesting_depth` from `conversation_summaries.db` so background `browser` / `research` subagents no longer hijack the HUD from the active user conversation or clutter the recent-session picker (global history totals still include all Desktop + CLI transcripts).
- **SQLite Read-Only Robustness (`titles.mjs`)**: Added `{ readOnly: true, timeout: 1000 }` and switched fallback SQL to standard single-quoted `WHERE title != ''`, while preserving cached entries on transient lock errors.
- **Idle Repaint & Cache Eviction Hardening (`hud_bar.swift`, `main.mjs`, `history.mjs`, `titles.mjs`)**: Avoided redundant 4 Hz `layoutCapsuleSubviews()` / `needsDisplay` redraws in `hud_bar.swift` when window bounds and metrics are unchanged, and replaced full-map `.clear()` calls with incremental FIFO eviction.

## [0.2.0] - 2026-11-16

### Added / Changed
- **First Token Latency (`Avg / Last TTFT` via `ttft.mjs`)**: Decodes `CortexStepMetadata` timestamps (`created_at` → `viewable_at`, matching Antigravity's internal `time_to_first_token`) read-only from `<appData>/conversations/<conversationId>.db`, exposing both session-average and latest-step TTFT across the native macOS `Session` popover, hover tooltips, copied report, Aux Pane header strip + `Overview` card, and per-step `Steps` cards.
- **Live Conversation Title Resolution (`titles.mjs`)**: Reads Antigravity's real-time `<appData>/annotations/<conversationId>.pbtxt` (`title:"..."`, including UTF-8 octal CJK/Unicode decoding) and optional read-only `conversation_summaries.db` fallback with instant `mtime` invalidation and a 15s fallback TTL, so auto-generated and renamed session titles stay in sync everywhere instead of remaining stuck on the first user prompt.
- **End-to-End Speed Visibility (`Avg / Last tok/s`)**: Display both session average (`avgTokPerSec`) and latest timed step (`lastTokPerSec`) speed across the floating capsule (`Compact` & `Full`), hover tooltips, native `Session` popover card, Aux Pane header strip, and a dedicated **Output Speed** + **Est. API Cost** card pair in the Aux Pane `Overview` tab, explicitly labeled as end-to-end throughput.
- **Compaction-Aware `Auto` Context Limit (`256K` Default)**: Replaced the static `1M` default with an `Auto` context ceiling (`windowLimit = 0`, `prefsVersion = 2`) that defaults to Antigravity's `256K` flagship auto-compaction limit instead of overestimating headroom by 4×.
- **Empirical + Model Resolution**: Combines `CHECKPOINT` pre-compaction peak telemetry (`observedCompactionTokens`), public model hints (`80K` / `128K` / `256K` / `840K`), and overflow promotion, while adding explicit `256K` and `512K` presets (`Auto / 128K / 200K / 256K / 512K / 1M / 2M`) across both the native macOS HUD and Aux Pane Web UI.

## [0.1.0] - 2026-11-14

### Added
- **Read-Only Telemetry Core (`metrics.mjs`)**: Parses `transcript.jsonl` `PLANNER_RESPONSE` entries for uncached input, cache read hits, output tokens, generation throughput (`tok/s`), compaction checkpoints, per-turn consumption, and per-tool context overhead estimation.
- **Cross-Session Global History (`history.mjs`)**: Aggregates Antigravity Desktop and Antigravity CLI usage across `Today`, `Last 7 Days`, `This Month`, and `All Time` alongside an 84-day (12-week) activity heatmap and reference API cost calculator.
- **Native macOS HUD (`hud_bar.swift`)**:
  - Top-right titlebar floating capsule (`Compact`, `Full Bar`, and `Minimal` auto-responsive densities) with drag-offset persistence, `Bottom Center` / `Bottom Right` dock modes, and macOS menu bar indicator.
  - Native 3-tab `NSPopover` (`Session`, `History`, `Settings`) with instant `English` / `中文` switching and recent-session picker.
  - First-run SHA-256 cached `swiftc` auto-compilation and `--self-test` gate in `main.mjs`.
- **Cross-Platform Auxiliary Pane Dashboard (`index.html`, `styles.css`, `app.js`)**: Responsive web UI with `Overview`, `History`, `Steps`, `Tools`, and `Raw` views, automatically hiding macOS-only HUD controls when `hudSupported === false`.
- **Active Session Hook (`hooks/track_active.sh`)**: Lightweight atomic hook writing `active_hook.json` across both default plugin state dir and `ANTIGRAVITY_EXECUTABLE_DATA_DIR` when present.
- **Security & Robustness**:
  - Per-launch `CONTEXT_MONITOR_HUD_TOKEN` verification on `/api/hud`.
  - `/api/usage` active-session fallback when `conversationId` is omitted.
  - Minimum `560×400` main window filter so small child popups do not steal the titlebar capsule.
- **Documentation, Tests & CI**: Bilingual `README.md` / `README.zh-CN.md` with sanitized screenshots (`docs/images/`), `CONTRIBUTING.md`, `node:test` suite (`metrics.test.mjs`), universal macOS build script (`scripts/build-hud-universal.sh`), and `.github` / `.gitea` CI workflows.
