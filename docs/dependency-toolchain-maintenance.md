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

Before merging dependency or toolchain maintenance, run the repository's relevant canonical checks, normally including:

```bash
npm ci
npm run toolchain:validate
npm run maintenance:report
npm test
npm run lint
npm run typecheck
npm run build
npm run build:worker
```

If a maintenance report or audit cannot be completed because of registry, network, authentication, or environment restrictions, report that outcome accurately rather than treating it as passed.
