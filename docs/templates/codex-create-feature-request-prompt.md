# Codex prompt: create a feature request PR

Repository: https://github.com/zailghe3/artifact-dev-toolkit

Use `$feature-request-creation` for this task. Follow `docs/codex-create-feature-request.md` exactly.

Treat the structured feature data below as the agreed product input. Preserve its durable product intent while applying the Skill's outcome-stability, predecessor-independence, overlap, and planned/ready lifecycle rules. Remove unnecessary implementation prescription rather than freezing assumptions that should be rediscovered from current `main` later.

The Skill owns repository inspection, duplicate detection, lifecycle validation, branch/file creation, validation, dry-run rendering, promotion handling, and pull-request mechanics. Create or update the canonical request record(s), open a non-draft pull request, and stop after the pull request is open.

Do not implement the feature. Do not create the GitHub issue directly.

Structured feature data:

```json
{
  "requestId": "<request-id>",
  "requestStatus": "<planned|ready>",
  "featureId": "<FEATURE-000>",
  "title": "<feature title>",
  "priority": "<high|medium|low>",
  "objective": "<durable outcome that remains valid if predecessor implementations change>",
  "userContext": "<who needs this and why>",
  "currentBehaviour": "<product or capability gap observed at planning time>",
  "requiredBehaviour": "<stable end-state behaviour>",
  "userExperience": "<desired user-visible experience>",
  "functionalRequirements": [
    "<observable behavioural requirement or stable invariant>"
  ],
  "technicalConsiderations": [
    "<architecture, security, compatibility, deployment, migration, or operational constraint>"
  ],
  "outOfScope": [
    "<out-of-scope outcome or capability>"
  ],
  "acceptanceCriteria": [
    "<observable or stable contract-level acceptance criterion>"
  ],
  "codexGuidance": "<optional non-binding context to revalidate against current main>"
}
```
