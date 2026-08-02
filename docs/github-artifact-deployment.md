# GitHub artifact deployment

Production uses the GitHub backend and the dedicated private repository. Configure these exact settings:

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

The branch and artifact root remain optional and default to `main` and `artifacts`. The GitHub App callback URL is exactly `https://fpo-adt.florian-pouchet.workers.dev/auth/github/callback`. Give the App **Contents: read and write** and **Metadata: read-only** permissions, then install it with selected-repository access to `zailghe3/fpo-artifacts`. Changing an existing App from read-only Contents access may put the installation into a pending state until an organisation or repository administrator approves the new permission; do not deploy write features until that approval is complete.

Wrangler declares all six sensitive/identity settings as required Worker secrets. Set each through the Cloudflare dashboard or, while authenticated to the correct account, with `npx wrangler secret put NAME`. Generate independent values for token encryption and session signing:

```bash
openssl rand -base64 32 # GITHUB_TOKEN_ENCRYPTION_KEY
openssl rand -base64 48 # SESSION_SECRET
```

GitHub-downloaded PKCS#1 (`BEGIN RSA PRIVATE KEY`) keys and PKCS#8 (`BEGIN PRIVATE KEY`) keys are both supported. Encrypted keys, public keys, and certificates are not. Never commit `.env`, `.dev.vars`, PEM keys, secret values, OAuth tokens, or session data.

Reads use short-lived, repository-restricted GitHub App installation tokens. No static repository token is supported, and installation tokens are not stored in D1. Authorization is rechecked after seven minutes. The deployment runs Wrangler's required-secret validation and then a smoke test which checks only that OAuth initiation returns a GitHub authorization redirect with state and S256 PKCE; it does not log in to GitHub.

Direct artifact creates and updates use the same repository-restricted installation token and GitHub Contents API. A `403` from a write is surfaced as the safe `write_permission_required` API category; operators should verify both the App permission and installation approval. The application never changes App permissions, creates branches, or deploys automatically as part of a write.
