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
backend="$prefix-controlled-backend"
backend_ip=203.0.114.10
backend_config=$(mktemp)
cleanup(){ docker rm -f "$executor" "$manager" "$backend" >/dev/null 2>&1 || true; docker network rm "$executor_network" "$manager_network" "$uplink_network" >/dev/null 2>&1 || true; rm -f "$backend_config"; }
trap cleanup EXIT
image='ubuntu/squid:6.6-24.04_edge@sha256:8a3baed477e2c282ab8aa5edad442f69873246964f225c5c2ae8364b6610963c'
parse_config(){
  local role=$1 file=$2
  phase "$role-config-parse"
  docker run --rm --entrypoint squid \
    -v "$file:/tmp/adt-squid.conf:ro" "$image" \
    -k parse -f /tmp/adt-squid.conf || fail "$role-config-invalid"
}
parse_config executor "$root/squid-executor.conf"
parse_config manager "$root/squid.conf"
docker network create --internal "$executor_network" >/dev/null || fail executor-network-create
docker network create --internal "$manager_network" >/dev/null || fail manager-network-create
docker network create --subnet 203.0.114.0/24 --gateway 203.0.114.1 "$uplink_network" >/dev/null || fail uplink-network-create
cat >"$backend_config" <<'CONFIG'
http_port 443
http_access deny all
access_log none
cache_log /dev/null
pid_filename none
coredump_dir /tmp
CONFIG
docker run -d --name "$backend" --network "$uplink_network" --ip "$backend_ip" -v "$backend_config:/etc/squid/squid.conf:ro" "$image" >/dev/null || fail controlled-backend-start
docker run -d --name "$executor" --network "$executor_network" \
  --add-host "api.openai.com:$backend_ip" --add-host "auth.openai.com:10.254.254.254" --add-host "chatgpt.com:$backend_ip" \
  --add-host "github.com:$backend_ip" --add-host "api.github.com:$backend_ip" --add-host "raw.githubusercontent.com:$backend_ip" \
  --add-host "githubassets.com:$backend_ip" --add-host "example.com:$backend_ip" \
  -v "$root/squid-executor.conf:/etc/squid/squid.conf:ro" "$image" >/dev/null || fail executor-proxy-start
docker network connect --gw-priority 1 "$uplink_network" "$executor" || fail executor-uplink-connect
docker run -d --name "$manager" --network "$manager_network" \
  --add-host "api.github.com:$backend_ip" \
  -v "$root/squid.conf:/etc/squid/squid.conf:ro" "$image" >/dev/null || fail manager-proxy-start
docker network connect --gw-priority 1 "$uplink_network" "$manager" || fail manager-uplink-connect
# The client joins only its role's internal network. http_connect records the
# proxy CONNECT response without printing upstream response data.
connect_status(){ docker run --rm --network "$1" curlimages/curl:8.15.0 -s -o /dev/null -w '%{http_connect}' --connect-timeout 5 --max-time 15 --proxy "http://$2:3128" "$3" 2>/dev/null || true; }
# Exercise the same role-network -> Docker DNS -> proxy path as production.
# Port 1 is rejected by both loaded policies before DNS or upstream I/O.
wait_proxy_ready(){
  local phase_name=$1 role=$2 network=$3 proxy=$4 status=000 running
  phase "$phase_name"
  for _ in {1..30}; do
    status=$(connect_status "$network" "$proxy" https://example.invalid:1/)
    if [[ "$status" == 403 ]]; then return; fi
    sleep 1
  done
  running=$(docker inspect -f '{{.State.Running}}' "$proxy" 2>/dev/null || printf unknown)
  fail "$role-proxy-not-ready-observed-${status:-empty}-running-$running"
}
wait_proxy_ready executor-proxy-ready executor "$executor_network" "$executor"
wait_proxy_ready manager-proxy-ready manager "$manager_network" "$manager"
expect_connect(){
  local phase_name=$1 label=$2 network=$3 proxy=$4 target=$5 expected=$6 attempts=${7:-1} status=000 running
  phase "$phase_name"
  for ((_attempt=1; _attempt<=attempts; _attempt++)); do
    status=$(connect_status "$network" "$proxy" "$target")
    if [[ "$status" == "$expected" ]]; then return; fi
    if ((_attempt<attempts)); then sleep 1; fi
  done
  running=$(docker inspect -f '{{.State.Running}}' "$proxy" 2>/dev/null || printf unknown)
  fail "$phase_name-target-$label-expected-$expected-observed-${status:-empty}-running-$running"
}
# All policy decisions below use test-scoped host mappings and a reachable local
# TCP backend. Production allowlists and DNS configuration remain unchanged.
expect_connect executor-openai-allowed api-openai "$executor_network" "$executor" https://api.openai.com/ 200 10
expect_connect executor-openai-allowed chatgpt "$executor_network" "$executor" https://chatgpt.com/ 200 10
expect_connect executor-approved-private-denied auth-openai-private "$executor_network" "$executor" https://auth.openai.com/ 403
for target in https://github.com/ https://api.github.com/ https://raw.githubusercontent.com/ https://githubassets.com/; do
  expect_connect executor-github-denied github "$executor_network" "$executor" "$target" 403
done
expect_connect executor-arbitrary-denied arbitrary "$executor_network" "$executor" https://example.com/ 403
for target in "https://$backend_ip/" https://192.0.2.1/ 'https://[2001:db8::1]/'; do
  expect_connect executor-ip-literal-denied ip-literal "$executor_network" "$executor" "$target" 403
done
# Service discovery cannot resolve or route across the isolated role networks.
expect_connect cross-role-isolation manager-proxy "$executor_network" "$manager" https://api.github.com/ 000
expect_connect cross-role-isolation executor-proxy "$manager_network" "$executor" https://api.openai.com/ 000
expect_connect manager-github-allowed api-github "$manager_network" "$manager" https://api.github.com/ 200 10
