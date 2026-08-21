---
name: code-change-verification
description: Verify an ADT implementation after functional code, tests, build configuration, workflow logic, or other executable behavior changes. Use before reporting an implementation or correction PR complete; do not replace CI or weaken checks.
---

# Code change verification

Use this Skill after implementation and before the final pull-request report for executable changes.

## Procedure

1. Inspect the final changed-file set and diff. Confirm every tracked change is intentional and in scope.
2. Read `package.json`, applicable repository scripts, and relevant workflow/configuration files to determine the current canonical checks. Do not rely on remembered command versions.
3. Run the normal repository validation expected for functional implementation: tests, linting, type checking, production application build, and other canonical build checks unless genuinely inapplicable.
4. Run conditional validators for each governed area that changed, such as feature-request/template validation, artifact-repository validation, Runner revision validation, Runner tests, migration checks, or other repository-defined validators.
5. When dependencies change and registry access permits, follow the dependency audit requirements in `AGENTS.md`.
6. Verify that tests exercise the material acceptance criteria and failure paths rather than merely passing unrelated coverage.
7. Re-check security-sensitive boundaries touched by the change: denied paths, input validation, secret handling, least privilege, stale state, ambiguous mutations, replay, and safe errors where relevant.
8. If a specification update is required by changed product behaviour, ensure `$spec-sync` has been applied before declaring the work complete.
9. If a check fails, fix only confirmed in-scope causes. Do not weaken validation or tests to obtain green CI.
10. Re-run checks affected by the final fix so the reported results correspond to the final pull-request head.

## Reporting

Report each relevant check as one of:

- passed;
- failed, with the confirmed cause;
- inapplicable, with a concise reason;
- not completed because of an environment or external-service restriction, with the reason.

Do not claim a check passed because an earlier commit passed it. Do not treat green CI as proof of an acceptance criterion that no relevant test exercises.