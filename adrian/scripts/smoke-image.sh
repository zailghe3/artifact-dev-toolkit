#!/usr/bin/env bash
set -euo pipefail
image="${1:?usage: smoke-image.sh <image>}"
suffix="${RANDOM}-$$"
name="adrian-smoke-${suffix}"
classifier="adrian-smoke-classifier-${suffix}"
network="adrian-smoke-${suffix}"
cleanup() {
  docker rm -f "$name" "$classifier" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create "$network" >/dev/null
docker run -d --name "$classifier" --network "$network" \
  python:3.13-alpine python -m http.server 8081 >/dev/null
docker run -d --name "$name" --network "$network" \
  -e "ADRIAN_LLM_URL=http://${classifier}:8081/v1" \
  -e ADRIAN_LLM_API_KEY=smoke-test-not-a-secret \
  -e ADRIAN_LLM_MODEL=smoke-local \
  -e ADRIAN_LLM_MODEL_PATH=/models/not-required-for-readiness.gguf \
  -e ADRIAN_SESSION_SECRET=smoke-test-session-secret \
  --tmpfs /data:rw,noexec,nosuid,size=64m \
  "$image" >/dev/null
for _ in $(seq 1 30); do
  if docker exec "$name" /adrian healthcheck; then
    docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}running{{end}}' "$name"
    exit 0
  fi
  sleep 1
done
docker logs "$classifier" >&2
docker logs "$name" >&2
exit 1
