#!/bin/sh
set -eu
image=${1:?image required}; tmp=$(mktemp -d); container="adt-runtime-smoke-$$"; cleanup(){ docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$tmp"; }; trap cleanup EXIT
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$tmp/private.pem" >/dev/null 2>&1
openssl pkey -in "$tmp/private.pem" -pubout -outform DER -out "$tmp/public.der"
key_id=$(openssl dgst -sha256 -binary "$tmp/public.der" | openssl base64 -A | tr '+/' '-_' | tr -d '=')
printf '%s' 'runtime-smoke-authentication-secret-0000000000000000' > "$tmp/auth"
printf '%s' "$key_id" > "$tmp/key-id"
docker run -d --name "$container" -p 127.0.0.1::8080 -e ADT_RUNTIME_AUTH_SECRET_FILE=/run/secrets/auth -e ADT_RUNTIME_PRIVATE_KEY_FILE=/run/secrets/private -e ADT_RUNTIME_KEY_ID_FILE=/run/secrets/key-id -e ADT_RUNTIME_REVISION=smoke --mount type=bind,src="$tmp/auth",dst=/run/secrets/auth,readonly --mount type=bind,src="$tmp/private.pem",dst=/run/secrets/private,readonly --mount type=bind,src="$tmp/key-id",dst=/run/secrets/key-id,readonly "$image" >/dev/null
port=$(docker port "$container" 8080/tcp | sed 's/.*://'); i=0; until curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null; do i=$((i+1)); [ "$i" -lt 30 ] || { docker logs "$container"; exit 1; }; sleep 1; done
test "$(docker inspect -f '{{.Config.User}}' "$container")" = node
test "$(docker inspect -f '{{json .Mounts}}' "$container" | grep -o '"RW":false' | wc -l)" -eq 3
test "$(docker image inspect -f '{{json .Config.Volumes}}' "$image")" = null
echo "ADT Runtime image is healthy, non-root, stateless, and uses read-only secret inputs."
