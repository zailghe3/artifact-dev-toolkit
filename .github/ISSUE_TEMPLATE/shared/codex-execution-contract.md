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
- use the repository toolchain contract: Node.js 24 from `.nvmrc` and npm 11 from `package.json` `packageManager`;
- reuse existing environment variables, configuration values, constants, templates, helpers, components, and abstractions instead of duplicating or hard-coding equivalent values;
- avoid unexplained literals, duplicated configuration, hidden behaviour, and magic values;
- introduce a new environment variable or configuration value only when it represents genuine runtime or deployment configuration, and keep definitions, examples, validation, typing, documentation, and deployment configuration consistent;
- use the latest stable compatible package version when introducing a dependency and verify compatibility with the supported Node.js, npm, Next.js, React, Cloudflare, TypeScript, linting, and deployment stack;
- avoid deprecated, unmaintained, redundant, or overlapping packages, prefer existing platform capabilities and repository dependencies, justify every new dependency, minimise dependency surface area, and remove dependencies made obsolete by the change;
- follow existing repository patterns unless there is a documented reason to improve them, prefer reusable abstractions where they remove real duplication, and avoid premature abstraction or unnecessary frameworks;
- preserve explicit contracts, deterministic behaviour, least privilege, secure defaults, clear failure modes, and documented removal conditions for temporary compatibility code;
- update tests and documentation alongside behavioural or contract changes and never weaken linting, type checking, tests, validation, or security controls merely to make a change pass;
- identify and remove obsolete in-scope code, configuration, comments, feature flags, or compatibility paths, keep changes focused, record out-of-scope debt separately, and ensure generated files are produced by declared tools;
- read `specs/000-current-application-spec.md` before implementation;
- update `specs/000-current-application-spec.md` in the same pull request whenever implemented behaviour changes;
- run relevant tests, type checking, and production build validation;
- open a pull request whose title or summary includes the Feature ID;
- include a closing reference such as `Closes #<issue-number>` in the body of the PR description;
- After opening the pull request, retrieve or inspect the created PR and verify that its body contains an exact closing reference such as `Closes #25`. If it is missing, update the PR body before finishing the task;
- describe any intentional deviation or unresolved item in the pull request.
