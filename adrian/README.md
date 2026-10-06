# Adrian backend image

ADT publishes the independently built backend image `poulti/adrian-backend`. The image recipe and smoke test are ADT-owned at `adrian/Dockerfile` and `adrian/scripts/smoke-image.sh`; they are deliberately outside the upstream snapshot.

## Updating the vendored source

1. Select an explicit commit from `secureagentics/Adrian` and verify that it exists upstream.
2. Replace `third_party/adrian/backend/` and `third_party/adrian/LICENSE` with those exact regular files from the commit. Do not copy Git metadata, frontend, SDK, examples, models, runtime data, or generated archives.
3. Update `third_party/adrian-upstream.json` with the same full commit SHA.
4. Run `scripts/verify-adrian-provenance.sh` and open a normal ADT pull request so reviewers see the actual source diff.
5. Let PR CI repeat provenance verification, Go tests, image build, and the self-contained readiness smoke test.
6. Merge the PR to trigger trusted automatic publication.

Never hide an ADT-specific patch in `third_party/adrian/`: those files must remain byte-for-byte upstream material. If a patch is genuinely required, make the divergence explicit outside the snapshot and update the verification contract deliberately.

Automatic publication creates immutable `<ADT commit SHA>` and (when absent) `upstream-<Adrian commit SHA>` tags, then moves `latest`. A rebuild dispatched manually creates only an immutable `rebuild-<run ID>-<run attempt>` tag before moving `latest`; it never moves either source-derived immutable tag.
