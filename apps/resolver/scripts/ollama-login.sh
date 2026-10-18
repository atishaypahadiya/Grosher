#!/bin/sh
# Run at login by ~/Library/LaunchAgents/dev.grosher.ollama.plist (npm run chain:install -w @grosher/resolver).
# The Ollama menu-bar app reads its environment from launchd, so the variables are set here, every login
# (launchctl setenv does not survive a reboot), before the app starts. Then, once Ollama answers, one tiny
# request loads the model so the first real request is not a cold load.
# launchd has no PATH: every command is absolute.
set -u
MODEL="${GROSHER_MODEL:-qwen3:8b}"
log() { echo "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

/bin/launchctl setenv OLLAMA_HOST 0.0.0.0
/bin/launchctl setenv OLLAMA_ORIGINS "*"
/bin/launchctl setenv OLLAMA_KEEP_ALIVE 24h
log "environment set: OLLAMA_HOST=0.0.0.0 OLLAMA_ORIGINS=* OLLAMA_KEEP_ALIVE=24h"

# an app that started before the variables were set listens on localhost only: restart it so it reads them
if /usr/bin/pgrep -xq Ollama && ! /usr/sbin/lsof -nP -iTCP:11434 -sTCP:LISTEN 2>/dev/null | /usr/bin/grep -q '\*:11434'; then
  log "Ollama started without the environment: restarting it"
  /usr/bin/killall Ollama
  /bin/sleep 3
fi
/usr/bin/open -ga Ollama

i=0
until /usr/bin/curl -fs -m 2 -o /dev/null http://127.0.0.1:11434/api/version; do
  i=$((i + 1))
  if [ "$i" -ge 90 ]; then log "Ollama did not answer in 180 s; no warm-up"; exit 1; fi
  /bin/sleep 2
done
log "Ollama answers; warming $MODEL"
code=$(/usr/bin/curl -sS -m 180 -o /dev/null -w '%{http_code}' http://127.0.0.1:11434/api/chat \
  -H 'content-type: application/json' \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"ok\"}],\"stream\":false,\"think\":false,\"keep_alive\":\"24h\",\"options\":{\"num_predict\":1}}")
log "warm-up $MODEL: HTTP $code"
