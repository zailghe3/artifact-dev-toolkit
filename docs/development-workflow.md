# Development workflow

This repository uses a lightweight product-development workflow for a single maintainer working with ChatGPT for product definition and Codex for implementation.

## Workflow

```text
Idea or problem
→ clarify objective, scope, UX, constraints, and acceptance criteria
→ create an implementation-ready GitHub issue
→ give Codex the full issue URL
→ Codex implements and opens a pull request
→ CI validates
→ review and merge
→ current specifications reflect implemented behaviour
```

## Product discussion

Before implementation, clarify:

- the user problem and intended outcome;
- current and required behaviour;
- user experience;
- functional requirements;
- architecture, security, compatibility, and deployment constraints;
- edge cases and explicit out-of-scope boundaries;
- observable acceptance criteria.

Do not hand unresolved product decisions to Codex.

## Feature IDs and issues

- Every feature issue has a stable Feature ID such as `DEV-001` or `ART-002`.
- Feature IDs identify capabilities independently from GitHub issue numbers.
- GitHub issues remain the canonical implementation work items.
- Implementation-ready issues must be understandable without product-chat history or undocumented assumptions.
- `status:ready-for-codex` means the objective, scope, requirements, constraints, and acceptance criteria are sufficiently defined for implementation.
- Pull requests include the Feature ID and an issue closing reference such as `Closes #123`.

## Automated feature-request creation

For programmatic ChatGPT-to-Codex hand-off:

```text
Discuss and agree feature(s)
→ ChatGPT supplies structured request data
→ Codex writes requests/features/<request-id>.json
→ Codex opens a request-only PR
→ CI validates
→ merge creates the corresponding GitHub issue
```

- Follow [`codex-create-feature-request.md`](codex-create-feature-request.md).
- Request JSON files remain permanent design records under `requests/features/`.
- Codex must not implement the feature while creating the request.
- Codex must not create the GitHub issue directly.
- The post-merge workflow uses the immutable request ID to avoid duplicate issue creation.
- Recovery workflows may safely retry missing issue creation without recreating existing issues.

## Codex implementation

A normal implementation launch should be minimal:

```text
Implement this issue: https://github.com/zailghe3/artifact-dev-toolkit/issues/<number>
```

Codex must follow:

- the repository-wide [`AGENTS.md`](../AGENTS.md);
- any more specific nested `AGENTS.md` files;
- the complete GitHub issue;
- the issue-specific Codex execution contract embedded in the feature issue.

The issue is the source of truth for implementation scope. Material scope changes should be agreed before implementation continues.

## Pull request expectations

Each implementation pull request should:

- remain within the issue scope;
- explain user-visible and material technical changes;
- include the Feature ID;
- include the exact issue closing reference;
- include relevant tests and validation;
- accurately report failed, unavailable, or inapplicable checks;
- review the relevant current specification files;
- update the relevant specification in the same pull request when implemented behaviour changes;
- identify intentional follow-up work rather than silently expanding scope.

Specification maintenance is part of implementation, not a later documentation task.

## Validation and CI/CD

- Use the repository-declared toolchain and canonical scripts rather than duplicating version details here.
- Pull-request workflows validate changes with read-only permissions.
- Sensitive CI/CD, dependency, authentication, credential, migration, persistence, and mutation-related changes require the repository's trusted review path.
- Safe eligible pull requests may use the repository's trusted auto-merge path.
- Changes reaching `main` are verified before production-affecting deployment.
- Documentation-only, specification-only, and feature-request-only changes may be classified as non-deployable.
- Production credentials are available only to the trusted deployment path, never to pull-request code.

The workflow files and tests are authoritative for trigger mechanics, permissions, classification rules, check names, deployment hand-offs, and recovery implementation.

## Recovery

- Failed PR validation: fix the branch and rerun through a new push.
- Package-lock drift: use the repository's trusted package-lock repair process rather than hand-editing the lockfile.
- Failed feature issue creation: use the feature-request recovery workflow; immutable request IDs prevent duplicate issues.
- Failed production deployment: use the repository's manual deployment recovery workflow against the intended verified commit.

## Related documentation

- [`AGENTS.md`](../AGENTS.md) — repository-wide Codex and contributor conventions.
- [`specs/AGENTS.md`](../specs/AGENTS.md) — specification-writing conventions.
- [`codex-create-feature-request.md`](codex-create-feature-request.md) — request-creation procedure.
- [`dependency-toolchain-maintenance.md`](dependency-toolchain-maintenance.md) — dependency and toolchain policy.
- [`.github/ISSUE_TEMPLATE/shared/codex-execution-contract.md`](../.github/ISSUE_TEMPLATE/shared/codex-execution-contract.md) — issue-specific Codex execution requirements.
