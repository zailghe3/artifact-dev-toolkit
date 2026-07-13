# Dependency and toolchain maintenance

DEV-006 makes routine dependency and toolchain maintenance reviewable and deterministic without adding repository-modifying reporting bots.

## Supported runtime baseline

The supported runtime baseline is Node.js 24 and npm 11.4.2.

Canonical sources must agree:

- `.nvmrc` and `.node-version` declare the Node.js major version.
- `package.json#engines.node` declares the supported Node.js engine range.
- `package.json#packageManager` and `package.json#engines.npm` declare the exact npm version.
- `package-lock.json` root metadata must agree with package metadata when npm records those fields.
- GitHub Actions workflows must use `node-version-file: .nvmrc` rather than hard-coded Node.js versions.

Run `npm run toolchain:validate` before opening maintenance PRs. The command fails on unsupported runtime versions, disagreement between canonical toolchain sources, lockfile/package-manager inconsistency, unpinned third-party actions, stale action release comments, and documentation drift.

## Dependabot grouping

Dependabot is configured for weekly pull requests and groups minor and patch updates by compatibility domain:

- Next.js, React, React DOM, `eslint-config-next`, and OpenNext Cloudflare.
- ESLint, TypeScript, `typescript-eslint`, `@typescript-eslint/*`, and `@types/*` packages.
- Tailwind CSS, `@tailwindcss/*`, and PostCSS.
- Cloudflare tooling such as Wrangler.
- Runtime support packages such as Zod, gray-matter, remark, and remark-html.
- GitHub Actions updates are grouped separately from npm dependencies.

Major npm dependency upgrades are ignored by Dependabot so maintainers can initiate them intentionally in dedicated migration PRs. Major GitHub Actions updates likewise remain separately reviewable because action references are sensitive CI/CD changes and must retain full-SHA pins with release comments.

## Sensitive-file and auto-merge protections

Dependency PRs do not bypass trusted auto-merge or sensitive-file classification. Changes to `.github/workflows/**`, `.github/actions/**`, `scripts/**`, `package.json`, `package-lock.json`, `wrangler.jsonc`, and `open-next.config.*` remain sensitive and require manual review. Dependabot branches may use the package-lock repair workflow only when they are same-repository branches writable by the repository token and inside the existing permitted repair scope.

## Deterministic maintenance report

Run the read-only maintenance report locally with:

```bash
npm run maintenance:report
```

The report covers:

- direct dependencies reported outdated by `npm outdated`;
- direct packages reported deprecated by `npm view <package> deprecated`;
- unsupported runtime-version or canonical toolchain disagreement;
- lockfile/package-manager inconsistency;
- unpinned third-party GitHub Actions references;
- stale GitHub Actions release comments.

The scheduled `Dependency maintenance report` workflow runs the same command weekly and on manual dispatch. It has `contents: read` permissions only, writes only to the GitHub Actions job summary, and never creates commits, pull requests, or issues.

## Exceptions and major upgrades

Record intentional exceptions in the maintenance PR description or in a dedicated documentation update when they affect future maintainers. Include:

1. the package or tool intentionally held back;
2. the compatibility reason;
3. the command output or upstream reference used to verify the decision;
4. the next review trigger.

Initiate major upgrades as normal focused PRs. A major upgrade PR should update package metadata, lockfile, affected workflow/tooling configuration, documentation, and the current application specification when implemented behaviour changes.

## Verifying the repository is current

Before merging dependency or toolchain maintenance, run:

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

If `npm run maintenance:report` lists outdated or deprecated direct dependencies but the PR intentionally does not update them, document the exception instead of suppressing the report.
