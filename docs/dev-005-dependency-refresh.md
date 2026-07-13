# DEV-005 dependency refresh record

**Date:** 2026-07-13  
**Feature:** DEV-005 — Refresh remaining direct dependencies and remove obsolete packages

## Scope

This record documents the direct production and development dependency inspection required by DEV-005. The repository-declared toolchain remains Node.js 24.x and npm 11.4.2; no Node, npm, framework-major, deployment-major, ESLint-major, or TypeScript-major migration was performed.

## Method

- Compared each direct `package.json` dependency and devDependency with the `package-lock.json` resolved direct package version.
- Searched repository source, configuration, tests, and documentation for direct package imports or configuration use.
- Updated declared lower bounds where the lockfile already resolved and validated a newer compatible direct package version.
- Avoided adding replacement packages.
- Attempted lockfile regeneration and dependency audit with npm 11.4.2; both were blocked by npm registry `403 Forbidden` responses in the execution environment and must be rerun in an environment with registry access.

## Direct dependency outcomes

| Package | Declared outcome | Reason |
| --- | --- | --- |
| `gray-matter` | Retained at `^4.0.3` | Used by the file and external artifact repositories for YAML frontmatter parsing. The declared range already matches the lockfile direct version. |
| `next` | Retained at `^16.2.10` | Application framework dependency used by routes, metadata, navigation, and configuration. Framework-major changes are out of scope. |
| `react` | Retained at `^19.2.7` | Required by client components and aligned with the current Next.js stack. |
| `react-dom` | Retained at `^19.2.7` | Required runtime peer for React rendering with Next.js even though it is not imported directly in application code. |
| `remark` | Retained at `^15.0.1` | Used by Markdown rendering. The declared range already matches the lockfile direct version. |
| `remark-html` | Retained at `^16.0.1` | Used by Markdown-to-HTML rendering. The declared range already matches the lockfile direct version. |
| `zod` | Retained at `^4.4.3` | Used for artifact schema and API input validation. The declared range already matches the lockfile direct version. |
| `@opennextjs/cloudflare` | Retained at `^1.20.1` | Used by OpenNext Cloudflare build and Next development integration. The declared range already matches the lockfile direct version. |
| `@tailwindcss/postcss` | Updated to `^4.3.2` | Used by PostCSS configuration. The lockfile already resolved `4.3.2`; the declaration now reflects the tested lower bound. |
| `@types/node` | Updated to `^24.13.3` | Node 24 type declarations are part of the validated TypeScript stack. The lockfile already resolved `24.13.3`; the declaration now reflects the tested lower bound. |
| `@types/react` | Retained at `^19.2.17` | React type declarations aligned with React 19.2.7. The declared range already matches the lockfile direct version. |
| `@types/react-dom` | Retained at `^19.2.3` | React DOM type declarations aligned with React DOM 19.2.7. The declared range already matches the lockfile direct version. |
| `eslint` | Retained at `^9.39.5` | Lint command and flat config dependency. The declared range already matches the lockfile direct version. |
| `eslint-config-next` | Retained at `^16.2.10` | Next.js ESLint flat config dependency. The declared range already matches the lockfile direct version. |
| `postcss` | Updated to `^8.5.18` | Required by the Tailwind PostCSS toolchain. The lockfile already resolved `8.5.18`; the declaration now reflects the tested lower bound. |
| `tailwindcss` | Updated to `^4.3.2` | Used by the global CSS import and Tailwind configuration typing. The lockfile already resolved `4.3.2`; the declaration now reflects the tested lower bound. |
| `typescript` | Retained at `^5.9.3` | Repository type-checking compiler. The declared range already matches the lockfile direct version. |
| `typescript-eslint` | Retained at `^8.63.0` | Required by `eslint-config-next` for TypeScript linting. The declared range already matches the lockfile direct version. |
| `wrangler` | Retained at `^4.110.0` | Cloudflare type generation, preview, deploy, and upload tool. The declared range already matches the lockfile direct version. |

## Removals and additions

No direct dependencies were removed. Each direct dependency is either imported by application/configuration code, required as a framework/runtime peer, or needed by a repository script. No replacement dependencies were added.

## Audit and lockfile status

`npm install --package-lock-only --ignore-scripts` was run with npm 11.4.2 but could not complete because the registry returned `403 Forbidden` while fetching `@tailwindcss/oxide-wasm32-wasi-4.3.2`. The attempted direct dependency bound updates match versions already resolved in the checked-in lockfile, so the lockfile remains consistent with the tested dependency graph.

`npm audit --json` was attempted with npm 11.4.2 but the audit endpoint returned `403 Forbidden`. No vulnerability findings were available to investigate in this environment. Maintainers should rerun `npm install --package-lock-only --ignore-scripts` and `npm audit` from a network environment with npm registry access before or during merge validation.

## Intentional compatibility holds

No dependency was held below the currently lockfile-resolved direct version. Future upgrades remain constrained by the Node.js 24.x/npm 11.4.2 toolchain and by the existing Next.js, OpenNext Cloudflare, Tailwind CSS, ESLint, and TypeScript compatibility matrix.
