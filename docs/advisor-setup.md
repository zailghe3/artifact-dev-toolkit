# Set up Advisor v1

- Advisor runs an ordinary, visible Workflow. It needs configured, enabled tool-capable connections: OpenAI Agents, Anthropic Messages or Ollama with a tool-compatible model.
- In a local checkout of the configured **artifact definition repository**, use an existing connection ID. Generate the default definitions from the application checkout:

  ```sh
  npm run advisor:definitions -- /path/to/artifact-definitions tool-capable-connection-id
  ```

- This creates `agents/advisor.agent.json` and `workflows/advisor.workflow.json`. It refuses existing files, does not publish Git changes, and does not configure credentials or activate Advisor.
- Review and commit the definitions through your ordinary Git-backed definition process. The provider connection ID must identify a compatible connection in that repository.
- Open **Advisor → Advisor settings**, select the Workflow, and save. Optional overrides select an existing configured connection and a model validated for that connection; every affected Agent must be compatible.
- Open Advisor, ask about a named Workflow, and inspect the execution link for progress, approval, cancellation, tool decisions, recovery and the frozen provider/model choices.
- Edit the default Agent or Workflow using the ordinary editors. New questions use current definitions; recovery retains the original execution snapshot. Failed journaled activations cannot use generic step retry; inspect recorded outcomes and explicitly start a new question when appropriate.

## Evidence and authority

- Native ADT data tools can be assigned explicitly to any eligible ordinary Agent. Advisor itself grants no tool authority.
- Separate grants cover Workflow lists, Workflow structure, execution lists, execution details with persisted sanitised diagnostics, and aggregate execution metrics.
- All reads are bound to the run's repository, installation, branch and catalogue root. Runs lacking that scope are excluded.
- Workflow reads exclude prompts, starter inputs, condition text, approval text and publication content. Execution reads exclude inputs, outputs, raw error messages and provider/tool responses.
- Lists and attempt histories are paginated. Metrics cover at most the newest 1,000 matching runs and report truncation. Recorded status, completed duration, retry counts and partial provider-reported journal token totals are available. Zero usage may mean the provider did not report usage; cost is not recorded.
- Advisor permits only these native metadata tools, compatible provider inference and supported deterministic control/approval blocks. MCP, Artifact Search, Codex, Git publication and conversation continuation are rejected, including through reusable Workflows.
- The existing frozen Agent/Workflow execution budgets, tool journal, approval policy and Security Profile gate still apply. The default budget permits four tool executions. A broad question may need a more focused follow-up question in a fresh run.
- Scheduling, notifications and persistent conversation memory are outside v1.

Deployment remains operator-owned. This change requires the committed D1 migration and compatible Worker/ADT Runtime releases; no deployment or production configuration is performed by setup.
