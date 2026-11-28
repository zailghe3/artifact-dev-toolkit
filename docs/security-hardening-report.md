# ADT security hardening

Reviewed against `dbc49c0` on `main`.

## Changes

- Replaced executable Markdown front matter with bounded, data-only YAML. Verified compatibility with existing artifacts and Advisor knowledge.
- Standardised same-origin checks for browser mutations, tightened authentication inputs and redirects, and added response headers and cache controls.
- Blocked credentials in MCP endpoint URLs and reduced sensitive data in service diagnostics.
- Disabled Worker preview URLs and limited deployment metadata to authenticated pages.
- Updated the pinned Squid and PostgreSQL images and added vulnerability reporting to scheduled dependency maintenance. [Ubuntu security notice](https://ubuntu.com/security/notices/USN-8941-1) [PostgreSQL release notes](https://www.postgresql.org/docs/17/release-17-12.html)

## Audit

- npm reported zero advisories across the three lockfiles, with and without development dependencies.
- Source and published image scans found residual high and critical advisories. Several matches concern unused code paths or build-only tooling. Track compatible upstream Codex and base image updates. Service access limited OSV lookups and Go source reachability analysis.
- Secret scanning covered tracked files, available history and compiled bundles. Reviewed flags traced to test fixtures, vault references and generated output.

## Validation

- Passed 1,384 application tests, 213 Runtime tests and 263 Runner tests.
- Passed lint, type checking, the OpenNext build, Wrangler dry run and compiled Worker smoke tests.
- Passed Workflow, Advisor and PostgreSQL integration checks, proxy isolation checks and compatibility checks for 18 artifacts.
- A fresh Runtime image build stopped when local Docker storage filled. Registry image scans were completed. Live Cloudflare log verification remains an operator check.

## Operator follow-up

- Apply the pinned images during maintenance. Verify proxy connectivity and isolation, and confirm database readiness. [Runner stack](../codex-runner/docker-stack.split.example.yml) [Runtime stack](../adt-runtime/docker-stack.example.yml)
- Verify signed broker traffic on the custom domain before disabling `workers.dev`. Check deployed log redaction and review retained authentication logs. [Cloudflare routing](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- If adopting Cloudflare Access, allow one approved identity and use a dedicated service token for Runtime traffic. Retain ADT OAuth and broker signing. Test desktop and mobile login and signed Runtime calls. Roll back by removing Access enforcement and reverting Runtime's Access token configuration. [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
