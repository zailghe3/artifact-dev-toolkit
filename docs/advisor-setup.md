# Set up Advisor

Advisor runs an ordinary visible Workflow under an additional read-only boundary. It does not receive a privileged identity or bypass normal Agent, tool, Security Profile, repository, or execution controls.

## Configure Advisor

- Choose or create a compatible provider Connection and ordinary Agent/Workflow definitions.
- To create the default definitions in a local checkout of the configured artifact-definition repository, run:

  ```sh
  npm run advisor:definitions -- /path/to/artifact-definitions tool-capable-connection-id
  ```

- The generator creates the default Advisor Agent and Workflow only when they do not already exist. It does not publish Git changes, configure credentials, or activate Advisor.
- Review and commit those definitions through the normal Git-backed definition process.
- In **Advisor → Advisor settings**, select the Workflow and save. Optional execution overrides select existing compatible provider/model configuration without rewriting saved Agent or Workflow definitions.
- Commission Runtime and the selected provider/tool/security boundaries separately before relying on Advisor.
- New questions use current definitions; an active/recovered question keeps its frozen execution snapshot.

Provider/model-specific compatibility rules belong to the provider registry, connection UI, and current validation code rather than this setup guide.

## Evidence and authority

- Advisor may use only explicitly granted native ADT read capabilities.
- Native reads are bound to the authorised repository/run context and return bounded, sanitised observations rather than unrestricted application/database access.
- Ordinary metadata reads exclude sensitive prompts, raw execution content, arbitrary provider/tool payloads, and unsafe error text.
- Sensitive observability capabilities are separate explicit grants and require exact-call human approval with acknowledgement that selected content may be disclosed to the configured model.
- Approval never bypasses repository authority, cancellation, Security Profile restrictions, or frozen Agent/Workflow budgets.
- Retrieved instructions, execution content, diagnostics, and knowledge are untrusted model input and cannot alter technical permissions.
- MCP, Artifact Search, Codex execution, Git publication, and conversation continuation remain unavailable to Advisor unless the current product specification explicitly changes that boundary.
- Scheduling, notifications, autonomous configuration changes, and persistent multi-turn memory remain outside the Advisor contract.

Exact native tool names, pagination/size limits, sampling bounds, and execution budgets are authoritative in source, tests, and the application UI.

## Review and publish knowledge

- **Browse knowledge and review proposals** shows reviewed Git knowledge and private operational proposals.
- **Save to knowledge** creates a proposal from a finished analysis; it does not publish model output automatically.
- Treat suggested title, subjects, relationships, evidence, and Markdown as untrusted draft content and review them explicitly.
- Saving a draft persists operational proposal state in Runtime PostgreSQL.
- Publication is a separate authenticated human action that displays the exact proposed document and Git target before consent.
- Publication revalidates current repository authority and uses optimistic Git concurrency. Detected secret material cannot be published.
- Edits after review require a new review/consent.
- An uncertain Git publication outcome is never automatically replayed; inspect the authoritative Git entry/history before attempting another mutation.
- Approved knowledge lives in Git and follows the [Advisor knowledge contract](external-artifact-repository-contract.md#advisor-knowledge).

Runtime remains responsible for proposal/review operational state; the Worker retains the browser/repository-authorised Git mutation boundary for human publication.

## Commissioning and recovery

- The GitHub App must have the repository Contents authority required for human knowledge publication.
- Validate the configured artifact repository with the canonical repository validator before relying on knowledge search/publication.
- Use focused Advisor questions and normal Workflow execution limits rather than attempting to load unbounded history/content.
- After restoring Runtime operational state, validate Advisor settings with a representative read-only tool-using Workflow.
- Published knowledge remains recoverable from Git independently of Runtime proposal state.

Exact search/result/proposal limits, consent lifetimes, and UI pagination values are implementation details and may change without altering the Advisor authority model.
