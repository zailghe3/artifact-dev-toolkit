# Set up Advisor

Advisor opens Conversations filtered to the `advisor` Workflow in the configured artifact repository. It uses the same execution, approval, and history experience as other conversations.

## Configure the Workflow

- Configure a compatible tool-capable provider Connection. The Agent selects the Connection, and the Connection supplies the model.
- Generate starter definitions in a checkout of the configured artifact repository using the setup command.

  ```sh
  npm run advisor:definitions -- /path/to/artifact-definitions tool-capable-connection-id
  ```

- The generator creates definitions only when the corresponding paths are absent. Review and commit the generated files through the normal Git-backed definition process.
- An existing `advisor` Workflow remains usable. Add a **Knowledge Proposal** block to the selected analysis output to offer it for knowledge review.
- If an earlier setup selected a different Workflow, its definition remains available in Conversations. Put the intended Advisor definition at the `advisor` identity to use the Advisor shortcut.
- Read-only execution applies to the designated Advisor Workflow from every entry point. The Workflow can use explicitly granted native ADT reads through the usual ADT security controls.

## Review and publish knowledge

- A **Knowledge Proposal** block offers **Review & save to knowledge** after successful execution. Other Workflows can use the same block.
- The action opens an editable proposal with the recorded source Run and revision. Review the claims, add the subject Workflow or Agent IDs where relevant, and remove sensitive content before saving.
- Review the saved proposal and confirm the exact document and Git target to publish. Changing the draft requires a fresh review.
- Publication rechecks current repository authority and Git revision. Detected secret material is rejected. If the outcome is uncertain, inspect Git before preparing another mutation.
- Existing proposals and published entries remain available under **Advisor → Knowledge**. Published content follows the [knowledge repository contract](external-artifact-repository-contract.md#advisor-knowledge).

## Commission and recover

- Configure the GitHub App Contents authority required for authenticated human knowledge publication. Use the repository validator to check the knowledge directory.
- Grant sensitive observability tools only where needed. They require exact-call human approval before a model receives the selected evidence.
- After a Runtime restore, reopen a conversation and run a representative Advisor question. Published knowledge remains recoverable from Git.
