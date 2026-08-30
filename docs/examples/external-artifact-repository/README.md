# External artifact repository example

This directory is a minimal current-layout example for Artifact Library Markdown.

- Artifact Library content lives in the canonical root-level type directories.
- Variations remain in their normal type directory and use `sourceId`.
- Markdown Agents and a dedicated `variations/` directory are unsupported.
- Executable Agent, Workflow, layout, and connection JSON use the separate root-level namespaces defined by the [external repository contract](../../external-artifact-repository-contract.md).
- Repository validation uses the same DATA-001 validator as production artifact repositories.
