# Asynchronous action feedback audit

**Rule:** Action-result feedback belongs in the same local action region as the control that initiated it.

This inventory covers every client component containing a request or user-triggered asynchronous operation on 2026-09-11. Pending controls disable duplicate invocation. “Navigation” means an intentional successful destination; refresh is never used to erase a newly reported failure.

Workflow Publish validation has three distinct boundaries:

- **Authoring validity:** durable/static connection and Agent configuration only; Workflow pages and semantic POST/PUT do not contact Codex Runner.
- **Operational readiness:** live Runner reachability, capabilities, authentication, executable connection state, and enabled/ready managed environment are checked at run admission.
- **Publication authority:** Repository Manager validates the actual trusted managed repository context when publication occurs.

| Surface and action | Control and pending feedback | Result feedback | Refresh/navigation risk | Audit result |
| --- | --- | --- | --- | --- |
| `WorkflowDefinitionEditor`: create/save semantics and layout; layout-only retry | Bottom save action region; pending label and `aria-busy` | Local alert/status beside both buttons, including partial success and retry guidance | Existing-definition saves no longer refresh; create navigates only after full success | Changed |
| `WorkflowLayoutEditor`: save layout | Section-header button; pending label and `aria-busy` | Header-local live region | No refresh | Changed |
| `WorkflowAgentEditor`: save Agent | Bottom save region; pending label and `aria-busy` | Bottom-local alert | Success navigates to Agent detail | Changed |
| `ProviderConnectionEditor`: discover models | Model-discovery button; pending label and `aria-busy` | Discovery-local alert/status | No refresh | Changed |
| `ProviderConnectionEditor`: save connection | Bottom save region; pending label and `aria-busy` | Save-local alert; success navigates to catalogue | Navigation only after success | Changed |
| `ProviderConnectionEditor`: credential, provider test, ADT Runtime diagnostic | Buttons within their individual panels | Existing panel-local `OperationFeedback` regions | Successful credential refresh follows visible result | Compliant |
| `ArtifactEditor`: preview, save, delete | Shared action row uses operation-specific pending labels; delete confirmation owns destructive pending state | Preview/save feedback stays in the action region; delete failure remains in its open confirmation | No refresh; successful responses expose destination/commit links | Changed |
| `DefinitionCatalogue`: delete Agent/Workflow | Delete button in each card; pending label and `aria-busy` | Per-card alert keyed to the failed definition | Success refreshes only after deletion | Changed |
| `CodexRunnerOperationalStatus`: refresh | Page-header button; independent refresh pending state | Header-local completion; unavailable sections remain explicit | No router refresh | Changed |
| `CodexRunnerOperationalStatus`: emergency stop/resume | Execution-boundary buttons; independent control pending state | Control alert directly after the control section | No navigation/refresh | Changed |
| `CodexRunnerOperationalStatus`: SQLite backup/restore | Storage-panel buttons; shared storage pending lock | Storage-panel result/error message | No navigation/refresh | Compliant |
| `CodexRunnerConnection`: connect/logout | Connection-card action row; mutually exclusive pending state | Card-local connection alert or device ceremony | Poll refresh updates the same card and does not clear unrelated test results | Compliant |
| `CodexRunnerConnection`: Test Codex | Connection-card button; independent pending state | Independent test status | No navigation | Compliant |
| `CodexRunnerConnection`: auth diagnostics | Connection-card button; independent pending state | Independent diagnostics status and result | No longer overwrites connection feedback | Changed |
| `CodexRunnerAdvancedDiagnostics`: gather | Diagnostics-panel button; pending label and `aria-busy` | Adjacent panel alert/data | No navigation | Compliant |
| `ADTRuntimeDiagnosticButton`: test | Provider panel button; pending label and `aria-busy` | Parent-owned adjacent `OperationFeedback` | No navigation | Compliant |
| `ADTRuntimeExecutionPathDiagnostic`: test callback path | Diagnostic-card button; pending label and `aria-busy` | Card-local result or alert | No navigation | Changed |
| `WorkflowRunStart`: start | Form-local button; pending label and `aria-busy` | Form-local alert; success navigates to run | Navigation only after accepted run | Compliant |
| `WorkflowRunActions`: retry/cancel | Run-action row; operation label and shared pending lock | Same action container alert | Success refreshes run detail | Compliant |
| `WorkflowApprovalAction`: approve | Approval-local button; pending label and `aria-busy` | Same action container alert | Success refreshes run detail | Compliant |
| `WorkflowAgentPromptSelector`: search/copy prompt | Combobox/list or selected prompt card; loading state prevents competing work | Warning stays in prompt selector; selection is visible success | No navigation | Compliant |
| `VariationForm`: preview/save | Variation action row; save pending label and duplicate guard | Same action row error; preview and saved links immediately below | No navigation | Compliant |
| `CatalogueRefresh`: refresh/full rebuild | Shared catalogue action row; pending labels and lock | Error directly under controls; success refreshes catalogue | Refresh only after success | Compliant |
| `ArtifactDeleteButton` / `ArtifactSearch`: load deletion details and delete | Per-artifact control and confirmation; pending labels and locks | Confirmation-local failure; catalogue-level success after the card disappears | Success refresh reconciles tombstone | Compliant |
| `VaultCredentialControl`: configure/replace/remove | Credential-panel controls; operation label and lock | Parent-owned credential-panel feedback | Success refresh follows visible result | Compliant |

Non-mutating polling (`WorkflowRunPoller` and the Codex Runner ceremony/job pollers) has no initiating user control and was reviewed separately; it does not replace local mutation feedback.
