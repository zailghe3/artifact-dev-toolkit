# Artifact Library write correction — November 2026

## Confirmed root cause

- Baseline: `c5e204a1eaccb37eca01c58c132692c04ec43490`, latest `main` when investigated.
- PR #381 moved Artifact Library Contents writes into a shared helper using `redirect: "error"`.
- Cloudflare Workers rejects that value during request construction. Its runtime requires `follow` or `manual`.
- The helper caught the resulting `TypeError` and mapped it to `repository_unavailable`.
- Agent/Workflow writes use another adapter without the unsupported option, explaining their success with the same installation.
- The regression test runs the real artifact repository and helper inside `workerd`, with 17 valid Markdown artifacts and an isolated GitHub service binding. Before correction it returned the reported 503 after preflight; after correction creation and variation each dispatch exactly one successful PUT.
- The reproduction fails before dispatching the GitHub PUT. Production request logs were not inspected, so this does not establish whether other individual production requests encountered additional failures.

## Validation findings

- The previous action set local pending state before navigation and never cleared it. A completed navigation could therefore leave a stale “Validating…” button.
- Validation also shared a page-level wait with Runtime and Runner observations. GitHub requests had no explicit attempt deadline, so real backend stalls were possible independently of the confirmed UI defect.
- No evidence establishes whether the reported production validation backend was still running when the user observed the stuck button.

## Correction and recovery

- Use Worker-supported manual redirects; reject redirect responses without following their Location or forwarding credentials.
- Bound GitHub credential requests, reads, mutations and response-body consumption. Read retries remain bounded; cancelled operations stop retrying and scheduling new reads.
- Run explicitly requested validation through a dedicated authenticated, read-only request with an overall deadline. Reset its UI on success, failure or timeout and cancel it on unmount.
- Apply completed validation to the displayed Artifact Library health, overall health and copied summary without querying Runtime or Runner again.
- Preserve repository-wide content validation, duplicate protection, least-privilege installation credentials, secret rejection and revision checks.
- Report lost or invalid mutation responses as `mutation_uncertain`. Never retry automatically; mutation forms block further writes until the user leaves to reconcile library/GitHub state, especially when variation IDs would otherwise change.
- Emit correlated stage, duration, status, retry and mutation-outcome logs without tokens, artifact content, actor identities or private repository paths. Cache invalidation failure remains a confirmed write followed by a cache failure.
- Internal defaults live in [github-request.ts](../lib/github-request.ts): 10 seconds per request including body consumption, 45 seconds per active validation request, and a slightly longer browser deadline. Repository tests can inject shorter deadlines.

## Verification boundary

- Runtime regression coverage exercises Worker Request construction, authorization headers, write-scoped tree/blob reads, all 17 artifact parses, base64 mutation encoding and successful response validation for creation and variation.
- Failure tests cover credentials, network and response-body stalls, cancellation, retry limits, auth/permission/conflict classifications, redirects, ambiguous writes, validation completion/error/reuse and independence from Runtime/Runner diagnostics.
- No production artifact repository mutation, credential rotation, configuration change or deployment was performed.
- After an approved deployment, verify creation, variation and repeated active validation in production and inspect safe stage logs. Existing diagnostics alone do not prove the mutation path succeeds.
