# Candidate Worker promotion design note

**Status:** Unimplemented design exploration; not current production behaviour.

The current production path is documented in [GitHub artifact deployment](github-artifact-deployment.md) and implemented by the trusted delivery workflows. This note preserves a previously identified option for probing an immutable uploaded Worker version before production promotion.

## Candidate approach

- [OpenNext upload](https://opennext.js.org/cloudflare/cli#upload-command) calls `wrangler versions upload` without routing production traffic. [Cloudflare Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/) can probe an exact uploaded version; [version deployment](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/) can subsequently promote it.
- Version URLs use the candidate's configured resources, including production resources; they are not an isolated staging environment. OpenNext upload can also populate remote cache bindings before promotion.
- Follow up with a narrow upload → exact-version OAuth smoke → promotion implementation. Validate current account Version URL availability/access, parse the immutable candidate ID/URL, verify ADT's custom Workflow entrypoint and self-reference binding behavior, and preserve D1-before-compatible-code ordering. Migration and shared-resource effects cannot be rolled back simply by declining traffic promotion.
- Cover candidate upload failures, wrong-version probes, stale candidates, interruption, failed promotion, and the retained post-promotion OAuth smoke before adopting this flow. No production upload/promotion experiment is part of the recovery PR.
