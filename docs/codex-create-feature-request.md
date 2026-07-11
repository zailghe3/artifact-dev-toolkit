# Codex feature-request creation instructions

Use this procedure only when a user gives Codex structured feature-request data and asks Codex to submit it to this repository. This task creates a request for later issue creation; it does **not** implement the feature.

## Required Codex workflow

1. Verify that the working repository is `zailghe3/artifact-dev-toolkit`. Stop if the remote or repository context does not match.
2. Read the current feature schema at `.github/ISSUE_TEMPLATE/feature-schema.json` and the workflow at `docs/development-workflow.md` before editing files.
3. Read `specs/000-current-application-spec.md` to confirm whether the request changes implemented application behaviour. Request creation alone should not require a specification update because it does not implement application behaviour.
4. Create a new branch named `feature-request/<request-id>`, where `<request-id>` is the exact `requestId` supplied in the structured data.
5. Create one canonical request file named `requests/features/<request-id>.json`. When several feature requests are agreed together, place all corresponding JSON files in one pull request unless the user explicitly asks for separate PRs.
6. Preserve the supplied structured feature data without shortening, summarising, replacing, or inventing requirements.
7. Write only schema-compatible issue fields to the JSON request file. Keep `requestId` available for branch and filename naming, but do not rely on it as a rendered issue field unless the schema adds it later.
8. Validate the JSON with the repository's current validation tooling.
9. Run the canonical renderer in dry-run mode with the feature JSON file.
10. Confirm that the rendered output includes the full Codex execution contract and the full definition of done.
11. Run relevant repository checks for a documentation/request-only change.
12. Commit the request and supporting documentation-only changes, if any.
13. Open a non-draft pull request.
14. Summarise the feature request, validation results, and specification review in the pull request description.
15. Stop after opening the pull request.

## Strict boundaries

- Do not implement the feature itself.
- Do not modify application code to satisfy the feature request.
- Do not create the GitHub issue directly.
- Do not move files into `requests/features/processed/` or `requests/features/failed/`.
- Do not weaken validation, branch protection, CI, auto-merge, idempotency, or post-merge issue creation.
- Let the post-merge workflow create the GitHub issue after the feature request reaches `main`; it will keep the JSON as a permanent design record.

## Structured input contract

ChatGPT should provide one or more JSON objects in the Codex prompt. Codex must treat the object as the source data for the feature request.

### Required orchestration field

| Field | Required | Purpose |
| --- | --- | --- |
| `requestId` | Yes | Deterministic branch and file stem. Use `feature-request/<requestId>` and `requests/features/<requestId>.json`. |

Use a lowercase, URL-safe `requestId`, for example `ui-001-theme-support`.

### Current schema-backed issue fields

The feature request JSON must use the camelCase keys from `.github/ISSUE_TEMPLATE/feature-schema.json`:

| Field | Required by schema | Notes |
| --- | --- | --- |
| `featureId` | Yes | Stable feature ID, such as `UI-001`. |
| `title` | Optional | Used by issue creation as the human-readable issue title when present. |
| `priority` | Optional | Metadata for maintainers; not currently rendered by the canonical issue renderer. |
| `objective` | Yes | Implementation-ready product outcome. |
| `userContext` | Yes | Who needs the feature and why. |
| `currentBehaviour` | Yes | Current product state. |
| `requiredBehaviour` | Yes | Required product state after implementation. |
| `userExperience` | No | Desired UX notes. |
| `functionalRequirements` | Yes | Array of concrete requirements. |
| `technicalConsiderations` | No | Constraints, risks, architecture, security, or deployment notes. |
| `outOfScope` | No | Explicit boundaries. |
| `acceptanceCriteria` | Yes | Array of observable completion criteria. |
| `codexGuidance` | No | Implementation guidance for the later issue-based Codex task. |

Unknown metadata may remain in the JSON file, but only schema-backed fields are rendered into the canonical issue body unless repository tooling is changed later.

### Example input

```json
{
  "requestId": "ui-001-theme-support",
  "featureId": "UI-001",
  "title": "Add dark and light themes with theme-specific accents",
  "priority": "medium",
  "objective": "Describe the implementation-ready outcome.",
  "userContext": "Explain who needs this and why.",
  "currentBehaviour": "Describe the current behaviour.",
  "requiredBehaviour": "Describe the required behaviour.",
  "userExperience": "Describe the intended user experience.",
  "functionalRequirements": [
    "List a concrete required behaviour."
  ],
  "technicalConsiderations": [
    "List a relevant technical consideration."
  ],
  "outOfScope": [
    "List something intentionally excluded."
  ],
  "acceptanceCriteria": [
    "List an observable acceptance criterion."
  ],
  "codexGuidance": "Add guidance for the later implementation task."
}
```

## Local validation commands

Run these before opening the pull request, replacing `<request-id>` with the supplied value:

```bash
npm run issue:validate
npm run issue:validate-request -- requests/features/<request-id>.json
npm run issue:render -- requests/features/<request-id>.json > /tmp/<request-id>-feature-issue.md
npm test
```

The render command is a dry run when its output is redirected or inspected locally; it must not call `gh issue create`.
