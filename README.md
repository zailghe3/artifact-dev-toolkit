# Artifact Dev Toolkit

Artifact Dev Toolkit helps authorised users manage reusable work assets in GitHub and run bounded Agent Workflows through supported execution providers and tools.

## Main capabilities

### Artifact Library

- Search reusable prompts, snippets, templates, and app ideas.
- Read rendered artifacts and copy their reusable Markdown body.
- Create, preview, edit, vary, and delete artifacts without lifecycle metadata.
- Protect repository mutations from stale or ambiguous writes.
- Refresh the catalogue and inspect safe operational diagnostics.

### Agent Workflows

- Configure Git-backed provider connections, tools, Security Profiles, reusable Agents, and Workflow graphs.
- Run Workflows durably with history, retry, cancellation, approvals, branching, bounded cycles, and managed external work.
- Use supported provider execution through ADT Runtime and isolated Codex execution through Codex Runner.
- Keep credentials outside Git-authored Agent and Workflow definitions.

### Advisor

- Launch an explicitly configured ordinary Workflow for on-demand analysis.
- Grant only selected read capabilities and preserve reviewed knowledge in Git.
- Keep model execution read-only; publication remains a separate authenticated human action.

## Product principles

- GitHub is authoritative for reusable artifacts, reviewed knowledge, and Git-backed non-secret configuration.
- The Cloudflare Worker stays a thin public control plane for user authentication, repository admission, GitHub authority, and browser-facing coordination.
- ADT Runtime is the durable execution and private-service plane. It owns Workflow operational state, the encrypted provider/tool vault, provider and tool execution, and integrations that need homelab/private-network access.
- Private infrastructure authority belongs in Runtime or another purpose-specific trusted service rather than in the browser or Cloudflare Worker.
- Codex Runner remains a separate trust boundary for model-directed command execution and managed Git operations.
- ADT's semantic Workflow model remains independent from visual, orchestration, provider, and security frameworks.
- Stale, ambiguous, or potentially duplicate external work fails safely and is reconciled rather than blindly repeated.
- Specifications describe stable behaviour; implementation mechanics belong in code, tests, contracts, and operational documentation.

## Documentation

| Document | Purpose |
| --- | --- |
| [Repository instructions](AGENTS.md) | Repository-wide Codex/contributor conventions and Skill routing |
| [Architecture](ARCHITECTURE.md) | Major domains, sources of truth, persistence, trust boundaries, and system relationships |
| [Current application specification](specs/000-current-application-spec.md) | High-level implemented Artifact Toolkit behaviour and product invariants |
| [Agent Workflows specification](specs/agent-workflows.md) | Current Agent, Workflow, Run, provider, tool, and Codex behaviour |
| [Development workflow](docs/development-workflow.md) | Maintainer workflow, Codex hand-off, and repository scaffolding |
| [ADT collaboration context](docs/templates/adt-collaboration-context.md) | Reusable ChatGPT collaboration/base-prompt template |
| [External artifact repository contract](docs/external-artifact-repository-contract.md) | Artifact repository layout, metadata, and validation contract |
| [GitHub artifact deployment](docs/github-artifact-deployment.md) | Production configuration and operator recovery |
| [Dependency and toolchain maintenance](docs/dependency-toolchain-maintenance.md) | Dependency and toolchain maintenance policy |
| [ADT Runtime](adt-runtime/README.md) | Durable execution/private-service boundary and operator contract |
| [Codex Runner](codex-runner/README.md) | Runner security, workspace, jobs, compatibility, and operations |

Repo-local Codex Skills are stored under `.agents/skills/`; root `AGENTS.md` defines when they are mandatory.

## Documentation boundaries

- `AGENTS.md` defines durable repository-wide agent/contributor conventions and routes repeatable work to Skills.
- `ARCHITECTURE.md` is the concise map of major system relationships and durable boundaries.
- `.agents/skills/` contains focused repeatable Codex procedures; deterministic mechanics remain in scripts and CI.
- `specs/` describes current product behaviour and stable invariants.
- `docs/` contains external contracts, maintainer processes, deployment guidance, templates, examples, design records, and historical records.
- Component READMEs contain operational detail for independently deployed services.
- Source, tests, schemas, migrations, configuration, and workflows remain authoritative for implementation mechanics.
