#!/bin/sh
set -eu
image=${1:?image required}; expected_revision=${2:?expected revision required}; tmp=$(mktemp -d); container="adt-runtime-smoke-$$"; cleanup(){ docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$tmp"; }; trap cleanup EXIT
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$tmp/private.pem" >/dev/null 2>&1
printf '%s' 'runtime-smoke-authentication-secret-0000000000000000' > "$tmp/auth"
docker run -d --name "$container" -p 127.0.0.1::8080 -e ADT_RUNTIME_AUTH_SECRET_FILE=/run/secrets/auth -e ADT_RUNTIME_PRIVATE_KEY_FILE=/run/secrets/private --mount type=bind,src="$tmp/auth",dst=/run/secrets/auth,readonly --mount type=bind,src="$tmp/private.pem",dst=/run/secrets/private,readonly "$image" >/dev/null
port=$(docker port "$container" 8080/tcp | sed 's/.*://'); i=0; until curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null; do i=$((i+1)); [ "$i" -lt 30 ] || { docker logs "$container"; exit 1; }; sleep 1; done
docker exec -i -e EXPECTED_REVISION="$expected_revision" "$container" node --input-type=module <<'NODE'
import {createHash,createHmac,randomBytes} from 'node:crypto';import {readFileSync} from 'node:fs';
const protocol='adt-runtime-v1',path='/v1/readiness',timestamp=String(Date.now()),nonce=randomBytes(24).toString('base64url'),digest=createHash('sha256').update('').digest('base64url'),secret=readFileSync('/run/secrets/auth','utf8').trim(),signature=createHmac('sha256',secret).update([protocol,'GET',path,timestamp,nonce,digest].join('\n')).digest('base64url');
const response=await fetch(`http://127.0.0.1:8080${path}`,{headers:{'x-adt-protocol':protocol,'x-adt-timestamp':timestamp,'x-adt-nonce':nonce,'x-adt-content-sha256':digest,'x-adt-signature':signature}}),value=await response.json();if(!response.ok||value.runtimeRevision!==process.env.EXPECTED_REVISION||value.protocolVersion!==protocol||!value.capabilities.includes('openai-agents')||!value.credentialWrappingKeyId)process.exit(1);
NODE
test "$(docker inspect -f '{{.Config.User}}' "$container")" = node
test "$(docker inspect -f '{{json .Mounts}}' "$container" | grep -o '"RW":false' | wc -l)" -eq 2
test "$(docker image inspect -f '{{json .Config.Volumes}}' "$image")" = null
echo "ADT Runtime image is healthy, revision-truthful, non-root, stateless, and uses read-only secret inputs."
