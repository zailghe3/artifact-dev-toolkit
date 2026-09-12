#!/usr/bin/env bash
set -euo pipefail
command -v docker >/dev/null
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
prefix="adt-proxy-policy-$$"
executor_network="$prefix-executor"
manager_network="$prefix-manager"
uplink_network="$prefix-uplink"
executor="$prefix-executor-proxy"
manager="$prefix-manager-proxy"
cleanup(){ docker rm -f "$executor" "$manager" >/dev/null 2>&1 || true; docker network rm "$executor_network" "$manager_network" "$uplink_network" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker network create --internal "$executor_network" >/dev/null
docker network create --internal "$manager_network" >/dev/null
docker network create "$uplink_network" >/dev/null
image='ubuntu/squid:6.6-24.04_edge@sha256:8a3baed477e2c282ab8aa5edad442f69873246964f225c5c2ae8364b6610963c'
docker run -d --name "$executor" --network "$executor_network" -v "$root/squid-executor.conf:/etc/squid/squid.conf:ro" "$image" >/dev/null
docker network connect "$uplink_network" "$executor"
docker run -d --name "$manager" --network "$manager_network" -v "$root/squid.conf:/etc/squid/squid.conf:ro" "$image" >/dev/null
docker network connect "$uplink_network" "$manager"
ready=false
for _ in {1..30}; do
  if docker exec "$executor" squidclient -h 127.0.0.1 mgr:info >/dev/null 2>&1 && docker exec "$manager" squidclient -h 127.0.0.1 mgr:info >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]]
# The client joins only its role's internal network. http_connect records the
# proxy CONNECT response without printing upstream response data.
connect_status(){ docker run --rm --network "$1" curlimages/curl:8.15.0 -s -o /dev/null -w '%{http_connect}' --connect-timeout 5 --max-time 15 --proxy "http://$2:3128" "$3" 2>/dev/null || true; }
[[ "$(connect_status "$executor_network" "$executor" https://api.openai.com/)" == 200 ]]
for target in https://github.com/ https://api.github.com/ https://raw.githubusercontent.com/ https://githubassets.com/ https://140.82.121.4/ https://example.com/ https://192.0.2.1/; do
  [[ "$(connect_status "$executor_network" "$executor" "$target")" == 403 ]]
done
# Service discovery cannot resolve or route across the isolated role networks.
[[ "$(connect_status "$executor_network" "$manager" https://api.github.com/)" == 000 ]]
[[ "$(connect_status "$manager_network" "$executor" https://api.openai.com/)" == 000 ]]
[[ "$(connect_status "$manager_network" "$manager" https://api.github.com/)" == 200 ]]
