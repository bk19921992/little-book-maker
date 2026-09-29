#!/bin/sh
# Run the local-Supabase tests. Needs a running local stack:
#   supabase start          (applies supabase/migrations)
#   sh supabase/tests/local/run.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
SUPABASE=${SUPABASE_CLI:-supabase}
SUPABASE_STATUS_JSON=$(cd "$HERE/../../.." && $SUPABASE status -o json 2>/dev/null)
export SUPABASE_STATUS_JSON
cd "$HERE" && npx -y deno@2 test -A --quiet --no-lock --node-modules-dir=none --import-map=import_map.json "$@" .
