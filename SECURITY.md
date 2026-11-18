# Security Policy

`antigravity-context-monitor` is designed around a **100% read-only, local-only, zero-injection** architecture. Because it inspects Antigravity telemetry locally, keeping the trust boundary minimal and transparent is a top priority.

---

## Core Security Invariants

1. **Zero Client Binary Patching**: Never modifies `/Applications/Antigravity.app` or any installed Antigravity binaries, preserving official code signatures and updates.
2. **Zero CDP / Remote Debugging**: Never requires `--remote-debugging-port` or Chromium DevTools Protocol DOM/script injection.
3. **Zero Prompt / Model Interference**: Never sends extra LLM requests, never injects hidden prompt tokens, and never mutates active conversations (`"allows_user_interactions": false`).
4. **Zero Outbound Network Calls**: All HTTP endpoints (`/api/usage`, `/api/history`, `/api/hud`, `/api/hud/prefs`) are served strictly on `127.0.0.1` via Antigravity's official `sidecar_sdk`. No telemetry ever leaves your machine.
5. **Minimal Local Data Access**:
   - Reads local `transcript.jsonl`, `annotations/*.pbtxt`, and read-only SQLite databases (`conversations/<id>.db`, optional `conversation_summaries.db`).
   - Writes only its own hook pointer (`active_hook.json`) and HUD preferences (`hud_prefs.json`) inside the plugin's dedicated `sidecar_data/context-monitor/context_monitor/` directory.

---

## Defense-in-Depth Controls

- **Authenticated `/api/hud` Loopback Channel**: On launch, `main.mjs` generates a fresh random 128-bit hex token (`CONTEXT_MONITOR_HUD_TOKEN`) and passes it only to the spawned `hud_bar` child process via environment variables (`hudToken` / `X-Context-Monitor-Token`). Unauthenticated requests to `/api/hud` receive HTTP `401`.
- **Strict Path-Traversal Guard**: Every `conversationId` received from query parameters, hook payloads, or URL state is validated against `ID_RE` (`^[0-9a-f-]{8,}$`) before joining any local file or SQLite path.
- **Read-Only SQLite Handles**: `conversations/<id>.db` and `conversation_summaries.db` are always opened with `{ readOnly: true }`, preventing schema or journal mutation against Antigravity's live databases.
- **No Unverified Native Binaries in Git**: On macOS, `hud_bar` is compiled locally from auditable source ([`hud_bar.swift`](./sidecars/context_monitor/hud_bar.swift)) via Apple's `swiftc`, SHA-256 cached, and gated by `--self-test`.

---

## Reporting a Vulnerability

If you discover a security issue (for example: path traversal, local token bypass, shell injection in hooks, or unintended filesystem writes):

1. **Do not** include personal paths, real `conversationId` directories, or raw `transcript.jsonl` / `.db` captures in public reports.
2. Open an issue at [github.com/heywalter/antigravity-context-monitor/issues](https://github.com/heywalter/antigravity-context-monitor/issues) or contact the maintainer with a minimal reproduction payload and affected version (`plugin.json` `version`).
3. Security fixes will prioritize maintaining zero client modification and full backward compatibility across Antigravity Desktop and CLI.
