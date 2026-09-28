#!/bin/bash
# Glasswing Provider Dashboard launcher (idempotent)
cd "$(dirname "$0")"
if ! curl -s -o /dev/null --max-time 3 http://127.0.0.1:8332/api/status; then
  setsid nohup node server.js > /dev/null 2>&1 < /dev/null &
  disown
  sleep 1
fi
curl -s -o /dev/null -w "dashboard: %{http_code}\n" http://127.0.0.1:8332/api/status
