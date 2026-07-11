# Codex prompt: create a feature request PR

Repository: https://github.com/zailghe3/artifact-dev-toolkit

Follow `docs/codex-create-feature-request.md` exactly.

Create a branch, write the canonical feature request JSON, validate it, dry-run render it, run relevant checks, open a non-draft pull request, and stop after the pull request is open.

Do not implement the feature. Do not create the GitHub issue directly.

Structured feature data:

```json
{
  "requestId": "<request-id>",
  "featureId": "<FEATURE-000>",
  "title": "<feature title>",
  "priority": "<high|medium|low>",
  "objective": "<implementation-ready outcome>",
  "userContext": "<who needs this and why>",
  "currentBehaviour": "<current behaviour>",
  "requiredBehaviour": "<required behaviour>",
  "userExperience": "<desired user experience>",
  "functionalRequirements": [
    "<required behaviour 1>"
  ],
  "technicalConsiderations": [
    "<technical consideration 1>"
  ],
  "outOfScope": [
    "<out-of-scope item 1>"
  ],
  "acceptanceCriteria": [
    "<observable acceptance criterion 1>"
  ],
  "codexGuidance": "<guidance for the later implementation issue>"
}
```
