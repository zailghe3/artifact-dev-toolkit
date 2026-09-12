#!/bin/sh

set -eu

# ADT_MANAGED_PROBE_ROOT is used only by the argument-construction regression
# test. The container smoke leaves it unset and therefore exercises the exact
# production paths below.
probe_root=${ADT_MANAGED_PROBE_ROOT:-}
workspace="$probe_root/workspaces/task"

umask 077
mkdir -p \
  "$workspace" \
  "$probe_root/data/codex" \
  "$probe_root/identity/home/.config/gh" \
  "$probe_root/identity/runner"
printf '%s' managed-probe-sentinel > "$probe_root/data/codex/auth.json"
printf '%s' managed-probe-sentinel > "$probe_root/identity/home/.git-credentials"
printf '%s' managed-probe-sentinel > "$probe_root/identity/home/.config/gh/hosts.yml"
printf '%s' managed-probe-sentinel > "$probe_root/identity/runner/control-secret"

cd "$workspace"
exec codex \
  -c 'permissions.adt-managed.filesystem={":minimal"="read",":workspace_roots"="write"}' \
  -c 'permissions.adt-managed.network.enabled=false' \
  -c 'default_permissions="adt-managed"' \
  sandbox -- sh -eu -c '
    printf "%s" ok > local-edit
    test "$(cat local-edit)" = ok
    for path in \
      /data/codex/auth.json \
      /identity/home/.git-credentials \
      /identity/home/.config/gh/hosts.yml \
      /identity/runner/control-secret
    do
      if cat "$path" >/dev/null 2>&1; then
        exit 91
      fi
    done
  '
