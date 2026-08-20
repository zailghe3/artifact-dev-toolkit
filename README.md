# Artifact Library

Artifact Library helps authorised users find, reuse, create, edit, and safely manage reusable work assets stored in GitHub. It also provides durable sequential Agent Workflows for running configured agents through supported execution connections.

## Main capabilities

### Artifact Library

- Search reusable prompts, agents, snippets, templates, and app ideas.
- Read rendered artifacts and copy their reusable Markdown body.
- Create new draft artifacts or draft variations of existing artifacts.
- Edit draft and archived artifacts directly.
- Propose production changes and deletions through reviewable pull requests.
- Protect changes from stale concurrent edits.
- Refresh the catalogue and inspect safe operational diagnostics.

### Agent Workflows

- Configure named execution connections and reusable Agents.
- Build ordered, bounded, sequential Workflows.
- Run workflows durably with persisted handoffs and execution history.
- Retry eligible failures without losing prior attempts.
- Cancel active runs without silently duplicating provider work.
- Use supported OpenAI Responses or self-hosted Codex Runner connections.
- Inspect safe Runner readiness, workspace, and job status where supported.

## Product principles

- GitHub remains the source of truth for persisted artifacts.
- Production artifact changes are reviewable and are never automatically merged by the application.
- Stale or ambiguous mutations fail safely rather than overwriting or duplicating work.
- Credentials and private provider configuration remain server-side.
- Diagnostics expose bounded operational information without artifact bodies, secrets, raw credentials, or arbitrary upstream responses.
- Specifications describe stable behaviour and direction; implementation detail belongs in code, contracts, and operational documentation.

## Documentation

| Document | Purpose |
| --- | --- |
| [Current application specification](specs/000-current-application-spec.md) | High-level implemented Artifact Toolkit behaviour and product invariants |
| [Agent Workflows specification](specs/agent-workflows.md) | Current Agent, Workflow, Run, provider, and Codex Runner behaviour |
| [External artifact repository contract](docs/external-artifact-repository-contract.md) | Artifact repository layout, metadata, and validation contract |
| [GitHub artifact deployment](docs/github-artifact-deployment.md) | Production architecture, configuration, and operations |
| [Development workflow](docs/development-workflow.md) | Maintainer workflow and delivery process |
| [Dependency and toolchain maintenance](docs/dependency-toolchain-maintenance.md) | Runtime baseline and dependency maintenance policy |
| [Codex Runner](codex-runner/README.md) | Runner deployment, protocol, workspace, and operational reference |

## Documentation boundaries

- `specs/` describes current product behaviour and stable safety or lifecycle invariants.
- `docs/` contains external contracts, maintainer processes, deployment guidance, templates, examples, and historical technical records.
- `codex-runner/README.md` contains implementation and operational detail specific to the independently deployed Runner.
- Source code and tests remain authoritative for implementation mechanics.
