#!/bin/sh
set -eu

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
image=postgres:17.11-alpine@sha256:e5d2edd28b1f8d40a0a6c0c9cdc545b19b56a0d5d88f94bc11a97d970d4700d0
scratch=$(mktemp -d)
container="adt-postgres-test-$(basename "$scratch")"
cleanup() {
  docker rm -fv "$container" >/dev/null 2>&1 || true
  rm -rf "$scratch"
}
trap cleanup EXIT
cp "$repo/adt-runtime/scripts/init-postgres.sh" "$scratch/init-postgres.sh"
chmod 0444 "$scratch/init-postgres.sh"
printf '%s' 'disposable-app-test-password' > "$scratch/app-password"
printf '%s' 'disposable-bootstrap-test-password' > "$scratch/bootstrap-password"
chmod 0444 "$scratch/app-password" "$scratch/bootstrap-password"

docker run --detach --name "$container" -p 127.0.0.1::5432 \
  -e POSTGRES_DB=adt -e POSTGRES_USER=adt_bootstrap \
  -e POSTGRES_PASSWORD_FILE=/run/secrets/adt_postgres_bootstrap_password \
  --mount "type=bind,src=$scratch/app-password,dst=/run/secrets/adt_postgres_app_password,readonly" \
  --mount "type=bind,src=$scratch/bootstrap-password,dst=/run/secrets/adt_postgres_bootstrap_password,readonly" \
  --mount "type=bind,src=$scratch/init-postgres.sh,dst=/docker-entrypoint-initdb.d/01-adt-role.sh,readonly" \
  "$image" >/dev/null

attempt=0
until docker exec -e PGPASSWORD=disposable-app-test-password "$container" \
  psql -h 127.0.0.1 -U adt_runtime -d adt -Atc 'SELECT 1' >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 20 ]; then docker logs "$container"; exit 1; fi
  sleep 1
done

docker exec "$container" createdb -U adt_bootstrap -O adt_runtime adt_restore
docker exec "$container" createdb -U adt_bootstrap -O adt_runtime adt_coordinator
docker exec "$container" createdb -U adt_bootstrap -O adt_runtime adt_conversations
endpoint=$(docker port "$container" 5432/tcp)
cd "$repo"
ADT_TEST_POSTGRES_CONTAINER="$container" \
ADT_TEST_POSTGRES_URL="postgresql://adt_runtime:disposable-app-test-password@$endpoint/adt" \
ADT_TEST_POSTGRES_RESTORE_URL="postgresql://adt_runtime:disposable-app-test-password@$endpoint/adt_restore" \
  node --test test/integration/postgres-runtime-integration.test.mjs test/integration/conversation-postgres.test.mjs
