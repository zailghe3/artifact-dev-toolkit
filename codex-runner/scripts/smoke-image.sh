#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "Usage: $0 <docker-image>" >&2
  exit 2
fi

image=$1
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
release_file="$script_dir/../release.json"
if ! release=$(jq -ce '
  . as $release | (type == "object" and keys == ["codexVersion","protocolVersion","runnerRevision"] and
  (.protocolVersion | type == "number" and . == floor and . >= 1 and . <= 1000000) and
  (.runnerRevision | type == "number" and . == floor and . >= 1 and . <= 1000000) and
  (.codexVersion | type == "string" and length <= 32 and test("^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$")))
  | if . then $release else error("invalid Runner release manifest") end
' "$release_file" 2>/dev/null); then
  echo "Runner release manifest is missing or invalid." >&2
  exit 1
fi
secret=ci-smoke-secret
secret_file=$(mktemp)
container_name="adt-codex-runner-smoke-${GITHUB_RUN_ID:-local}-$$"
codex_home_volume="${container_name}-codex-home"
executor_codex_home_volume="${container_name}-executor-codex-home"
executor_sqlite_home_volume="${container_name}-executor-sqlite-home"
runner_state_volume="${container_name}-runner-state"
repository_workspace_volume="${container_name}-repository-workspace"
repository_state_volume="${container_name}-repository-state"
key_directory=$(mktemp -d)
signing_key="$key_directory/signing-key.pem"
verifying_key="$key_directory/verifying-key.pem"
canonical_request="$key_directory/canonical-request"
repository_environments="$key_directory/repository-environments.json"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  docker volume rm -f "$codex_home_volume" >/dev/null 2>&1 || true
  docker volume rm -f "$executor_codex_home_volume" >/dev/null 2>&1 || true
  docker volume rm -f "$executor_sqlite_home_volume" >/dev/null 2>&1 || true
  docker volume rm -f "$runner_state_volume" >/dev/null 2>&1 || true
  docker volume rm -f "$repository_workspace_volume" >/dev/null 2>&1 || true
  docker volume rm -f "$repository_state_volume" >/dev/null 2>&1 || true
  rm -rf "$key_directory"
  rm -f "$secret_file"
}
trap cleanup EXIT

# This is an offline package/filesystem gate. Do not print or inspect certificate
# contents, and do not execute the live auth probe.
if ! docker run --rm "$image" sh -c '
  dpkg-query -W -f="\${Status}\n" ca-certificates | grep -Fxq "install ok installed" &&
  dpkg-query -W -f="\${Status}\n" libssl3 | grep -Fxq "install ok installed" &&
  test -f /etc/ssl/certs/ca-certificates.crt &&
  test -r /etc/ssl/certs/ca-certificates.crt &&
  test -s /etc/ssl/certs/ca-certificates.crt &&
  grep -m 1 -Fq -- "-----BEGIN CERTIFICATE-----" /etc/ssl/certs/ca-certificates.crt
'; then
  echo "runner_smoke_system_ca_gate_failed" >&2
  exit 1
fi
docker run --rm "$image" sh -c 'test -n "$(command -v git)" && git --version >/dev/null'

version_output=$(docker run --rm "$image" codex --version)
codex_version=$(printf '%s\n' "$version_output" | sed -E 's/^(codex-cli |codex )?//')
if [[ "$codex_version" != "$(jq -r .codexVersion <<< "$release")" ]]; then
  echo "Image contains a Codex version that disagrees with release.json." >&2
  exit 1
fi

