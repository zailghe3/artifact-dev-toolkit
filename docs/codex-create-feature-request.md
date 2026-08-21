# Codex feature-request creation

This document explains the stable feature-request hand-off for maintainers. The authoritative Codex procedure is the repo-local [`$feature-request-creation`](../.agents/skills/feature-request-creation/SKILL.md) Skill. Repository-wide conventions in [`AGENTS.md`](../AGENTS.md) also apply.

Use this flow when agreed product requirements need to become canonical request data before implementation.

## Stable workflow

```text
Agreed product requirements
-> $feature-request-creation
-> feature-request/<request-id>
-> requests/features/<request-id>.json
-> validation and dry-run rendering
-> one request-only pull request
-> merge lets the trusted workflow create the GitHub issue
```

- The supplied `requestId` is the stable orchestration identity and must remain lowercase and URL-safe.
- The current `.github/ISSUE_TEMPLATE/feature-schema.json` is authoritative for request fields and validation.
- Preserve agreed requirements; adapt representation only when the current schema requires it.
- When several requests are agreed together, put them in one pull request unless the user explicitly asks for separate PRs.
- Request records remain permanent under `requests/features/`.

## Boundaries

- Do not implement the feature.
- Do not modify application runtime code merely to submit a request.
- Do not create the GitHub issue directly.
- Do not move canonical request files into lifecycle folders.
- Do not weaken validation, CI, branch protection, auto-merge, idempotency, or post-merge issue creation.
- Let the post-merge workflow create the issue from the permanent request record.

## Validation

The Skill must inspect the current repository-declared toolchain and commands rather than relying on remembered versions. The canonical request flow includes:

```bash
npm run toolchain:validate
npm run issue:validate
npm run issue:validate-request -- requests/features/<request-id>.json
npm run issue:render -- requests/features/<request-id>.json > /tmp/<request-id>-feature-issue.md
npm test
```

The renderer invocation is a dry run and must not create a GitHub issue.