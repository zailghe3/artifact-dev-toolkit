#!/usr/bin/env bash
set -euo pipefail
phase(){ printf 'proxy_smoke_phase=%s\n' "$1" >&2; }
fail(){ printf 'proxy_smoke_failure=%s\n' "$1" >&2; exit 1; }
command -v docker >/dev/null || fail docker-unavailable
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
prefix="adt-proxy-policy-$$"
executor_network="$prefix-executor"
manager_network="$prefix-manager"
uplink_network="$prefix-uplink"
executor="$prefix-executor-proxy"
manager="$prefix-manager-proxy"
cleanup(){ docker rm -f "$executor" "$manager" >/dev/null 2>&1 || true; docker network rm "$executor_network" "$manager_network" "$uplink_network" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker network create --internal "$executor_network" >/dev/null || fail executor-network-create
docker network create --internal "$manager_network" >/dev/null || fail manager-network-create
docker network create "$uplink_network" >/dev/null || fail uplink-network-create
image='ubuntu/squid:6.6-24.04_edge@sha256:8a3baed477e2c282ab8aa5edad442f69873246964f225c5c2ae8364b6610963c'
docker run -d --name "$executor" --network "$executor_network" -v "$root/squid-executor.conf:/etc/squid/squid.conf:ro" "$image" >/dev/null || fail executor-proxy-start
docker network connect "$uplink_network" "$executor" || fail executor-uplink-connect
docker run -d --name "$manager" --network "$manager_network" -v "$root/squid.conf:/etc/squid/squid.conf:ro" "$image" >/dev/null || fail manager-proxy-start
docker network connect "$uplink_network" "$manager" || fail manager-uplink-connect
# squidclient exits successfully even when http_access returns 403. Require the
# exact safe local denial response so a container that is merely started cannot
# be mistaken for a proxy that is already listening and has loaded its policy.
wait_proxy_ready(){
  local phase_name=$1 role=$2 container=$3 response
  phase "$phase_name"
  for _ in {1..30}; do
    response=$(docker exec "$container" squidclient -h 127.0.0.1 http://example.invalid:1/ 2>/dev/null | sed -n '1p' || true)
    if [[ "$response" =~ ^HTTP/1\.[01][[:space:]]+403([[:space:]]|$) ]]; then return; fi
    sleep 1
  done
  fail "$role-proxy-not-ready"
}
wait_proxy_ready executor-proxy-ready executor "$executor"
wait_proxy_ready manager-proxy-ready manager "$manager"
# The client joins only its role's internal network. http_connect records the
# proxy CONNECT response without printing upstream response data.
connect_status(){ docker run --rm --network "$1" curlimages/curl:8.15.0 -s -o /dev/null -w '%{http_connect}' --connect-timeout 5 --max-time 15 --proxy "http://$2:3128" "$3" 2>/dev/null || true; }
expect_connect(){
  local phase_name=$1 network=$2 proxy=$3 target=$4 expected=$5 attempts=${6:-1} status=000
  phase "$phase_name"
  for ((_attempt=1; _attempt<=attempts; _attempt++)); do
    status=$(connect_status "$network" "$proxy" "$target")
    if [[ "$status" == "$expected" ]]; then return; fi
    if ((_attempt<attempts)); then sleep 1; fi
  done
  fail "$phase_name-expected-$expected-observed-${status:-empty}"
}
for target in https://api.openai.com/ https://auth.openai.com/ https://chatgpt.com/; do
  expect_connect executor-openai-allowed "$executor_network" "$executor" "$target" 200 10
done
for target in https://github.com/ https://api.github.com/ https://raw.githubusercontent.com/ https://githubassets.com/; do
  expect_connect executor-github-denied "$executor_network" "$executor" "$target" 403
done
expect_connect executor-arbitrary-denied "$executor_network" "$executor" https://example.com/ 403
for target in https://140.82.121.4/ https://192.0.2.1/; do
  expect_connect executor-ip-literal-denied "$executor_network" "$executor" "$target" 403
done
# Service discovery cannot resolve or route across the isolated role networks.
expect_connect cross-role-isolation "$executor_network" "$manager" https://api.github.com/ 000
expect_connect cross-role-isolation "$manager_network" "$executor" https://api.openai.com/ 000
expect_connect manager-github-allowed "$manager_network" "$manager" https://api.github.com/ 200 10