codex_identity=$(docker run --rm "$image" sh -c '
  test "$(command -v codex)" = /usr/local/bin/codex &&
  test "$(readlink -f /usr/local/bin/codex)" = /opt/codex/bin/codex &&
  test ! -e /usr/bin/codex &&
  ldd /opt/codex/bin/codex
')
if grep -Fq 'not found' <<< "$codex_identity" || ! grep -Eq 'libc\.so\.6' <<< "$codex_identity"; then
  echo "The active Codex executable is not dynamically linked to glibc." >&2
  exit 1
fi

gai_policy=$(docker run --rm "$image" grep -Ec '^precedence[[:space:]]+' /etc/gai.conf)
if [[ "$gai_policy" != 5 ]]; then
  echo "The final image does not contain the validated address policy." >&2
  exit 1
fi

# Exercise the pinned Codex permission engine, not an environment-variable shim.
# Sentinel contents are never printed. The managed profile grants minimal system
# reads and workspace writes, while known and guessed identity paths stay absent.
docker run --rm --read-only --cap-drop ALL \
  --tmpfs /tmp:size=268435456,mode=1777 --tmpfs /run:size=16777216,mode=0755 \
  --tmpfs /workspaces:uid=1000,gid=1000,mode=0700 \
  --tmpfs /data/codex:uid=1000,gid=1000,mode=0700 \
  --tmpfs /identity:uid=1000,gid=1000,mode=0700 \
  "$image" sh -eu -c '
    umask 077
    mkdir -p /workspaces/task /data/codex /identity/home/.config/gh /identity/runner
    printf sentinel > /data/codex/auth.json
    printf sentinel > /identity/home/.git-credentials
    printf sentinel > /identity/home/.config/gh/hosts.yml
    printf sentinel > /identity/runner/control-secret
    cd /workspaces/task
    codex \
      -c '''permissions.adt-managed.filesystem={":minimal"="read",":workspace_roots"="write"}''' \
      -c '''permissions.adt-managed.network.enabled=false''' \
      -c '''default_permissions="adt-managed"''' sandbox -- sh -eu -c '''
        printf ok > local-edit
        test "$(cat local-edit)" = ok
        for path in /data/codex/auth.json /identity/home/.git-credentials /identity/home/.config/gh/hosts.yml /identity/runner/control-secret; do
          if cat "$path" >/dev/null 2>&1; then exit 91; fi
        done
      '''
  ' || { echo "managed_permission_profile_isolation_failed" >&2; exit 1; }

# Validate schemas generated by the binary installed in the final image, even
# though the Docker build runs the same defense-in-depth gate.
docker run --rm "$image" node dist/validate-device-auth-schema.js codex

printf '%s' "$secret" > "$secret_file"
chmod 0444 "$secret_file"
docker volume create "$codex_home_volume" >/dev/null
docker volume create "$runner_state_volume" >/dev/null
docker run -d --name "$container_name" --read-only \
  --cap-drop ALL --tmpfs /tmp:size=268435456,mode=1777 --tmpfs /run:size=16777216,mode=0755 \
  -p 127.0.0.1::8789 \
  -e CODEX_RUNNER_SHARED_SECRET_FILE=/run/secrets/runner \
  -v "$secret_file:/run/secrets/runner:ro" \
  -v "$codex_home_volume:/data/codex" \
  -v "$runner_state_volume:/data/runner" "$image" >/dev/null

host_port=$(docker port "$container_name" 8789/tcp | sed -nE 's/^.*:([0-9]+)$/\1/p')
if [[ -z "$host_port" ]]; then
  echo "Docker did not publish the Runner smoke port." >&2
  exit 1
fi
base_url="http://127.0.0.1:$host_port"

http_healthy=false
for _attempt in {1..20}; do
  if curl --fail --silent --show-error --max-time 2 "$base_url/health" >/dev/null; then
    http_healthy=true
    break
  fi
  sleep 1
done
if [[ "$http_healthy" != true ]]; then
  echo "Runner HTTP did not become healthy." >&2
  exit 1
fi

codex_ready=false
for _attempt in {1..20}; do
  capabilities=$(curl --fail --silent --max-time 2 \
    -H "X-Codex-Runner-Secret: $secret" "$base_url/v1/capabilities" || true)
  if jq -e --argjson release "$release" '
    .protocolVersion == $release.protocolVersion and
    .runnerRevision == $release.runnerRevision and
    .codexVersion == $release.codexVersion and
    .codexAvailable == true and
    .deviceAuth == true and
    .jobExecution == true
  ' >/dev/null 2>&1 <<< "$capabilities"; then
    codex_ready=true
    break
  fi
  sleep 1
done
if [[ "$codex_ready" != true ]]; then
  echo "Runner HTTP became healthy but Codex App Server did not become ready." >&2
  exit 1
fi

# Initialization runs the real pinned App Server without inference. It must
# persist its installation identity in the sole writable CODEX_HOME while the
# image root remains read-only, and remain usable for the following account read.
if ! docker exec "$container_name" sh -c '
  test "$CODEX_HOME" = /data/codex &&
  test -s "$CODEX_HOME/installation_id" &&
  test -r "$CODEX_HOME/installation_id" &&
  test -w "$CODEX_HOME/installation_id" &&
  test -w "$CODEX_HOME"
'; then
  echo "Codex App Server did not establish a writable installation identity in CODEX_HOME." >&2
  exit 1
fi

auth_status=$(curl --fail --silent --show-error --max-time 2 \
  -H "X-Codex-Runner-Secret: $secret" "$base_url/v1/auth/status")
if ! jq -e '.connected == false and .runtime == "app-server-ready"' \
  >/dev/null 2>&1 <<< "$auth_status"; then
  echo "Fresh Runner did not report the expected disconnected App Server state." >&2
  exit 1
fi


environments=$(curl --fail --silent --show-error --max-time 2 \
  -H "X-Codex-Runner-Secret: $secret" "$base_url/v1/environments")
if ! jq -e 'keys == ["environments"] and .environments == []' >/dev/null 2>&1 <<< "$environments"; then
  echo "Fresh Runner did not return the safe empty environment catalog." >&2
  exit 1
fi
if ! docker exec "$container_name" sh -c 'test "$(id -u)" = "1000" && test -d /data/runner && test -r /data/runner && test -w /data/runner && test -x /data/runner && test "$(stat -c %a /data/runner)" = "700"'; then
  echo "Runner state directory is not securely writable by the runtime user." >&2
  exit 1
fi

# Exercise the production executor construction path, including its immutable
# Codex configuration overrides. The private key remains on the host; only the
# verifying key is mounted into the executor.
docker rm -f "$container_name" >/dev/null
docker volume create "$executor_codex_home_volume" >/dev/null
docker volume create "$executor_sqlite_home_volume" >/dev/null
# Seed legacy state before the executor starts. Bootstrap must copy this while
# /data itself remains read-only and the mounted SQLite home remains writable.
docker run --rm -v "$executor_codex_home_volume:/data/codex" "$image" \
  sqlite3 /data/codex/legacy-smoke.sqlite 'CREATE TABLE smoke(value TEXT); INSERT INTO smoke VALUES("legacy");'
openssl genpkey -algorithm ED25519 -out "$signing_key" >/dev/null 2>&1
openssl pkey -in "$signing_key" -pubout -out "$verifying_key" >/dev/null 2>&1
chmod 0444 "$verifying_key"

# The third role uses the same read-only/cap-drop image, starts no Codex App
# Server, owns only the workspace volume, and exposes only its internal health
# port for this local smoke observation.
cat >"$repository_environments" <<'JSON'
{"schemaVersion":1,"environments":[{"key":"smoke","name":"Smoke","cwd":"/workspaces/smoke","enabled":true,"sandbox":"workspace-write","repository":{"managed":true,"owner":"example","repo":"smoke","baseBranch":"main"}}]}
JSON
chmod 0444 "$repository_environments"
docker volume create "$repository_workspace_volume" >/dev/null
docker volume create "$repository_state_volume" >/dev/null
# Fresh local volumes inherit the image mount-root ownership. Prove the normal
# non-root runtime user can initialize both without capabilities or a writable
# container root.
docker run --rm --read-only --cap-drop ALL \
  -v "$repository_workspace_volume:/workspaces" \
  -v "$repository_state_volume:/data/repositories" "$image" \
  sh -c 'test "$(id -un)" = node && mkdir /workspaces/smoke && touch /workspaces/.writable /data/repositories/.writable && rm /workspaces/.writable /data/repositories/.writable'
docker run -d --name "$container_name" --read-only --cap-drop ALL \
  --tmpfs /tmp:size=16777216,mode=1777 --tmpfs /run:size=16777216,mode=0755 \
  -p 127.0.0.1::8791 -e CODEX_RUNNER_ROLE=repository-manager -e PORT=8791 \
  -e CODEX_RUNNER_EXECUTOR_VERIFYING_PUBLIC_KEY_FILE=/run/config/executor-verifying-public-key.pem \
  -e CODEX_RUNNER_ENVIRONMENTS_FILE=/run/config/environments.json -e CODEX_RUNNER_WORKSPACE_ROOT=/workspaces \
  -e CODEX_RUNNER_REPOSITORY_STATE_ROOT=/data/repositories \
  -v "$verifying_key:/run/config/executor-verifying-public-key.pem:ro" -v "$repository_environments:/run/config/environments.json:ro" \
  -v "$repository_workspace_volume:/workspaces" -v "$repository_state_volume:/data/repositories" "$image" >/dev/null
repository_port=$(docker port "$container_name" 8791/tcp | sed -nE 's/^.*:([0-9]+)$/\1/p')
if [[ -z "$repository_port" ]]; then
  echo "Docker did not publish the Repository Manager smoke port." >&2
  exit 1
fi
repository_healthy=false
for _attempt in {1..20}; do
  repository_health=$(curl --fail --silent --max-time 2 \
    "http://127.0.0.1:$repository_port/health" 2>/dev/null || true)
  if jq -e '.ok == true and .role == "repository-manager"' \
    >/dev/null 2>&1 <<< "$repository_health"; then
    repository_healthy=true
    break
  fi
  sleep 1
done
if [[ "$repository_healthy" != true ]]; then
  echo "Repository Manager did not become healthy." >&2
  docker logs --tail 100 "$container_name" >&2 2>/dev/null || true
  exit 1
fi
# The bracketed hyphen makes the inspection pattern unable to match its own
# command line while still matching a real `codex app-server` process.
docker exec "$container_name" sh -c 'git --version >/dev/null && ! cat /proc/[0-9]*/cmdline 2>/dev/null | tr "\000" " " | grep -E "codex app[-]server"'
docker rm -f "$container_name" >/dev/null
docker run -d --name "$container_name" --read-only \
  --cap-drop ALL --tmpfs /tmp:size=268435456,mode=1777 --tmpfs /run:size=16777216,mode=0755 \
  -p 127.0.0.1::8790 \
  -e CODEX_RUNNER_ROLE=executor -e PORT=8790 \
  -e CODEX_RUNNER_EXECUTOR_VERIFYING_PUBLIC_KEY_FILE=/run/config/executor-verifying-public-key.pem \
  -e CODEX_RUNNER_WORKSPACE_ROOT=/workspaces -e CODEX_SQLITE_HOME=/data/codex-sqlite \
  -e HTTP_PROXY=http://127.0.0.1:9 -e HTTPS_PROXY=http://127.0.0.1:9 -e ALL_PROXY=http://127.0.0.1:9 \
  -e NO_PROXY=localhost,127.0.0.1,codex-runner-controller,codex-runner-executor \
  -v "$verifying_key:/run/config/executor-verifying-public-key.pem:ro" \
  -v "$executor_codex_home_volume:/data/codex" -v "$executor_sqlite_home_volume:/data/codex-sqlite" \
  -v "$repository_workspace_volume:/workspaces" "$image" >/dev/null

# Executor receives the shared mutable task checkout volume, but never the
# Repository Manager's authority-bearing mirror/control volume.
docker inspect "$container_name" | jq -e --arg private "$repository_state_volume" '
  .[0].Mounts | any(.Name == $private) | not
' >/dev/null

executor_port=$(docker port "$container_name" 8790/tcp | sed -nE 's/^.*:([0-9]+)$/\1/p')
if [[ -z "$executor_port" ]]; then
  echo "Docker did not publish the executor smoke port." >&2
  exit 1
fi
executor_url="http://127.0.0.1:$executor_port"
signed_executor_request() {
  local method=$1 path=$2 body=${3-} timestamp nonce digest signature
  timestamp=$(date +%s%3N)
  nonce=$(openssl rand -hex 24)
  digest=$(printf '%s' "$body" | sha256sum | cut -d' ' -f1)
  printf 'adt-executor-v1\n%s\n%s\n%s\n%s\n%s' "$method" "$path" "$timestamp" "$nonce" "$digest" > "$canonical_request"
  signature=$(openssl pkeyutl -sign -rawin -in "$canonical_request" -inkey "$signing_key" | openssl base64 -A | tr '+/' '-_' | tr -d '=')
  local args=(--fail --silent --show-error --max-time 110 -X "$method"
    -H "X-Codex-Executor-Timestamp: $timestamp" -H "X-Codex-Executor-Nonce: $nonce"
    -H "X-Codex-Executor-Signature: $signature")
  if [[ -n "$body" ]]; then args+=(-H 'Content-Type: application/json' --data "$body"); fi
  curl "${args[@]}" "$executor_url$path"
}
executor_http=false
for _attempt in {1..20}; do
  if curl --fail --silent --show-error --max-time 2 "$executor_url/health" \
    | jq -e '.ok == true and .role == "executor" and (.generation | test("^[0-9a-f-]{36}$"))' >/dev/null 2>&1; then
    executor_http=true
    break
  fi
  sleep 1
done
if [[ "$executor_http" != true ]]; then
  echo "Executor HTTP did not become healthy." >&2
  exit 1
fi

executor_ready=false
for _attempt in {1..20}; do
  timestamp=$(date +%s%3N)
  nonce=$(openssl rand -hex 24)
  empty_digest=$(printf '' | sha256sum | cut -d' ' -f1)
  printf 'adt-executor-v1\nGET\n/internal/v1/status\n%s\n%s\n%s' \
    "$timestamp" "$nonce" "$empty_digest" > "$canonical_request"
  signature=$(openssl pkeyutl -sign -rawin -in "$canonical_request" -inkey "$signing_key" \
    | openssl base64 -A | tr '+/' '-_' | tr -d '=')
  status=$(curl --fail --silent --max-time 2 \
    -H "X-Codex-Executor-Timestamp: $timestamp" \
    -H "X-Codex-Executor-Nonce: $nonce" \
    -H "X-Codex-Executor-Signature: $signature" \
    "$executor_url/internal/v1/status" || true)
  if jq -e '
    (.generation | test("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")) and
    .healthy == true and .activeExecutionId == null and .activity == null and
    .boundary == "container"
  ' >/dev/null 2>&1 <<< "$status"; then
    executor_ready=true
    break
  fi
  sleep 1
done
if [[ "$executor_ready" != true ]]; then
  echo "Executor HTTP became reachable but its Codex App Server did not become ready." >&2
  exit 1
fi
if ! docker exec "$container_name" sh -c '
  test "$CODEX_HOME" = /data/codex && test "$CODEX_SQLITE_HOME" = /data/codex-sqlite && test "$CODEX_HOME" != "$CODEX_SQLITE_HOME" &&
  test -w "$CODEX_SQLITE_HOME" && find "$CODEX_SQLITE_HOME" -maxdepth 1 -type f -name "*.sqlite" -print -quit | grep -q . &&
  test -f "$CODEX_HOME/legacy-smoke.sqlite" && test -f "$CODEX_SQLITE_HOME/legacy-smoke.sqlite" &&
  test -s "$CODEX_HOME/installation_id" && test -r "$CODEX_HOME/installation_id" && test -w "$CODEX_HOME/installation_id" && test -w "$CODEX_HOME" &&
  test ! -w / && test ! -w /data && test "$(stat -c %a /tmp)" = 1777 && test "$(stat -c %a /run)" = 755 &&
  test "$(stat -f -c %T /tmp)" = tmpfs && test "$(stat -f -c %T /run)" = tmpfs
'; then
  echo "Executor Codex App Server cannot use its writable CODEX_HOME." >&2
  exit 1
fi

backup_response=$(signed_executor_request POST /internal/v1/sqlite-storage/backups)
backup_id=$(jq -er '.backup.backupId | select(test("^b-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}$"))' <<< "$backup_response")
if ! docker exec "$container_name" sh -c "
  backup=/data/codex/.adt/sqlite-backups/$backup_id
  test -f \"\$backup/manifest.json\" &&
  ! find \"\$backup\" -maxdepth 1 -type f \( -name '*-wal' -o -name '*-shm' \) -print -quit | grep -q . &&
  for database in \"\$backup\"/*.sqlite \"\$backup\"/*.db; do
    test -e \"\$database\" || continue
    test \"\$(sqlite3 \"\$database\" 'PRAGMA integrity_check;')\" = ok || exit 1
  done
"; then
  echo "Executor manual backup did not produce a cold verified backup set." >&2
  exit 1
fi
restore_body=$(jq -cn --arg backupId "$backup_id" '{backupId:$backupId}')
restore_response=$(signed_executor_request POST /internal/v1/sqlite-storage/restore "$restore_body")
if ! jq -e --arg id "$backup_id" '.backupId == $id and .rollbackOccurred == false' >/dev/null <<< "$restore_response"; then
  echo "Executor storage restore did not complete safely." >&2
  exit 1
fi
post_restore_status=$(signed_executor_request GET /internal/v1/status)
if ! jq -e '.healthy == true' >/dev/null <<< "$post_restore_status" || ! docker exec "$container_name" sh -c '
  test -f "$CODEX_HOME/legacy-smoke.sqlite" && test -f "$CODEX_SQLITE_HOME/legacy-smoke.sqlite" &&
  ! find "$CODEX_SQLITE_HOME" -mindepth 1 -maxdepth 1 -type d -name ".adt-*" -print -quit | grep -q .
'; then
  echo "Executor restore did not recover readiness or clean local staging." >&2
  exit 1
fi
