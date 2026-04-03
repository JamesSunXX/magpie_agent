#!/usr/bin/env bash
set -euo pipefail

MAGPIE_HOME="${MAGPIE_HOME:-$HOME/.magpie}"
LOOP_DIR="$MAGPIE_HOME/loop-sessions"

if [[ ! -d "$LOOP_DIR" ]]; then
  echo "loop-sessions directory not found: $LOOP_DIR"
  exit 1
fi

latest_dir="$(ls -1t "$LOOP_DIR" | head -n 1 || true)"
if [[ -z "$latest_dir" ]]; then
  echo "no loop session found in $LOOP_DIR"
  exit 0
fi

session_root="$LOOP_DIR/$latest_dir"
session_json="$LOOP_DIR/$latest_dir.json"

echo "== Loop Monitor =="
echo "time: $(date '+%Y-%m-%d %H:%M:%S')"
echo "latest session dir: $session_root"
echo

echo "== Process =="
if ps -axo pid,etime,command >/tmp/.loop-monitor-ps.txt 2>/tmp/.loop-monitor-ps.err; then
  rg "src/cli.ts loop run|codex exec" /tmp/.loop-monitor-ps.txt || echo "no active loop/codex process"
else
  echo "process scan unavailable in current sandbox"
fi
echo

echo "== Session JSON =="
if [[ -f "$session_json" ]]; then
  sed -n '1,160p' "$session_json"
else
  echo "not generated yet: $session_json"
fi
echo

echo "== Session Files =="
find "$session_root" -maxdepth 2 -type f -print | sort || true
echo

events_file="$session_root/events.jsonl"
if [[ -f "$events_file" ]]; then
  echo "== Recent Events =="
  tail -n 30 "$events_file"
else
  echo "events not generated yet: $events_file"
fi
