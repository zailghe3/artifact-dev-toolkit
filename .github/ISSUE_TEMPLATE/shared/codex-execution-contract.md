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
- read `specs/000-current-application-spec.md` before implementation;
- update `specs/000-current-application-spec.md` in the same pull request whenever implemented behaviour changes;
- run relevant tests, type checking, and production build validation;
- open a pull request whose title or summary includes the Feature ID;
- include a closing reference such as `Closes #<issue-number>`;
- describe any intentional deviation or unresolved item in the pull request.
