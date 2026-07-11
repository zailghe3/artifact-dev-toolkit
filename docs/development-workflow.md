# Development workflow

This repository uses a lightweight product-development workflow designed for a single maintainer working with ChatGPT for product design and Codex for implementation.

## 1. Workflow overview

```text
Idea or problem
  → discuss and refine the objective
  → define scope, UX, and acceptance criteria
  → create a GitHub issue
  → mark the issue ready for Codex
  → Codex implements the issue and opens a pull request
  → CI validates the change
  → review and merge
  → specification reflects the implemented application
```

The repository separates three concerns:

- **Product discussion:** clarify what should be built and why.
- **Feature ID:** identify a product capability independently from GitHub issue numbers.
- **GitHub issue:** provide the implementation contract for Codex and remain the canonical work-item tracker.
- **Current application specification:** describe what is actually implemented after the change is merged.

## 2. Discuss before implementation

Use product discussion to clarify:

- the user problem and intended outcome;
- the current behaviour;
- the desired user experience;
- functional requirements;
- architectural, security, and deployment constraints;
- edge cases;
- what is explicitly out of scope;
- observable acceptance criteria.

An idea should not be handed to Codex while material product decisions are still unresolved.

## 3. Feature IDs

Every feature issue must include a stable **Feature ID** before implementation starts. A Feature ID identifies the product capability being introduced or changed. It is separate from the GitHub issue number:

- the Feature ID identifies the capability across issues, pull requests, documentation, and follow-up discussion;
- the GitHub issue number remains the canonical work-item tracker and merge target;
- pull requests should include the Feature ID in their title or summary and still use `Closes #<number>` to close the GitHub issue.

Use the following convention unless a future repository decision changes it:

```text
<AREA>-<THREE_DIGIT_SEQUENCE>
```

Examples:

```text
DEV-001
ART-002
DOC-003
```

Choose a short uppercase area prefix that describes the capability area, followed by a three-digit sequence. Do not reuse a Feature ID for a different capability.

## 4. Create an issue

Use the appropriate issue form:

- **Feature request** for a new capability or improvement;
- **Bug report** for incorrect or unexpected behaviour.

An implementation-ready issue should be understandable without relying on a separate chat history. It should contain enough context for Codex to identify the intended outcome and verify completion. Each feature issue must be a self-sufficient implementation contract: Codex should not need product chat transcripts, external notes, or undocumented assumptions to complete the work.

### Suggested labels

Use a small, consistent label set:

```text
type:feature
type:bug
type:documentation
type:technical-debt

status:needs-design
status:ready-for-codex
status:blocked

priority:high
priority:medium
priority:low
```

`status:ready-for-codex` means:

- the objective is clear;
- the scope has been agreed;
- required behaviour and acceptance criteria are documented;
- known technical constraints are recorded;
- Codex can begin without further product clarification.

Do not use the `auto-merge` label on issues. It applies to pull requests only.


### Automated feature issue requests

Feature issues can also be created from committed JSON request files. Add one JSON file per feature request under:

```text
requests/features/pending/
```

The JSON keys match `.github/ISSUE_TEMPLATE/feature-schema.json`. Use the camelCase keys shown in the schema, for example:

```json
{
  "featureId": "DEV-001",
  "objective": "Describe the implementation-ready outcome.",
  "userContext": "Explain who needs this and why.",
  "currentBehaviour": "Describe the current state.",
  "requiredBehaviour": "Describe the required state.",
  "functionalRequirements": [
    "List required behaviours as concrete requirements."
  ],
  "acceptanceCriteria": [
    "List observable criteria that prove the feature is complete."
  ]
}
```

When a pending request JSON file is added and pushed, the `Create feature issues from requests` GitHub Actions workflow validates the issue template, renders the request with the repository renderer, creates a GitHub issue, and moves the request to one of these locations with processing metadata:

```text
requests/features/processed/
requests/features/failed/
```

Processed records include the created issue URL. Failed records include the error message so the request can be corrected and recommitted as a new pending JSON file.

## 5. Codex implementation launch

Launching Codex for a feature issue should require only three steps:

1. Complete and review the issue.
2. Mark it ready for Codex.
3. Give Codex only the full GitHub issue URL.

A typical Codex instruction is now minimal:

```text
Implement this issue: https://github.com/zailghe3/artifact-dev-toolkit/issues/<number>
```

The feature issue template contains the complete Codex execution contract, including repository verification, issue-as-source-of-truth requirements, scope boundaries, specification maintenance, validation, and pull request closing expectations. No additional implementation prompt should normally be required.

Use the full GitHub issue URL rather than only an issue number. Issue numbers alone are discouraged because they are ambiguous outside a confirmed repository context and make it easier to launch Codex against the wrong repository or work item.

Codex should use the issue as the complete source of truth for scope. Material deviations should be discussed and reflected in the issue before implementation continues.

## 6. Pull request expectations

Each implementation pull request should:

1. include the Feature ID in the title or summary;
2. link to the issue using `Closes #<number>` or an equivalent closing keyword;
3. explain the user-visible and technical changes;
4. remain within the issue scope;
5. include relevant tests or validation;
6. pass CI, typechecking, and production build checks;
7. review the current application specification;
8. update `specs/000-current-application-spec.md` in the same pull request whenever implemented or expected behaviour changes;
9. identify any intentional follow-up work rather than silently expanding scope.

The specification update is part of development, not a later documentation task.

For a behaviour-changing feature, a pull request is incomplete until the specification describes the new implemented state.

For a bug fix, the specification must be reviewed. Update it when the fix changes documented behaviour or exposes that the previous specification was inaccurate. A purely internal fix may require no text change, but the PR should state that the specification was reviewed.

## 7. Specification maintenance

`specs/000-current-application-spec.md` is the baseline description of the application as it exists now.

It must not describe unimplemented roadmap items as current behaviour.

When implementation changes the application:

- update the relevant existing section;
- add a section only when the new behaviour does not fit the current structure;
- update exclusions when a previously excluded capability is implemented;
- update acceptance criteria where the operational baseline changes;
- keep architectural and deployment limitations accurate.

Feature proposals remain in GitHub issues until implemented. The current specification is updated only as part of the implementation pull request.

## 8. Review and merge

Before merging, confirm:

- the issue acceptance criteria are satisfied;
- CI checks have passed;
- no unresolved review comments remain;
- the specification has been reviewed and updated as required;
- the pull request closes the issue;
- no credentials, secrets, or confidential content were committed.

Use a draft pull request when work is not ready to merge. Use the `auto-merge` label only when the pull request is safe to merge automatically after required checks pass.

## 9. Scope management

Prefer small issues that can be implemented and verified in one focused pull request.

Split a larger capability when it contains independently valuable or risky work. For example:

```text
Persistent artifact management
  → implement GitHub-backed repository
  → add authentication for write actions
  → persist variations
  → create new artifacts from the UI
  → add editing and promotion workflows
```

Do not add unrelated improvements to an implementation pull request. Capture them as separate issues.

## 10. Definition of done

A change is done when:

- the agreed behaviour is implemented;
- acceptance criteria are satisfied;
- relevant checks pass;
- security and deployment implications have been considered;
- the Feature ID is referenced in the pull request;
- the issue is linked and will close on merge;
- the current application specification has been reviewed and updated in the same pull request where required;
- the merged repository accurately describes and implements the same product state.
