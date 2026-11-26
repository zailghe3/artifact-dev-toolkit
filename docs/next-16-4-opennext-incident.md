# Next 16.4 / OpenNext incident record

**Status:** Historical recovery record; not current dependency policy.

This record preserves the evidence and recovery reasoning from the October 2026 Next.js/OpenNext production incident. Current dependency/toolchain policy remains in [Dependency and toolchain maintenance](dependency-toolchain-maintenance.md).

## Incident and recovery evidence

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
