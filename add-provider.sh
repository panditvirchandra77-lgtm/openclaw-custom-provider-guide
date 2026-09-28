#!/bin/bash
# One-click custom provider add for OpenClaw
# Usage: bash ~/add-provider.sh <name> <baseUrl> <apiKey> <modelId> [ctxWindow] [maxTokens]
# Example: bash ~/add-provider.sh foo https://api.foo.com/v1 sk-xxx foo-model 200000 8192

set -e
NAME="$1"; BASEURL="$2"; KEY="$3"; MODEL="$4"
CTX="${5:-200000}"; MAXTOK="${6:-8192}"
CFG="$HOME/.openclaw/openclaw.json"

if [ -z "$NAME" ] || [ -z "$BASEURL" ] || [ -z "$KEY" ] || [ -z "$MODEL" ]; then
  echo "Usage: bash ~/add-provider.sh <name> <baseUrl> <apiKey> <modelId> [ctxWindow] [maxTokens]"
  exit 1
fi

# 1. Backup
BAK="$CFG.bak-$(date +%Y%m%d-%H%M%S)"
cp "$CFG" "$BAK"
echo "✅ Backup: $BAK"

# 2. Test key (strip trailing slash, append /chat/completions)
APIROOT="${BASEURL%/}"
echo "🔑 Testing $MODEL @ $APIROOT ..."
RESP=$(curl -s -m 60 -X POST "$APIROOT/chat/completions" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Say OK\"}],\"max_tokens\":10}")
OK=$(echo "$RESP" | jq -r '.choices[0].message.content // empty' 2>/dev/null)
if [ -z "$OK" ]; then
  echo "❌ Key/model test FAILED. Response:"
  echo "$RESP" | head -c 500
  echo "Aborted — config untouched."
  exit 1
fi
echo "✅ Test passed (model replied: $OK)"

# 3. Try /models catalog for extra info (optional, non-fatal)
MODELS_JSON=$(curl -s -m 30 "$APIROOT/models" -H "Authorization: Bearer $KEY" 2>/dev/null | jq -r '[.data[].id] | join(" ")' 2>/dev/null)
[ -n "$MODELS_JSON" ] && echo "📋 Catalog: $MODELS_JSON" || echo "📋 Catalog: (not available — skip)"

# 4. Write config (jq, atomic, validated)
TMP=$(mktemp)
jq --arg n "$NAME" --arg u "$BASEURL" --arg k "$KEY" --arg m "$MODEL" --argjson ctx "$CTX" --argjson mt "$MAXTOK" \
  '.models.providers[$n] = {"baseUrl":$u,"apiKey":$k,"auth":"api-key","api":"openai-completions","timeoutSeconds":300,
    "models":[{"id":$m,"name":$m,"input":["text"],"reasoning":false,
      "cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},
      "contextWindow":$ctx,"maxTokens":$mt,"api":"openai-completions"}]}
  | .agents.defaults.models[($n + "/*")] = {}' "$CFG" > "$TMP"
python3 -m json.tool "$TMP" > /dev/null   # validate JSON
mv "$TMP" "$CFG"

# 5. Verify
echo "✅ Config written:"
jq -c --arg n "$NAME" '{models: [.models.providers[$n].models[].id], allowlist: (.agents.defaults.models|keys)}' "$CFG"

echo ""
echo "🎉 Done! Now restart gateway (I do this via gateway tool) and use:"
echo "   /model $NAME/$MODEL"
