# Development workflow

This repository uses a lightweight product-development workflow for a single maintainer working with ChatGPT for product definition and Codex for implementation.

## Workflow

```text
Idea or problem
→ clarify objective, scope, UX, constraints, and acceptance criteria
→ create an implementation-ready GitHub issue
→ give Codex the full issue URL
→ Codex follows repository guidance and applicable Skills
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

## Repository scaffolding

- [`AGENTS.md`](../AGENTS.md) is the always-on repository map and engineering rule set.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) maps major domains, sources of truth, persistence, trust boundaries, and external-system relationships.
- Repo-local Skills under `.agents/skills/` contain repeatable task-specific procedures and are loaded only when their trigger applies.
- Source, tests, schemas, migrations, configuration, and workflows remain authoritative for exact implementation mechanics.
- When repeated agent failures reveal missing knowledge, routing, or deterministic enforcement, improve the appropriate repository scaffold rather than compensating with increasingly long prompts.

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
→ Codex uses $feature-request-creation
→ Codex writes requests/features/<request-id>.json
→ Codex opens a request-only PR
→ CI validates
→ merge creates the corresponding GitHub issue
```

- The authoritative Codex procedure is [`.agents/skills/feature-request-creation/SKILL.md`](../.agents/skills/feature-request-creation/SKILL.md).
- [`codex-create-feature-request.md`](codex-create-feature-request.md) is the maintainer-facing overview.
- Request JSON files remain permanent design records under `requests/features/`.
- Codex must not implement the feature while creating the request.
- Codex must not create the GitHub issue directly.
- The post-merge workflow uses the immutable request ID to avoid duplicate issue creation.
- Recovery workflows may safely retry missing issue creation without recreating existing issues.

## Codex implementation

A normal implementation launch should remain minimal:

```text
Implement this issue: https://github.com/zailghe3/artifact-dev-toolkit/issues/<number>
```

Codex must follow:

- the repository-wide [`AGENTS.md`](../AGENTS.md);
- any more specific nested `AGENTS.md` files;
- mandatory Skill routing declared by the applicable instructions;
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) when the change crosses mapped component, persistence, trust, or external-system boundaries;
- the complete GitHub issue;
- the issue-specific Codex execution contract embedded in the feature issue.

The issue is the source of truth for implementation scope. Material scope changes should be agreed before implementation continues. Stable repository rules and procedures should not be recopied into every launch prompt.

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

Specification maintenance is part of implementation, not a later documentation task. `$spec-sync` provides the repeatable procedure when product behaviour or a stable invariant changes.

Before an executable implementation or correction PR is reported complete, `$code-change-verification` provides the final verification procedure. High-risk or cross-boundary work uses `$implementation-strategy` before editing.

## Validation and CI/CD

- Use the repository-declared toolchain and canonical scripts rather than duplicating version details here.
- Pull-request workflows validate changes with read-only permissions.
- Sensitive CI/CD, dependency, authentication, credential, migration, persistence, and mutation-related changes require the repository's trusted review path.
- Safe eligible pull requests may use the repository's trusted auto-merge path.
- Changes reaching `main` are verified before production-affecting deployment.
- Documentation-only, specification-only, repo-local Skill-only, and feature-request-only changes may be classified as non-deployable.
- Production credentials are available only to the trusted deployment path, never to pull-request code.

The workflow files and tests are authoritative for trigger mechanics, permissions, classification rules, check names, deployment hand-offs, and recovery implementation.

## Recovery

- Failed PR validation: fix the branch and rerun through a new push.
- Package-lock drift: use the repository's trusted package-lock repair process rather than hand-editing the lockfile.
- Failed feature issue creation: use the feature-request recovery workflow; immutable request IDs prevent duplicate issues.
- Failed production deployment: use the repository's manual deployment recovery workflow against the intended verified commit.

## Related documentation

- [`AGENTS.md`](../AGENTS.md) — repository-wide Codex/contributor rules and Skill routing.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — system map and durable boundaries.
- [`specs/AGENTS.md`](../specs/AGENTS.md) — specification-writing conventions.
- [`.agents/skills/feature-request-creation/SKILL.md`](../.agents/skills/feature-request-creation/SKILL.md) — feature-request procedure.
- [`.agents/skills/implementation-strategy/SKILL.md`](../.agents/skills/implementation-strategy/SKILL.md) — cross-boundary implementation planning.
- [`.agents/skills/code-change-verification/SKILL.md`](../.agents/skills/code-change-verification/SKILL.md) — final implementation verification.
- [`.agents/skills/spec-sync/SKILL.md`](../.agents/skills/spec-sync/SKILL.md) — current-state specification synchronization.
- [`codex-create-feature-request.md`](codex-create-feature-request.md) — human feature-request overview.
- [`templates/adt-collaboration-context.md`](templates/adt-collaboration-context.md) — reusable ChatGPT collaboration/base-prompt template.
- [`dependency-toolchain-maintenance.md`](dependency-toolchain-maintenance.md) — dependency and toolchain policy.
- [`.github/ISSUE_TEMPLATE/shared/codex-execution-contract.md`](../.github/ISSUE_TEMPLATE/shared/codex-execution-contract.md) — issue-specific Codex execution requirements.