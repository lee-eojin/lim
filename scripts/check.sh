#!/usr/bin/env bash
# Checks that run without Claude Code: JSON syntax and a private word list kept outside the repo.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
status=0

while IFS= read -r json_file; do
  # Python's json accepts NaN and Infinity, which JSON.parse refuses.
  if ! python3 -c 'import json, sys
def refuse(name): raise ValueError(name)
json.load(open(sys.argv[1], encoding="utf-8"), parse_constant=refuse)' "$json_file" > /dev/null 2>&1; then
    echo "invalid JSON: ${json_file#"$root"/}"
    status=1
  fi
done < <(find "$root" \( -name .git -o -name node_modules \) -prune -o -name '*.json' -print)

word_list="${LIM_DENYLIST:-}"
if [ -z "$word_list" ] && [ -n "${LIM_DENYLIST_FILE:-}" ] && [ -f "$LIM_DENYLIST_FILE" ]; then
  word_list="$(cat "$LIM_DENYLIST_FILE")"
fi

if [ -z "$word_list" ]; then
  echo "word list check skipped: set LIM_DENYLIST or LIM_DENYLIST_FILE"
else
  hits="$(grep -rniF --exclude-dir=.git --exclude-dir=node_modules \
    -f <(printf '%s\n' "$word_list" | sed '/^[[:space:]]*$/d') "$root" | cut -d: -f1,2 || true)"
  if [ -n "$hits" ]; then
    echo "blocked words found at:"
    echo "${hits//"$root"\//}"
    status=1
  fi
fi

exit "$status"
