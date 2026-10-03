#!/bin/sh
# End-to-end check of the durable illustration job: the real generate-images
# handler against real Postgres 16 + PostgREST (the service Supabase's REST
# API runs), with every migration applied. Only OpenAI and the auth lookup
# are mocked. Needs docker, node and network access to docker.io and npm.
#   sh supabase/tests/image-jobs-e2e/run.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
SECRET=e2e-secret-e2e-secret-e2e-secret-32ch
INIT=$(mktemp -d)
cp "$HERE/supabase_shim.sql" "$INIT/00_supabase_shim.sql"
cp "$ROOT"/supabase/migrations/*.sql "$INIT/"
chmod 755 "$INIT" && chmod 644 "$INIT"/*.sql
stop_containers() { docker rm -f sprout-e2e-pg sprout-e2e-rest >/dev/null 2>&1 || true; }
trap 'stop_containers; rm -rf "$INIT" "$HERE/.tokens.json"' EXIT
stop_containers
docker run -d --name sprout-e2e-pg --network host -e POSTGRES_PASSWORD=pw -e PGPORT=54329 -v "$INIT:/docker-entrypoint-initdb.d:ro" postgres:16-alpine >/dev/null
i=0; until docker logs sprout-e2e-pg 2>&1 | grep -q "PostgreSQL init process complete" && docker exec sprout-e2e-pg pg_isready -p 54329 -q; do i=$((i+1)); [ $i -gt 60 ] && { docker logs sprout-e2e-pg; exit 1; }; sleep 1; done
if docker logs sprout-e2e-pg 2>&1 | grep -q "ERROR"; then docker logs sprout-e2e-pg 2>&1 | grep ERROR; exit 1; fi
docker exec sprout-e2e-pg psql -U postgres -p 54329 -qc "insert into auth.users values ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222')"
docker run -d --name sprout-e2e-rest --network host -e PGRST_DB_URI="postgres://authenticator:pw@localhost:54329/postgres" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=$SECRET -e PGRST_SERVER_PORT=54330 postgrest/postgrest:v12.2.3 >/dev/null
i=0; until curl -s -o /dev/null localhost:54330/; do i=$((i+1)); [ $i -gt 30 ] && exit 1; sleep 1; done
SECRET=$SECRET OUT="$HERE/.tokens.json" node -e "
const c=require('crypto');const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const sign=p=>{const h=b({alg:'HS256',typ:'JWT'}),q=b(p);return h+'.'+q+'.'+c.createHmac('sha256',process.env.SECRET).update(h+'.'+q).digest('base64url')};
const exp=Math.floor(Date.now()/1e3)+3600;
require('fs').writeFileSync(process.env.OUT,JSON.stringify({service:sign({role:'service_role',exp}),user:sign({role:'authenticated',sub:'11111111-1111-1111-1111-111111111111',exp})}))"
cd "$HERE" && npx -y deno@2 run -A --quiet --node-modules-dir=none --import-map=import_map.json e2e.ts
