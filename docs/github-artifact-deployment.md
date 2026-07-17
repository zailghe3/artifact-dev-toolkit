# GitHub artifact deployment

Production must configure `ARTIFACT_REPOSITORY=github`, `GITHUB_ARTIFACT_REPOSITORY_OWNER=zailghe3`, and `GITHUB_ARTIFACT_REPOSITORY_NAME=fpo-artifacts`. Branch and root default to `main` and `artifacts`; set `GITHUB_ARTIFACT_REPOSITORY_BRANCH` and `GITHUB_ARTIFACT_REPOSITORY_ROOT` when those values differ. `file` is intended for explicit local development and tests. Missing or unsupported production backend configuration fails closed.

Reads use short-lived GitHub App installation tokens minted lazily for the authorized immutable repository ID. No static repository token is supported, and no installation token is stored in D1. Authorization is rechecked after seven minutes and the D1 decision is updated before access proceeds.

Worker logs use stable events including `artifact_repository_selected`, `repository_authorization_refreshed`, `github_artifact_tree_loaded`, and `github_artifacts_loaded`. A zero-item library means the configured root was read successfully but contained no compatible Markdown. Repository configuration, availability, and content-validation failures instead return safe error states (API status 500 or 503) without credentials or private content. DATA-003 caching is intentionally deferred.
