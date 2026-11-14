# Workflow text authoring

- In **New workflow → Text / AI authoring**, choose **Copy authoring context**. The expandable preview supports manual copying when clipboard access is unavailable.
- Supply that JSON to an external authoring tool with your design request. ADT makes no AI request and supplies no new credentials or authority.
- Paste the returned JSON and choose **Load into editor**. Review and repair the draft, then use the ordinary **Create workflow** action.
- Loading replaces meaningful unsaved work only after explicit confirmation. Missing references retain their IDs until you select replacements. Existing Workflow IDs must be changed before creation.

## Clipboard contracts

- Authoring context uses `format: "adt-workflow-authoring-context"`, `version: 1`. It contains sorted Agent IDs/names/descriptions and safe capability flags, reusable Workflow IDs/names/descriptions, registered block versions/ports/config guidance, and current limits.
- Conversation compatibility groups are opaque catalogue-local equality labels. A target must also support continuation. They expose no connection or environment IDs and do not promise live Runner readiness.
- Context excludes Agent/Artifact prompts, provider options, credentials, secret references, repository metadata, and execution state. Descriptions remain user-authored text.
- Transfer is a strict JSON object: `{ "format": "adt-workflow-transfer", "version": 1, "definition": { ... }, "layout": { ... } }`. `layout` is optional. Unknown envelope fields and future versions are rejected.
- `definition` is the canonical Workflow v2 definition, not a separate semantic model. Use the generated context for current block contracts and authoring limits.
- Optional `layout` is canonical Workflow layout v1. Its Workflow ID must match the definition, and its position/waypoint keys must identify existing nodes/edges. Missing positions receive editor defaults. Coordinates must be finite and within one million units of the origin; zoom is 0.1–4; waypoint count follows the existing layout contract.
- Paste raw JSON without Markdown fences, Base64, or executable text. Errors do not echo the pasted payload. Input is bounded using current maximum definition text, graph, and layout limits, allowing worst-case JSON escaping and pretty-print space.
- Transfers accept no revisions, Git SHAs, source paths, run history, checkpoint state, Runtime/Runner state, or credentials. Workflow text fields remain ordinary user-authored text.

The owning contracts are [transfer validation](../lib/workflow-transfer.ts), [context projection](../lib/workflow-authoring-context.ts), the [Block Registry](../lib/workflow-block-registry.ts), [Workflow definitions](../lib/workflow-definitions.ts), and [layout validation](../lib/workflow-layout.ts). Existing authenticated save APIs remain authoritative after loading.

## Agent tool restrictions

- Agent block version 4 supports optional `toolRestrictions.allowlist`, `requireApproval` and lower `limits`, alongside existing context and conversation settings.
- An absent allowlist inherits; an empty list disables all tools. Use only grant identities already held by the referenced Agent. Approval settings can only strengthen inherited requirements.
- The visual editor previews effective grants. Text transfer and ordinary save validation enforce the same semantic contract.
- See [Agent tool policy and recovery](agent-tools-and-recovery.md) for policies, provider support and operator procedures.
