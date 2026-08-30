# GitHub artifact deployment

This document covers production configuration and operator recovery for the GitHub-backed Artifact Library. Implementation mechanics remain authoritative in code and tests.

## Required configuration

Production uses the GitHub backend and a dedicated private artifact repository.

```text
ARTIFACT_REPOSITORY=github
GITHUB_APP_ID
GITHUB_APP_CLIENT_ID
GITHUB_APP_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY
GITHUB_TOKEN_ENCRYPTION_KEY
GITHUB_ARTIFACT_REPOSITORY_OWNER=zailghe3
GITHUB_ARTIFACT_REPOSITORY_NAME=fpo-artifacts
SESSION_SECRET
```

The branch is optional and defaults to `main`. Artifact Library discovery is fixed to the canonical root-level `prompts/`, `snippets/`, `templates/`, and `app-ideas/` namespaces; no artifact-root variable is required or used.

Never commit `.env`, `.dev.vars`, PEM keys, secret values, OAuth tokens, or session data.

## GitHub App

- Production callback URL: `https://adt.pouchet.net/auth/github/callback`.
- Required permissions: **Contents: read and write** and **Metadata: read-only**.
- Install the App with selected-repository access to `zailghe3/fpo-artifacts`.
- Permission upgrades may require administrator approval before the installation becomes usable.
- The application never changes GitHub App permissions automatically.

GitHub-downloaded PKCS#1 and PKCS#8 private keys are supported. Encrypted keys, public keys, and certificates are not.

## Cloudflare secrets

Configure required Worker secrets through the Cloudflare dashboard or Wrangler.

Generate independent secrets for token encryption and session signing, for example:

```bash
openssl rand -base64 32 # GITHUB_TOKEN_ENCRYPTION_KEY
openssl rand -base64 48 # SESSION_SECRET
```

Production validation checks required secret configuration before deployment.

## Catalogue cache

Production requires a Workers KV namespace bound as `ARTIFACT_CATALOGUE_CACHE`.

- Provision the namespace manually before deployment.
- Commit the real production namespace ID to the matching `kv_namespaces` entry in `wrangler.jsonc`.
- Do not use a fabricated or omitted production ID.
- A separate preview namespace may be configured when remote preview testing is required.
- `ARTIFACT_CATALOGUE_FRESHNESS_SECONDS` may override catalogue freshness within the application-supported bounds.
- Local `ARTIFACT_REPOSITORY=file` development does not require KV.

The application keeps revision-scoped validated catalogue snapshots and fails safely when repository truth cannot be established. Temporary cache failure may degrade freshness or performance without turning a healthy GitHub read into an application failure.

Implementation details for chunking, publication, concurrency, invalidation, and eventual-consistency handling belong in the cache implementation and tests rather than this operator guide.

## Repository access

- Reads use repository-restricted installation credentials with Contents read access.
- Direct artifact writes require Contents write access.
- Artifact Library mutations use Contents write access; Pull requests permission is not required.
- No static repository token is supported.
- Installation credentials remain server-side and are not persisted as long-lived repository tokens.

A write permission failure should be resolved by checking both the GitHub App permission and the installed repository approval.

## Deployment validation

Before production deployment:

- verify required Worker secrets;
- verify the production KV binding resolves to the intended namespace;
- verify GitHub App permissions and repository installation;
- run the repository's production binding and build validation;
- deploy only from the trusted production workflow or an approved operator recovery path.

The application does not provision production Cloudflare resources or GitHub permissions as part of normal runtime behaviour.

## Catalogue recovery

Use the application controls in this order:

1. Verify GitHub availability, repository access, and cache binding identity.
2. Use **Refresh** for a normal repository revision check.
3. Use **Full rebuild** when a complete catalogue reload is required.
4. Delete corrupt namespace values only as a last-resort operator action after the binding and repository have been verified.

A failed refresh should not discard an otherwise safe last-known-good catalogue.

## Protected diagnostics

After repository authorisation, `/diagnostics` and `/api/diagnostics` expose bounded private operational information.

Use diagnostics to inspect:

- stored and live repository authorisation;
- effective repository permissions;
- current base revision;
- catalogue/cache state;
- artifact validation failures;
- safe recovery guidance.

Diagnostics must not expose tokens, keys, artifact bodies, raw upstream responses, cache contents, or private publication data.

Diagnostics is observational unless the user explicitly invokes a supported recovery action. Temporary GitHub or cache outages should remain distinguishable from definitive authorisation, configuration, or content failures.
