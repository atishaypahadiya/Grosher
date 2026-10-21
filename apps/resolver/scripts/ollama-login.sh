#!/bin/sh
# Run at login by ~/Library/LaunchAgents/dev.grosher.ollama.plist (npm run chain:install -w @grosher/resolver).
# The Ollama menu-bar app reads its environment from launchd, so the variables are set here, every login
# (launchctl setenv does not survive a reboot), before the app starts. Then, once Ollama answers, one tiny
# request loads the model so the first real request is not a cold load.
# launchd has no PATH: every command is absolute.
set -u
MODEL="${GROSHER_MODEL:-qwen3:8b}"
log() { echo "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

# loopback only: the gate (127.0.0.1:11435) is Ollama's one client, so nothing else on the network can reach
# it (no auth of its own) and no other device can load a model into this Mac's memory. No OLLAMA_ORIGINS:
# Ollama's default list already allows localhost pages (the web app's dev server).
# Two models resident: the resolver's qwen3:8b (6.1 GB loaded) and survey mode's qwen2.5vl:7b (8.0 GB) fit
# in this 24 GB Mac's 17.8 GiB GPU budget together, so reading a sign does not evict the resolver model.
/bin/launchctl setenv OLLAMA_HOST 127.0.0.1
/bin/launchctl unsetenv OLLAMA_ORIGINS
/bin/launchctl setenv OLLAMA_KEEP_ALIVE 24h
/bin/launchctl setenv OLLAMA_MAX_LOADED_MODELS 2
# Three requests at once per model: cook mode asks for each unknown dish separately, and one at a time a slow dish
# held up the rest (two dishes took twice as long as one). Each slot is its own 4,096-token context, ~0.6 GB for
# qwen3:8b and ~0.25 GB for qwen2.5vl:7b, so both models with three slots stay inside the 17.8 GiB budget.
/bin/launchctl setenv OLLAMA_NUM_PARALLEL 3
log "environment set: OLLAMA_HOST=127.0.0.1 OLLAMA_KEEP_ALIVE=24h OLLAMA_MAX_LOADED_MODELS=2 OLLAMA_NUM_PARALLEL=3 (OLLAMA_ORIGINS unset)"

# a server started with other settings (before this ran, or by an older version of it) is restarted to read
# these: one listening beyond loopback, or one whose environment differs
serve=$(/usr/bin/pgrep -f "Ollama.app/Contents/Resources/ollama serve" | /usr/bin/head -1)
stale=0
if /usr/sbin/lsof -nP -iTCP:11434 -sTCP:LISTEN 2>/dev/null | /usr/bin/awk 'NR > 1 { print $9 }' | /usr/bin/grep -vq '^127\.0\.0\.1:'; then stale=1; fi
if [ -n "$serve" ]; then
  envs=$(/bin/ps eww -o command= -p "$serve" | /usr/bin/tr ' ' '\n')
  echo "$envs" | /usr/bin/grep -q '^OLLAMA_MAX_LOADED_MODELS=2$' || stale=1
  echo "$envs" | /usr/bin/grep -q '^OLLAMA_NUM_PARALLEL=3$' || stale=1
  echo "$envs" | /usr/bin/grep -q '^OLLAMA_ORIGINS=' && stale=1
fi
if /usr/bin/pgrep -xq Ollama && [ "$stale" = 1 ]; then
  log "Ollama is running with other settings: restarting it"
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
# the app's own "Expose Ollama to the network" setting overrides OLLAMA_HOST: say so if it is back on
if /usr/sbin/lsof -nP -iTCP:11434 -sTCP:LISTEN 2>/dev/null | /usr/bin/awk 'NR > 1 { print $9 }' | /usr/bin/grep -vq '^127\.0\.0\.1:'; then
  log "WARNING: Ollama listens beyond 127.0.0.1: turn off Ollama → Settings → Expose Ollama to the network"
fi
log "Ollama answers; warming $MODEL"
code=$(/usr/bin/curl -sS -m 180 -o /dev/null -w '%{http_code}' http://127.0.0.1:11434/api/chat \
  -H 'content-type: application/json' \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"ok\"}],\"stream\":false,\"think\":false,\"keep_alive\":\"24h\",\"options\":{\"num_predict\":1}}")
log "warm-up $MODEL: HTTP $code"
