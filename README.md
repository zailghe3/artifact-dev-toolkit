# Artifact Dev Toolkit

Artifact Dev Toolkit helps authorised users manage reusable work assets in GitHub and run bounded Agent Workflows through supported execution providers.

## Main capabilities

### Artifact Library

- Search reusable prompts, snippets, templates, and app ideas.
- Read rendered artifacts and copy their reusable Markdown body.
- Create, preview, edit, vary, and delete artifacts without lifecycle metadata.
- Represent variations as ordinary same-type artifacts linked through `sourceId`.
- Protect repository mutations from stale or ambiguous writes.
- Refresh the catalogue and inspect safe operational diagnostics.

### Agent Workflows

- Configure Git-backed provider connections and reusable Agents.
- Author bounded Workflow v2 graphs with Agents and deterministic control blocks.
- Keep visual layout separate from executable Workflow semantics.
- Run Workflows durably with history, retry, cancellation, approvals, branching, and bounded parallel or cyclic execution.
- Use supported OpenAI execution paths or the independently deployed Codex Runner.
- Inspect safe provider and Runner readiness where supported.

## Product principles

- GitHub is authoritative for reusable artifacts and Git-backed non-secret executable configuration.
- Provider credential values live in the encrypted ADT vault rather than Git.
- Cloudflare remains the authorised control and durable-state plane.
- ADT's semantic Workflow model remains independent from visual, orchestration, and provider frameworks.
- Stale, ambiguous, or potentially duplicate external work fails safely.
- Specifications describe stable behaviour; implementation mechanics belong in code, tests, contracts, and operational documentation.

## Documentation

| Document | Purpose |
| --- | --- |
| [Repository instructions](AGENTS.md) | Repository-wide Codex/contributor conventions and Skill routing |
| [Architecture](ARCHITECTURE.md) | Major domains, sources of truth, persistence, trust boundaries, and system relationships |
| [Current application specification](specs/000-current-application-spec.md) | High-level implemented Artifact Toolkit behaviour and product invariants |
| [Agent Workflows specification](specs/agent-workflows.md) | Current Agent, Workflow, Run, provider, and Codex Runner behaviour |
| [Development workflow](docs/development-workflow.md) | Maintainer workflow, Codex hand-off, and repository scaffolding |
| [ADT collaboration context](docs/templates/adt-collaboration-context.md) | Reusable ChatGPT collaboration/base-prompt template |
| [External artifact repository contract](docs/external-artifact-repository-contract.md) | Artifact repository layout, metadata, and validation contract |
| [GitHub artifact deployment](docs/github-artifact-deployment.md) | Production configuration and operator recovery |
| [Dependency and toolchain maintenance](docs/dependency-toolchain-maintenance.md) | Dependency and toolchain maintenance policy |
| [ADT Runtime](adt-runtime/README.md) | Stateless AI execution boundary and operator contract |
| [Codex Runner](codex-runner/README.md) | Runner configuration, workspace, jobs, compatibility, and operations |

Repo-local Codex Skills are stored under `.agents/skills/`; root `AGENTS.md` defines when they are mandatory.

## Documentation boundaries

- `AGENTS.md` defines durable repository-wide agent/contributor conventions and routes repeatable work to Skills.
- `ARCHITECTURE.md` is the concise map of major system relationships and durable boundaries.
- `.agents/skills/` contains focused repeatable Codex procedures; deterministic mechanics remain in scripts and CI.
- `specs/` describes current product behaviour and stable invariants.
- `docs/` contains external contracts, maintainer processes, deployment guidance, templates, examples, and historical records.
- Component READMEs contain operational detail for independently deployed services.
- Source, tests, schemas, migrations, configuration, and workflows remain authoritative for implementation mechanics.
