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
```

- Artifact Library Markdown types are `prompt`, `snippet`, `template`, and `app-idea`.
- Markdown may be nested below its matching namespace. IDs are globally unique.
- A variation is an ordinary same-type Artifact whose `sourceId` identifies its source. There is no `variations/` namespace.
- `agents/` is reserved for executable Agent v2 JSON. Markdown Agent artifacts are unsupported.
- `workflows/` contains semantic Workflow v2 graphs only. Executable definitions under `_adt/` are unsupported.
- Layout JSON is optional presentation state and never changes execution semantics.
- Connection JSON requires an explicit `credential.source: "adt-vault"` and stable `sec_...` reference. Credential material is never stored in Git.
- A Microsoft Work IQ connection uses schema v1, runtime `work-iq-rest`, provider `microsoft-work-iq`, no model, and a strict safe `configuration` containing only `tenantId` and `clientId` UUIDs. Its logical vault reference is safe to store; client secrets, delegated tokens, OAuth state, and authorization codes are not.
- Repository writes use exact observed Git revisions and fail closed on stale or ambiguous mutations.
- Readers reject traversal, unsupported paths, identity mismatch, duplicate IDs, unsafe content, and oversized content.
- Artifact search authority is bounded to the four canonical Artifact Library namespaces and cannot select arbitrary repository paths.

Artifact Library Markdown requires `id`, `title`, `type`, `tags`, and `aliases`; optional stable fields are `description`, `sourceId`, and `createdAt`. Top-level `status` is invalid.

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
