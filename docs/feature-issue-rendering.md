# Programmatic feature issue rendering

Use `npm run issue:render -- path/to/feature.json` to render a complete Markdown body for a feature issue created through the GitHub Issues API or another integration.

The renderer accepts either the camelCase keys from `.github/ISSUE_TEMPLATE/feature-schema.json` or the GitHub issue-form field IDs. Required fields are validated before any Markdown is printed.

```json
{
  "featureId": "DEV-001",
  "objective": "Describe the product outcome.",
  "userContext": "Explain who needs this and why.",
  "currentBehaviour": "Describe what happens today.",
  "requiredBehaviour": "Describe the expected behaviour after implementation.",
  "functionalRequirements": ["Requirement one", "Requirement two"],
  "acceptanceCriteria": "- [ ] Observable criterion"
}
```

The Codex execution contract lives in `.github/ISSUE_TEMPLATE/shared/codex-execution-contract.md`. GitHub issue forms cannot include external Markdown, so `.github/ISSUE_TEMPLATE/feature.yml` contains an embedded copy for the interactive form. Run `npm run issue:validate` after changing feature issue structure; it verifies that the form, shared schema, definition of done, and canonical contract have not drifted apart.
