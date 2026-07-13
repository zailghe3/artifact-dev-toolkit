## Codex execution contract

This issue is intended to be a self-sufficient instruction for Codex. When Codex is launched with the full GitHub issue URL, Codex must:

- treat the current GitHub issue as the complete implementation contract and single source of truth;
- read the complete issue before changing code;
- verify that the issue belongs to `zailghe3/artifact-dev-toolkit`;
- verify that the issue title, Feature ID, objective, required behaviour, and expected scope are mutually consistent;
- briefly restate the understood objective and likely areas of change before implementation;
- stop without modifying code if the issue cannot be retrieved, belongs to another repository, is incomplete, or conflicts with the task context;
- never substitute another issue, prior task, inferred feature, or remembered requirement;
- remain strictly within the stated scope and out-of-scope boundaries;
- not implement unrelated improvements;
- for normal functional implementation PRs, not include unrelated dependency, framework, runtime, compiler, linting, deployment-tool, or GitHub Actions upgrades;
- treat major toolchain changes as out of scope unless the GitHub issue explicitly requires that migration;
- respect documented compatibility holds and maintenance decisions, including `docs/dependency-toolchain-maintenance.md` and the current TypeScript migration assessment in `docs/dev-007-typescript-7-assessment.md`, instead of opportunistically upgrading packages because newer versions exist;
- use the repository toolchain contract: Node.js 24 from `.nvmrc` and npm 11 from `package.json` `packageManager`;
- reuse existing environment variables, configuration values, constants, templates, helpers, components, and abstractions instead of duplicating or hard-coding equivalent values;
- avoid unexplained literals, duplicated configuration, hidden behaviour, and magic values;
- introduce a new environment variable or configuration value only when it represents genuine runtime or deployment configuration, and keep definitions, examples, validation, typing, documentation, and deployment configuration consistent;
- when a dependency change is genuinely required, justify every added, removed, or changed direct dependency; verify compatibility with the repository's supported runtime, framework, linting, type-checking, Cloudflare, and deployment stack; use the repository's canonical Node and npm versions; generate `package-lock.json` through npm rather than manually editing lockfile internals; avoid `npm audit fix --force`, forced major upgrades, blanket overrides, or weakened validation merely to silence findings; cooperate with the repository's package-lock repair automation instead of duplicating or bypassing it; refresh the branch after any automation-generated repair commit; and ensure final validation and PR reporting refer to the final PR head, not a pre-repair SHA;
- when dependencies change and registry access permits, run `npm audit` and `npm audit --omit=dev`; if either audit cannot run because of registry, network, authentication, or environment restrictions, report it as **not completed** with the reason and never describe an unavailable audit as passed or clean;
- avoid deprecated, unmaintained, redundant, or overlapping packages, prefer existing platform capabilities and repository dependencies, minimise dependency surface area, and remove dependencies made obsolete by the change;
- follow existing repository patterns unless there is a documented reason to improve them, prefer reusable abstractions where they remove real duplication, and avoid premature abstraction or unnecessary frameworks;
- preserve explicit contracts, deterministic behaviour, least privilege, secure defaults, clear failure modes, and documented removal conditions for temporary compatibility code;
- for changes involving authentication, authorisation, private GitHub repositories, tokens, secrets, write APIs, repository mutation, deployment configuration, or Cloudflare environment variables, inspect and address, as applicable: least-privilege permissions; server-side authorisation rather than UI-only restrictions; input and repository-target validation; secret storage and redaction; prevention of secrets or tokens appearing in logs, errors, client bundles, or generated artifacts; safe failure behaviour; idempotency and stale-state handling for write operations; runtime and deployment configuration consistency; and tests covering denied, invalid, and failure paths as well as successful paths;
- update tests and documentation alongside behavioural or contract changes and never weaken linting, type checking, tests, build validation, workflow-security validation, deployment compatibility checks, or security controls merely to make a change pass;
- identify and remove obsolete in-scope code, configuration, comments, feature flags, or compatibility paths, keep changes focused, record out-of-scope debt separately, and ensure generated files are produced by declared repository commands;
- not commit incidental validation side effects; inspect the final diff and ensure every tracked change is intentional and in scope, consistent with the package-lock repair architecture that resets validation side effects and restores only the npm-regenerated lockfile;
- read `specs/000-current-application-spec.md` before implementation;
- update `specs/000-current-application-spec.md` in the same pull request whenever implemented behaviour changes;
- for normal functional implementation PRs, run `npm ci`, `npm run toolchain:validate`, `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run build:worker`, and `git diff --check` unless a command is genuinely inapplicable;
- when the corresponding area changes, run `npm run issue:validate`, `npm run issue:validate-request -- requests/features/<filename>.json`, `npm run issue:render -- requests/features/<filename>.json`, and `npm run artifacts:validate`; do not run irrelevant conditional commands merely for appearances, and explain why any conditional check was not applicable;
- distinguish validation outcomes accurately as passed, failed, not run because inapplicable, or not run or incomplete because of an environment restriction; never report a failed or unavailable command as passed;
- open a pull request whose title or summary includes the Feature ID;
- when implementation is associated with a GitHub issue, include the exact issue-specific closing reference `Closes #<issue-number>` in the body of the PR description;
- after opening the pull request, retrieve or inspect the created PR and verify that its body contains the required exact closing reference such as `Closes #25` when an implementation issue exists. If it is missing, update the PR body before finishing the task;
- verify that the PR targets the intended base branch, contains only intended in-scope files, and reports validation for the final PR head;
- describe intentional deviations, failed checks, unavailable checks, unresolved items, and inapplicable checks accurately in the pull request, and do not claim checks passed solely because the PR was opened.
