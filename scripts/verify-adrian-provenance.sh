#!/usr/bin/env bash
set -euo pipefail

root="${1:-.}"
metadata="${root}/third_party/adrian-upstream.json"
vendor="${root}/third_party/adrian"
expected_repository='secureagentics/Adrian'

command -v jq >/dev/null
command -v tar >/dev/null
command -v diff >/dev/null
[[ -f "$metadata" && -d "$vendor" ]]
repository="$(jq -er '.repository' "$metadata")"
commit="$(jq -er '.commit' "$metadata")"
ref="$(jq -er '.ref' "$metadata")"
[[ "$repository" == "$expected_repository" ]]
[[ "$commit" =~ ^[0-9a-f]{40}$ ]]
[[ "$ref" == "$commit" ]]
[[ "$(jq -r 'keys | sort | join(",")' "$metadata")" == 'commit,ref,repository' ]]

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
archive="${ADRIAN_PROVENANCE_ARCHIVE:-${work}/upstream.tar.gz}"
if [[ -z "${ADRIAN_PROVENANCE_ARCHIVE:-}" ]]; then
  curl --fail --silent --show-error --location \
    "https://github.com/secureagentics/Adrian/archive/${commit}.tar.gz" \
    --output "$archive"
fi
mkdir "${work}/upstream"
tar -xzf "$archive" -C "${work}/upstream" --strip-components=1
[[ -d "${work}/upstream/backend" && -f "${work}/upstream/LICENSE" ]]
mkdir "${work}/expected"
cp -a "${work}/upstream/backend" "${work}/expected/backend"
cp -a "${work}/upstream/LICENSE" "${work}/expected/LICENSE"
if ! diff --recursive --no-dereference --brief "${work}/expected" "$vendor"; then
  echo "Vendored Adrian snapshot differs from ${expected_repository}@${commit}." >&2
  exit 1
fi
printf 'Verified third_party/adrian against %s@%s.\n' "$expected_repository" "$commit"
