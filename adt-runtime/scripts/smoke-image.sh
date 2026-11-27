#!/bin/sh
set -eu
image=${1:?image required}
expected_revision=${2:?expected revision required}
expected_release_revision=${3:?expected release revision required}
tmp=$(mktemp -d)
container="adt-runtime-smoke-$$"
database="$container-db"
network="$container-net"
keys="$container-keys"
cleanup() {
  docker rm -fv "$container" "$database" >/dev/null 2>&1 || true
  docker volume rm "$keys" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
printf '%s' 'runtime-smoke-authentication-secret-0000000000000000' > "$tmp/auth"
printf '%s' 'disposable-image-smoke-password' > "$tmp/db"
chmod 0444 "$tmp/auth" "$tmp/db"
docker network create "$network" >/dev/null
docker volume create "$keys" >/dev/null
docker run --rm --user root --mount "type=volume,src=$keys,dst=/keys" "$image" sh -c 'chown 1000:1000 /keys && chmod 0700 /keys'
docker run -d --name "$database" --network "$network" \
  -e POSTGRES_DB=adt -e POSTGRES_USER=adt_smoke -e POSTGRES_PASSWORD_FILE=/run/secrets/db \
  --mount "type=bind,src=$tmp/db,dst=/run/secrets/db,readonly" \
  postgres:17.11-alpine@sha256:e5d2edd28b1f8d40a0a6c0c9cdc545b19b56a0d5d88f94bc11a97d970d4700d0 >/dev/null
i=0
until docker exec "$database" pg_isready -h 127.0.0.1 -U adt_smoke -d adt >/dev/null 2>&1; do
  i=$((i+1))
  [ "$i" -lt 30 ] || { docker logs "$database"; exit 1; }
  sleep 1
done
docker run -d --name "$container" --network "$network" -p 127.0.0.1::8080 \
  -e ADT_RUNTIME_AUTH_SECRET_FILE=/run/secrets/auth -e ADT_RUNTIME_DB_PASSWORD_FILE=/run/secrets/db \
  -e ADT_RUNTIME_DB_HOST="$database" -e ADT_RUNTIME_DB_NAME=adt -e ADT_RUNTIME_DB_USER=adt_smoke \
  -e ADT_RUNTIME_ROOT_KEY_FILE=/keys/root.json \
  --mount "type=bind,src=$tmp/auth,dst=/run/secrets/auth,readonly" \
  --mount "type=bind,src=$tmp/db,dst=/run/secrets/db,readonly" \
  --mount "type=volume,src=$keys,dst=/keys" "$image" >/dev/null
port=$(docker port "$container" 8080/tcp | sed 's/.*://'); i=0; until curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null; do i=$((i+1)); [ "$i" -lt 30 ] || { docker logs "$container"; exit 1; }; sleep 1; done
docker exec -i -e EXPECTED_REVISION="$expected_revision" -e EXPECTED_RELEASE_REVISION="$expected_release_revision" "$container" node --input-type=module <<'NODE'
import {createHash,createHmac,randomBytes} from 'node:crypto';import {readFileSync} from 'node:fs';
const protocol='adt-runtime-v1',secret=readFileSync('/run/secrets/auth','utf8').trim();
async function request(method,path,body=''){
  const timestamp=String(Date.now()),nonce=randomBytes(24).toString('base64url'),
    digest=createHash('sha256').update(body).digest('base64url'),
    signature=createHmac('sha256',secret).update([protocol,method,path,timestamp,nonce,digest].join('\n')).digest('base64url');
  const response=await fetch(`http://127.0.0.1:8080${path}`,{method,...(body?{body}:{}),headers:{
    'x-adt-protocol':protocol,'x-adt-timestamp':timestamp,'x-adt-nonce':nonce,'x-adt-content-sha256':digest,'x-adt-signature':signature}});
  if(!response.ok)throw new Error(`Runtime smoke returned HTTP ${response.status}`);
  return response.json();
}
const value=await request('GET','/v1/readiness');
if(value.runtimeRevision!==process.env.EXPECTED_REVISION||value.runtimeReleaseRevision!==Number(process.env.EXPECTED_RELEASE_REVISION)||value.protocolVersion!==protocol||
  !['provider-execution','openai-agents','anthropic-messages','work-iq-rest','ollama-chat','provider-model-discovery','tool:artifact-search','langgraph:graph'].every(capability=>value.capabilities.includes(capability))||
  !value.credentialWrappingKeyId)process.exit(1);
const runs=await request('POST','/v1/management/control',JSON.stringify({operation:'runs.list',repositoryId:1,limit:1}));
if(!runs.ok||!Array.isArray(runs.result)||runs.result.length!==0)process.exit(1);
const settings=operation=>request('POST','/v1/management/settings',JSON.stringify({operation,repositoryId:1}));
const advisor=await settings('advisor.get');
if(!advisor.ok||advisor.result?.revision!==0||advisor.result.settings?.workflowId!==null||advisor.result.settings.override!==null)process.exit(1);
const codex=await settings('codex.list');
if(!codex.ok||!Array.isArray(codex.result)||codex.result.length!==0)process.exit(1);
NODE
test "$(docker inspect -f '{{.Config.User}}' "$container")" = node
test "$(docker inspect -f '{{json .Mounts}}' "$container" | grep -o '"RW":false' | wc -l)" -eq 2
test "$(docker image inspect -f '{{json .Config.Volumes}}' "$image")" = null
echo "ADT Runtime image is healthy, reports its built revision and release, runs as non-root, and initializes the PostgreSQL workflow application, and uses read-only secret mounts."
