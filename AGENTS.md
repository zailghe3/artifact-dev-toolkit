# Repository instructions

These instructions apply to Codex and other coding agents working in this repository.

## Scope and sources of truth

- Treat the current task or GitHub issue as the scope boundary.
- Read applicable `AGENTS.md` files before editing.
- Prefer authoritative repository sources over duplicated documentation.
- Use `.nvmrc`, `package.json`, and repository scripts for the current toolchain and validation commands.
- Respect documented compatibility holds and maintenance decisions.
- Do not add unrelated dependency, framework, runtime, compiler, deployment-tool, or GitHub Actions upgrades.

## Implementation

- Follow existing repository patterns unless the task explicitly changes them.
- Reuse existing configuration, constants, helpers, components, and abstractions where appropriate.
- Avoid duplicated configuration, unexplained literals, hidden behaviour, and unnecessary abstractions.
- Keep changes focused and remove obsolete in-scope code or configuration made redundant by the change.
- Preserve explicit contracts, deterministic behaviour, least privilege, secure defaults, and clear failure modes.
- Do not weaken tests, linting, type checking, build validation, workflow security, deployment checks, or security controls merely to make a change pass.

## Dependencies and generated files

- Change dependencies only when required by the task.
- Prefer existing platform capabilities and repository dependencies before adding packages.
- Generate `package-lock.json` with npm; do not hand-edit lockfile internals.
- Do not use forced upgrades, blanket overrides, or validation bypasses to silence dependency issues.
- Produce generated files only through declared repository commands.
- Do not commit incidental validation side effects.

## Security-sensitive changes

For authentication, authorisation, secrets, repository writes, deployment configuration, or other privileged operations:

- enforce authorisation server-side;
- use least-privilege permissions;
- validate inputs and repository targets;
- keep secrets and tokens out of logs, errors, client bundles, and generated artifacts;
- fail safely on ambiguous mutations and stale state;
- cover denied, invalid, failure, and success paths where relevant.

## Documentation

- Prefer short, concise bullet-point sentences.
- Give each document one clear purpose.
- Avoid duplicating information already authoritative elsewhere.
- Link to contracts, configuration, code, or operational documentation instead of restating them.
- Keep implementation detail out of high-level product specifications.
- Preserve historical decision records unless the task explicitly changes them.
- Keep documentation changes proportional to the behaviour or contract being changed.

## Validation and pull requests

- Run the repository checks relevant to the files and behaviour changed.
- Report checks accurately as passed, failed, inapplicable, or not completed because of an environment restriction.
- Inspect the final diff and ensure every tracked change is intentional and in scope.
- For issue-driven work, follow the issue-specific Codex execution contract and include the required closing reference in the pull request.
- Report validation for the final pull-request head, not an earlier commit.