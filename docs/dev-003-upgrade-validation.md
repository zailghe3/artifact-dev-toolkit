# DEV-003 dependency upgrade validation notes

This note records the upgrade-review basis for DEV-003.

## Compatibility basis

- The selected Next.js version is `16.2.10`.
- The selected React and React DOM versions are `19.2.7`.
- The selected OpenNext adapter remains `@opennextjs/cloudflare` `1.20.1`.
- The OpenNext adapter's package peer dependency accepts Next.js `>=15.5.18 <16 || >=16.2.6` and Wrangler `^4.86.0`, so Next.js `16.2.10` and Wrangler `4.110.0` satisfy the adapter contract recorded in the lockfile.
- The selected `eslint-config-next` version is `16.2.10`. Its package peer dependency accepts ESLint `^7.23.0 || ^8.0.0 || ^9.0.0`, so the existing ESLint 9 major remains compatible.

## Next.js 16 migration review

The official Next.js 16 upgrade guide calls out codemod-supported migrations such as `next lint` replacement, deprecated `middleware` to `proxy`, stabilized API prefix changes, Turbopack configuration movement, and async request API enforcement.

Repository inspection found no required source codemod changes for this application:

- `package.json` already uses the ESLint CLI through `npm run lint` rather than `next lint`.
- The application has no `middleware` file.
- `next.config.ts` has no `experimental.turbopack`, custom `webpack`, `images.domains`, or other Next.js 16 migration-specific settings.
- Dynamic route page and route-handler `params` are already typed as promises and awaited.
- The app does not use `next/image`, `next/legacy/image`, `cookies()`, `headers()`, `draftMode()`, `searchParams` page props, `experimental_ppr`, or `unstable_` APIs that require migration here.

## Verification constraints

The package lockfile should be regenerated with npm `11.4.2` when registry access is available. In this execution environment, npm registry access through the configured proxy returned HTTP 403 or hung during dependency installation, so full local install/build/preview validation could not be completed here.
