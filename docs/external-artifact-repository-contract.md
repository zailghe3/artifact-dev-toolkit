# DATA-001 External Artifact Repository Contract

The authoritative branch is `main`. Current repository content uses canonical root-level namespaces only.

```text
prompts/**/*.md
snippets/**/*.md
templates/**/*.md
app-ideas/**/*.md
agents/<id>.agent.json
workflows/<id>.workflow.json
workflows/<id>.layout.json
connections/<id>.connection.json
tools/<id>.mcp.json
security-profiles/<id>.json
advisor/knowledge/<id>.md
```

- Artifact Library Markdown types are `prompt`, `snippet`, `template`, and `app-idea`.
- Markdown may be nested below its matching namespace. IDs are globally unique.
- A variation is an ordinary same-type Artifact whose `sourceId` identifies its source. There is no `variations/` namespace.
- `agents/` is reserved for executable Agent v2 JSON. Markdown Agent artifacts are unsupported.
- `workflows/` contains semantic Workflow v2 graphs only. Executable definitions under `_adt/` are unsupported.
- Layout JSON is optional presentation state and never changes execution semantics.
- Connection JSON requires an explicit `credential.source: "adt-vault"` and stable `sec_...` reference. Credential material is never stored in Git.
- MCP tool integration JSON contains the remote HTTPS configuration, vault reference, and last explicitly discovered frozen catalogue. Endpoint URLs cannot contain user information, query parameters, or fragments. Store bearer credentials in the vault.
- Security Profile JSON contains only validated non-secret trust configuration. Security Profile credentials remain in the encrypted ADT vault and are never stored in Git.
- A Microsoft Work IQ connection uses schema v1, runtime `work-iq-rest`, provider `microsoft-work-iq`, no model, and a strict safe `configuration` containing only `tenantId` and `clientId` UUIDs. Its logical vault reference is safe to store; client secrets, delegated tokens, OAuth state, and authorization codes are not.
- Repository writes use exact observed Git revisions and fail closed on stale or ambiguous mutations.
- Readers reject traversal, unsupported paths, identity mismatch, duplicate IDs, unsafe content, and oversized content.
- Artifact search authority is bounded to the four canonical Artifact Library namespaces and cannot select arbitrary repository paths.

Artifact Library Markdown requires `id`, `title`, `type`, `tags`, and `aliases`; optional stable fields are `description`, `sourceId`, and `createdAt`. Top-level `status` is invalid.

Artifact and Advisor Markdown use a single YAML mapping between standalone `---` lines. Use plain data with string keys and avoid YAML language markers, explicit tags, aliases, anchors, and duplicate keys. Metadata must fit within 32 KiB. The body can contain ordinary Markdown, including horizontal rules and fenced YAML examples.

## Advisor knowledge

- `advisor/knowledge/<id>.md` is the single, flat knowledge namespace; content-type subdirectories and symlinks are rejected. It is separate from the Artifact Library and executable definitions.
- IDs use lower-case words/digits separated by hyphens (maximum 80 characters), match the filename, and are unique within knowledge. An Artifact may use the same ID without becoming knowledge.
- Required metadata: `id`, `title`, `type` (`decision`, `principle`, `finding`, `design`), and `status` (`active`, `resolved`, `superseded`). `tags` defaults to an empty list.
- Optional references: `workflowIds`, `agentIds`, `runIds`, `related`, `supersedes`, and `evidence` objects containing `source` and `revision`. Optional timestamps are quoted ISO UTC strings `createdAt` and `updatedAt`.
- Markdown, including YAML frontmatter, must fit within 32 KiB. Unknown metadata, mismatched IDs, self-references and invalid reference syntax are rejected.
- `active` means current reviewed knowledge. `resolved` records a completed investigation or implementation. `superseded` marks replaced knowledge. The body must distinguish recommendations, accepted decisions, implementation evidence and measured outcomes; status alone proves none of those claims.
- Links in `related` and `supersedes` identify other stable knowledge IDs. Publishing a replacement does not mutate the older entry; marking it superseded requires its own review and publication.
- Git revision history preserves prior content. Search is deterministic and includes lifecycle filters; a historical finding is not automatically current evidence.

```markdown
---
id: retry-policy
title: Inspect ambiguous operations before retrying
type: decision
status: active
tags: [recovery]
workflowIds: [review]
related: []
supersedes: []
---
Accepted choice and rationale. Record implementation and outcome evidence separately.
```

Safe Work IQ connection shape:

```json
{
  "schemaVersion": 1,
  "id": "microsoft-work",
  "name": "Microsoft 365 Work IQ",
  "runtime": "work-iq-rest",
  "provider": "microsoft-work-iq",
  "configuration": {
    "tenantId": "11111111-1111-4111-8111-111111111111",
    "clientId": "22222222-2222-4222-8222-222222222222"
  },
  "credential": {
    "source": "adt-vault",
    "secretRef": "sec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
  }
}
```

```bash
npm run artifacts:validate -- <artifact-repository-checkout>
```
