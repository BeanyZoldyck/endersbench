#!/usr/bin/env bash
# Loads model endpoints and keys into a database's environment, where the
# think procedure reads them in a database-brained run. Each value comes from
# the repo's .env, else from this shell. Prints names, never values.
#
#   scripts/load-model-keys.sh <db> [local|maincloud]
set -euo pipefail
DB=${1:?usage: scripts/load-model-keys.sh <db> [local|maincloud]}
SERVER=${2:-local}
W=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE=$W/../.env
export PATH="$HOME/.local/bin:$PATH"

names=()
values=()
for name in BITDEER_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY OPENROUTER_API_KEY ENDER_BASE_URL ENDER_API_KEY FEATHERLESSAI_API_KEY; do
  value=$( (grep -m1 "^$name=" "$ENV_FILE" 2>/dev/null || true) | cut -d= -f2- | tr -d "\"' \r")
  [ -n "$value" ] || value=${!name:-}
  if [ -n "$value" ]; then
    export "$name=$value"
    names+=("$name")
    values+=("$value")
  fi
done
[ ${#names[@]} -gt 0 ] || { echo "No model keys in $ENV_FILE or this shell"; exit 1; }

echo "Setting on $DB ($SERVER): ${names[*]}"
# From a neutral directory: world/spacetime.json names a module path, which --env-only refuses.
out=$(cd /tmp && spacetime publish "$DB" --server "$SERVER" --env-only --yes 2>&1) || status=$?
for value in "${values[@]}"; do out=${out//"$value"/***}; done
echo "$out" | grep -vE '^\s*$' | tail -5
exit "${status:-0}"
