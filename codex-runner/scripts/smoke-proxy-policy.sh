#!/usr/bin/env bash
set -euo pipefail
command -v docker >/dev/null
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
network="adt-proxy-policy-$$"
executor="adt-executor-proxy-$$"
manager="adt-manager-proxy-$$"
cleanup(){ docker rm -f "$executor" "$manager" >/dev/null 2>&1 || true; docker network rm "$network" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker network create "$network" >/dev/null
image='ubuntu/squid:6.6-24.04_edge@sha256:8a3baed477e2c282ab8aa5edad442f69873246964f225c5c2ae8364b6610963c'
docker run -d --name "$executor" --network "$network" -v "$root/squid-executor.conf:/etc/squid/squid.conf:ro" "$image" >/dev/null
docker run -d --name "$manager" --network "$network" -v "$root/squid.conf:/etc/squid/squid.conf:ro" "$image" >/dev/null
ready=false
for _ in {1..30}; do
  if docker exec "$executor" squidclient -h 127.0.0.1 mgr:info >/dev/null 2>&1 && docker exec "$manager" squidclient -h 127.0.0.1 mgr:info >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]]

# http_connect is the proxy's CONNECT response, independent of the upstream
# HTTP response or a later TLS failure. Suppress response bodies and errors so
# the policy gate cannot disclose upstream content.
connect_status(){ docker run --rm --network "$network" curlimages/curl:8.15.0 -s -o /dev/null -w '%{http_connect}' --connect-timeout 5 --max-time 15 --proxy "http://$1:3128" "$2" 2>/dev/null || true; }
[[ "$(connect_status "$executor" https://api.openai.com/)" == 200 ]]
for target in https://github.com/ https://api.github.com/ https://raw.githubusercontent.com/ https://githubassets.com/ https://140.82.121.4/ https://example.com/ https://192.0.2.1/; do
  [[ "$(connect_status "$executor" "$target")" == 403 ]]
done
[[ "$(connect_status "$manager" https://api.github.com/)" == 200 ]]
