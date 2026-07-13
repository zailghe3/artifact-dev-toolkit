# DEV-007 TypeScript 7 compatibility assessment

## Decision

TypeScript 7 migration is **deferred** for the current repository toolchain. The repository remains on TypeScript 5.9.3 because the installed `typescript-eslint` stack declares TypeScript support as `>=4.8.4 <6.1.0`, which excludes TypeScript 7 and is used by the mandatory ESLint validation path.

The deferral is not a source-code or compiler-settings workaround. Strict TypeScript, ESLint, test, Next.js build, OpenNext Cloudflare build, and workflow-security validation remain unchanged.

## Evidence reviewed on 2026-07-13

- GitHub issue #84 (`DEV-007`) requires TypeScript 7 to be treated as a coordinated compiler/toolchain migration and permits deferral when a critical dependency or integration does not support TypeScript 7.
- Official TypeScript release notes describe TypeScript 7 as a native-port major release with parallel compiler phases and JavaScript-analysis behaviour changes: <https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/>.
- Official TypeScript 6 release notes describe TypeScript 6 as the transition release from TypeScript 5.9 to TypeScript 7 and state that options deprecated in TypeScript 6 are removed in TypeScript 7: <https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/>.
- The official `typescript-eslint` dependency-version documentation says projects must use a supported TypeScript range for parser and typed-linting support: <https://typescript-eslint.io/users/dependency-versions>.
- `package-lock.json` records `typescript-eslint`, `@typescript-eslint/parser`, and `@typescript-eslint/typescript-estree` at 8.63.0 with TypeScript peer support `>=4.8.4 <6.1.0`; TypeScript 7 is outside that range.
- Next.js TypeScript documentation identifies built-in TypeScript support and a minimum TypeScript version rather than an explicit TypeScript 7 support guarantee for this repository's complete lint/build/deploy chain: <https://nextjs.org/docs/app/api-reference/config/typescript>.
- The installed `eslint-config-next` 16.2.10 peer range allows TypeScript `>=3.3.1`, but that does not override the narrower `typescript-eslint` compiler-API support range used by the same linting stack.
- The installed OpenNext Cloudflare and Wrangler packages do not declare direct TypeScript peer dependencies, but the Worker build remains downstream of the Next.js build, generated types, repository `tsc --noEmit`, and ESLint validation.

## Toolchain integrations assessed

| Area | Current integration | TypeScript 7 assessment |
| --- | --- | --- |
| TypeScript CLI | `npm run typecheck` runs `tsc --noEmit` with TypeScript 5.9.3. | Not migrated because a mandatory peer-dependent lint integration excludes TypeScript 7. |
| Next.js build | `npm run build` runs `next build`; Next.js also owns generated TypeScript environment files. | No blocking peer range found in installed `next` metadata, but not sufficient by itself to permit migration. |
| ESLint / typed linting | `npm run lint` runs `eslint .` through Next.js flat config and `typescript-eslint`. | Blocking: `typescript-eslint` 8.63.0 and its parser/compiler-API package exclude TypeScript 7. |
| React and Node type declarations | `@types/react`, `@types/react-dom`, and Node 24-aligned `@types/node` are used through TypeScript. | No migration made; declarations remain validated with TypeScript 5.9.3. |
| OpenNext Cloudflare | `npm run build:worker` runs `opennextjs-cloudflare build`. | No direct TypeScript peer range found; still gated by Next.js, generated types, ESLint, and `tsc`. |
| Wrangler / Cloudflare types | `wrangler types` generates `cloudflare-env.d.ts` when requested. | No direct TypeScript peer range found in installed Wrangler metadata; generated declarations remain validated by TypeScript 5.9.3. |
| Repository scripts and tests | Node scripts are JavaScript; tests run with `node --test`. | No TypeScript 7 migration required while compiler remains deferred. |
| Editor tooling | Editors consume the workspace TypeScript package and `tsconfig.json`. | Remains on TypeScript 5.9.3 so local editor diagnostics match CI. |
| Dependabot | `.github/dependabot.yml` ignores semver-major npm updates and groups only minor/patch TypeScript ecosystem updates. | Existing major-update ignore prevents TypeScript 7 from being treated as an automatically mergeable routine update. |

## Reassessment trigger

Reassess TypeScript 7 only when the maintained `typescript-eslint` release used by the repository, including `@typescript-eslint/parser` and compiler-API packages, documents and declares TypeScript 7 support. The reassessment must also re-check Next.js, `eslint-config-next`, OpenNext Cloudflare, Wrangler, generated TypeScript configuration, editor integration, and the full repository validation suite before changing the TypeScript dependency.
