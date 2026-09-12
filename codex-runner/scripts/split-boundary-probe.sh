#!/bin/sh

set -eu

# This probe intentionally exercises Codex without its native Linux sandbox.
# Docker is the split executor's security boundary.
workspace=/workspaces/task
mkdir -p "$workspace"
test "$(id -u)" != 0
test ! -w /
test ! -e "$workspace/.git"
awk '/^CapEff:/ { if ($2 != "0000000000000000") exit 1; found=1 } END { exit !found }' /proc/self/status

cd "$workspace"
codex --sandbox danger-full-access sandbox -- sh -eu -c '
  printf "%s" ok > local-edit
  test "$(cat local-edit)" = ok
  test ! -w /
  test ! -e .git
'

# Exercise the production post-execution audit against executor-created control
# metadata. Rejection is the expected, fail-closed result.
mkdir -p nested/.git
node --input-type=module -e '
  import { managedWorkspaceInvariant } from "file:///app/dist/executor.js";
  try {
    await managedWorkspaceInvariant(process.cwd());
    process.exit(1);
  } catch (error) {
    if (error?.code !== "managed_repository_boundary_violated") throw error;
  }
'
