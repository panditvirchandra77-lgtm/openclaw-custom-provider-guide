# 🦋 OpenClaw Custom Model Provider — Complete Setup Guide

One-click pipeline to add any OpenAI-compatible model provider to OpenClaw — via script, or via a zero-dependency web dashboard that tests keys live, writes config, adds allowlist, and restarts the gateway automatically.

Built & battle-tested on OpenClaw 2026.7.35 (2026-09-28).

---

## 📦 What's in this repo

| File | What it is |
|---|---|
| `custom-provider-playbook.md` | Step-by-step manual process (the "why" behind everything) |
| `add-provider.sh` | One-click CLI script — backup, live key test, config write, wildcard allowlist |
| `dashboard/server.js` | Zero-npm-deps Node web dashboard (port 8332) with auto gateway restart |
| `dashboard/start.sh` | Dashboard launcher |

---

## 🚀 Method 1: One-click script

```bash
bash ~/add-provider.sh <name> <baseUrl> <apiKey> <modelId> [ctxWindow] [maxTokens]
```

**Example:**
```bash
bash ~/add-provider.sh foo https://api.foo.com/v1 sk-xxx foo-model 200000 8192
```

**What it does automatically:**
1. 💾 Backs up `~/.openclaw/openclaw.json` (timestamped `.bak-` file)
2. 🔑 **Live-tests the key** — real `chat/completions` call ("Say OK"). Fail → abort, config untouched
3. 📋 Scans the provider's `/models` catalog (if available)
4. ✍️ Writes provider block via `jq` (JSON-validated, atomic temp+rename), with `timeoutSeconds: 300`
5. 🃏 Adds `<name>/*` wildcard to `agents.defaults.models` allowlist
6. ✅ Verifies and prints result

Then: `/model <name>/<modelId>` in OpenClaw chat.

---

## 🖥️ Method 2: Web dashboard

```bash
cd dashboard && bash start.sh
# → http://<host>:8332
```

**Endpoints:**
- `GET /` — UI (dark theme, Glasswing-branded 😄)
- `GET /api/status` — gateway health, providers in both files, key-mismatch detection
- `GET /api/providers` — both configs side-by-side (keys masked)
- `POST /api/test` — live key/model test only (no writes)
- `POST /api/add` — **full pipeline**: pre-flight live test → write BOTH `~/.openclaw/openclaw.json` and `~/.openclaw/agents/main/agent/models.json` → wildcard allowlist → **automatic `openclaw gateway restart`** → health check
- `POST /api/remove` — removes provider from both files **+ cleans allowlist entry** → auto restart
- `GET /api/log` — last 120 log lines

**Fill the form → Submit → `/model <provider>/<model>` ready. Zero manual steps.**

### Why write to BOTH config files?
OpenClaw reads providers from `openclaw.json` (gateway) and from the agent's own `models.json`. Writing only one causes "key mismatch" / "not allowed" errors. The dashboard syncs both + detects mismatches in `/api/status`.

### Why wildcard allowlist?
`agents.defaults.models` is an allowlist. A provider existing in config is NOT enough — models not listed get "Model X is not allowed" errors. Adding `provider/*` auto-allows every model on that provider, present and future.

### Why auto gateway restart?
File writes don't hot-reload the model allowlist reliably. The dashboard shells out to `openclaw gateway restart` after every add/remove, then polls `/health` (port 18789) until it's live again.

---

## 🧪 How it was tested (2026-09-28)

- ✅ Live providers added: `cometapi/glm-5.3-flashx`, `ashna/{kimi-k3, kimi-k2.5-thinking, glm-5.3, gpt-oss-120b}` — all keys live-tested first
- ✅ Fake key → HTTP 401 → **add rejected, config untouched**
- ✅ Real key → add → both files + allowlist + gateway restart → `restart: "ok"`
- ✅ Remove → provider + allowlist entry both cleaned → restart ok
- ✅ Catalog scans: 80+ models discovered on one provider

---

## ⚠️ Gotchas learned the hard way

1. **`openclaw config patch/apply` blocks model-provider paths** — edit `~/.openclaw/openclaw.json` directly (jq) + restart.
2. **Provider in config ≠ usable** — the allowlist (`agents.defaults.models`) must also have it.
3. **Both config files** must stay in sync (`openclaw.json` + `agents/main/agent/models.json`).
4. **Set `timeoutSeconds: 300`** for slow models — default idle timeout killed requests at ~120s.
5. **Always backup before writing** — timestamped copies cost nothing.
6. **Never paste API keys in chat logs** — test keys via curl/scripts, not conversations. 😅
7. `contextWindow` matters — set it to the model's real limit (check provider docs/catalog).

---

## 📋 Manual method (full playbook)

See [`custom-provider-playbook.md`](custom-provider-playbook.md) for the curl-first, jq-edit, restart-verify process — useful when you want full control or no script/dashboard.

---

## 🛡️ Security notes

- Dashboard binds `0.0.0.0:8332` — put it behind auth/tunnel if exposed. Keys are written to config files in plaintext (OpenClaw requirement); mask logs.
- `POST /api/add` performs outbound requests with your key only to the baseUrl you provide.
- All config writes are atomic (temp file + rename) with pre-write backups.

---

*Built by Glasswing 🦋 for Jeetu — jugaad-approved.*
