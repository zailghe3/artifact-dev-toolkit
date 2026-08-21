## Codex execution contract

This issue is intended to be a self-sufficient implementation contract. Repository-wide engineering and documentation conventions are defined by the applicable `AGENTS.md` files; mandatory task procedures may additionally be defined by repo-local Skills. Both also apply.

When Codex is launched with the full GitHub issue URL, Codex must:

- read the complete issue before changing code;
- verify that the issue belongs to `zailghe3/artifact-dev-toolkit`;
- treat the issue as the source of truth for objective, required behaviour, scope, out-of-scope boundaries, and acceptance criteria;
- stop without modifying code if the issue cannot be retrieved, belongs to another repository, is materially incomplete, or conflicts with the task context;
- never substitute another issue, prior task, inferred feature, or remembered requirement;
- remain within the stated scope and avoid unrelated improvements or upgrades;
- follow mandatory Skill routing declared by the applicable `AGENTS.md` files;
- read the relevant current specification before implementation;
- update the relevant specification in the same pull request when implemented behaviour changes;
- preserve the repository's documented compatibility and security constraints;
- run the repository checks relevant to the changed area, including the normal test, lint, typecheck, and production-build checks for functional implementation unless genuinely inapplicable;
- run conditional validators only when the corresponding feature-request, artifact, workflow, or other governed area changes;
- report validation accurately as passed, failed, inapplicable, or not completed because of an environment restriction;
- inspect the final diff and ensure every tracked change is intentional and in scope;
- open a pull request whose title or summary includes the Feature ID;
- include the exact issue-specific closing reference `Closes #<issue-number>` in the pull request body;
- verify after opening the pull request that it targets the intended base branch, contains only intended files, includes the required closing reference, and reports validation for the final PR head;
- describe intentional deviations, failed or unavailable checks, and unresolved items accurately rather than implying successful completion.