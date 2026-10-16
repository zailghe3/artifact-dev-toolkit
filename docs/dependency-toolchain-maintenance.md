# Dependency and toolchain maintenance

This document defines the maintenance policy for repository dependencies and the supported toolchain.

## Sources of truth

- `.nvmrc` and `.node-version` define the supported Node.js major.
- `package.json#packageManager` defines the canonical npm version.
- `package.json#engines` and the root lockfile metadata must remain consistent with those declarations.
- GitHub Actions should consume the declared Node.js version rather than hard-code a separate runtime baseline.
- `npm run toolchain:validate` verifies the repository toolchain contract and GitHub Actions policy.

Do not duplicate exact toolchain versions across general documentation when the repository sources above are sufficient.

## Routine dependency updates

- Dependabot proposes routine compatible updates using the repository configuration.
- Minor and patch updates may be grouped by compatibility domain.
- Major dependency and GitHub Actions upgrades require intentional, focused review.
- Dependency pull requests remain subject to normal sensitive-file and auto-merge policy.
- Package-lock repair must use the repository's trusted repair process rather than PR-controlled write credentials.

The active Dependabot configuration and CI workflows are authoritative for grouping, schedules, sensitive paths, and automation mechanics.

## Compatibility holds

- Respect documented compatibility holds and technical decisions.
- Do not upgrade a held dependency merely because a newer version exists.
- `docs/dev-007-typescript-7-assessment.md` records the current TypeScript 7 decision and reassessment trigger.
- Reassess a hold when its documented trigger is satisfied or when the relevant ecosystem support materially changes.

## Adding or changing dependencies

For every direct dependency change:

- explain why the change is needed;
- verify compatibility with the supported runtime, framework, linting, type-checking, Cloudflare, and deployment stack;
- prefer existing platform capabilities and repository dependencies where practical;
- avoid deprecated, unmaintained, redundant, or overlapping packages;
- minimise dependency surface area;
- remove dependencies made obsolete by the change;
- generate `package-lock.json` through npm rather than editing lockfile internals.

Do not use forced major upgrades, blanket overrides, `npm audit fix --force`, or weakened validation merely to silence findings.

## Maintenance report

Run:

```bash
npm run maintenance:report
```

The report provides read-only maintenance signals such as outdated or deprecated direct dependencies and repository toolchain/action-policy issues. Scheduled automation may publish the same information to workflow summaries but must not modify the repository automatically.

## Exceptions and major upgrades

Document intentional exceptions with:

- the package or tool being held;
- the compatibility reason;
- evidence used for the decision;
- the next reassessment trigger.

Treat major upgrades as focused migration work. Update affected configuration, lockfiles, documentation, tests, and specifications where product behaviour changes.

## Validation

Before merging dependency or toolchain maintenance:

- use the repository-declared toolchain and canonical scripts;
- run `npm run toolchain:validate` and `npm run maintenance:report` when applicable to the maintenance change;
- run the canonical verification selected for every affected component rather than an unconditional repository-wide build sequence;
- let the CI impact policy remain authoritative for current root, application, ADT Runtime, Codex Runner, integration, and image-smoke requirements;
- run package audits when required by repository guidance and registry access permits.

If a maintenance report, audit, or relevant canonical check cannot be completed because of registry, network, authentication, or environment restrictions, report that outcome accurately rather than treating it as passed.

## Next 16.4 / OpenNext incident recovery

- Main lifecycle [#194](https://github.com/zailghe3/artifact-dev-toolkit/actions/runs/38639067216) verified commit `ba1a69ee2fdcf1a7a5b6dc39e340210bafbfc0c5`, applied migration 0022, built and deployed Worker version `85c36ef7-405c-4e3a-a515-d274d40deab7`, then failed every production OAuth initiation attempt with HTTP 500. Runtime release 5 publication was correctly blocked.
- [OpenNext issue #1355](https://github.com/opennextjs/opennextjs-cloudflare/issues/1355) identifies Next 16.4's `preview-props.json` manifest as a dynamic server initialization failure. The [official Cloudflare 1.20.12 release](https://github.com/opennextjs/opennextjs-cloudflare/releases/tag/%40opennextjs/cloudflare%401.20.12) includes [the manifest fix](https://github.com/opennextjs/opennextjs-cloudflare/pull/1356) and AWS adapter 4.1.11 with Next 16.4 support.
- The repair uses Next and eslint-config-next 16.4.1, OpenNext Cloudflare 1.20.12, and unchanged Wrangler 4.151.0. OpenNext's published peer constraint requires Next >=16.4.1; the [14 October Next security update](https://nextjs.org/blog/nextjs-security-update-october-14-2026) independently requires that patch. This supersedes a Next downgrade or compatibility hold.
- Root lock generation uses npm 11.4.2 on Node 24. Changes outside the adapter/framework closure must retain their previous versions. The updated Next closure includes its fixed Sharp dependency; no blanket override or Dependabot ignore is needed.
- `npm run test:worker-runtime` runs the actual custom OpenNext Worker entrypoint through local Wrangler after `build:worker`. PR application verification always runs it, including root dependency and Worker configuration changes. It validates the ADT configuration redirect and dynamic sign-in HTML, with isolated environment/configuration, bounded startup and requests, and process-group cleanup. Production OAuth smoke remains required.
- Observed local comparison, using fresh npm installs and unchanged Wrangler 4.151.0:

  | Next / eslint-config-next | OpenNext Cloudflare | OpenNext build | Local Worker smoke |
  | --- | --- | --- | --- |
  | 16.4.0 | 1.20.11 | Passed | HTTP 500, `preview-props.json` error |
  | 16.4.1 | 1.20.11 | Passed | HTTP 500, same manifest error |
  | 16.4.1 | 1.20.12 | Passed | ADT OAuth configuration redirect and dynamic sign-in HTML passed |

- The same-framework comparison isolates the official adapter fix from the security patch. Helper/deployment/publication regression tests and the root suite also passed locally; exact final-head checks and audit findings are recorded in the recovery PR. Local runtime evidence does not establish production recovery; the merged Worker must pass the retained production smoke.
