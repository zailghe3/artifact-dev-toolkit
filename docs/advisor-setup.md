# Set up Advisor

- Advisor runs an ordinary, visible Workflow. Choose an enabled OpenAI Agents, Anthropic Messages or Ollama connection with a model that supports the selected API and effective tool grants.
- In a local checkout of the configured **artifact definition repository**, use an existing connection ID. Generate the default definitions from the application checkout:

  ```sh
  npm run advisor:definitions -- /path/to/artifact-definitions tool-capable-connection-id
  ```

- This creates `agents/advisor.agent.json` and `workflows/advisor.workflow.json`. It refuses existing files, does not publish Git changes, and does not configure credentials or activate Advisor.
- Review and commit the definitions through your ordinary Git-backed definition process. The provider connection ID must identify a compatible connection in that repository.
- Deploy [Runtime PostgreSQL](runtime-postgresql.md) for Advisor settings. Open **Advisor → Advisor settings**, select the Workflow, and save. Optional overrides select an existing configured connection and a model validated for that connection; the override uses each Agent’s saved settings and block restrictions. For GPT-6 Luna with tools, set each affected Agent’s reasoning effort to **none**. Model discovery checks availability. The provider can still reject the selected API, tools or settings during a run. See [provider and schema limits](agent-tools-and-recovery.md#provider-and-schema-limits).
- Open Advisor, ask about a named Workflow, and inspect the execution link for progress, approval, cancellation, tool decisions, recovery and the frozen provider/model choices.
- Edit the default Agent or Workflow using the ordinary editors. New questions use current definitions; recovery retains the original execution snapshot. Failed journaled activations cannot use generic step retry; inspect recorded outcomes and explicitly start a new question when appropriate.

## Evidence and authority

- Native ADT data tools can be assigned explicitly to any eligible ordinary Agent. Advisor itself grants no tool authority.
- Separate grants cover Workflow lists, Workflow structure, execution lists, execution details with persisted sanitised diagnostics, and aggregate execution metrics.
- All reads are bound to the run's repository, installation, branch and catalogue root. Runs lacking that scope are excluded.
- Workflow reads exclude prompts, starter inputs, condition text, approval text and publication content. Execution reads exclude inputs, outputs, raw error messages and provider/tool responses.
- Lists and attempt histories are paginated. Metrics cover at most the newest 1,000 matching runs and report truncation. Recorded status, completed duration, retry counts and partial provider-reported journal token totals are available. Zero usage may mean the provider did not report usage; cost is not recorded.
- Advisor permits only explicitly granted native read tools, compatible provider inference and supported deterministic control/approval blocks. MCP, Artifact Search, Codex, Git publication and conversation continuation are rejected, including through reusable Workflows.
- The existing frozen Agent/Workflow execution budgets, tool journal, approval policy and Security Profile gate still apply. The default budget permits four tool executions. A broad question may need a more focused follow-up question in a fresh run.
- Independently enable `adt_agent_prompt_read`, `adt_execution_content_read`, `adt_execution_errors_read` or `adt_tool_execution_read` in the ordinary Agent editor when needed. No existing definition receives these sensitive grants automatically.
- Each sensitive invocation requires an account delegated through `ADT_TOOL_APPROVERS` to approve its exact recorded arguments in the execution inspector, with an explicit acknowledgement of possible sensitive disclosure to the configured model. The server rejects sensitive approvals without this acknowledgement. Missing approver configuration fails closed. Approval never bypasses current repository authority, cancellation, the Security Profile gate or frozen budgets.
- Prompt reads label current Git versus frozen historical instructions; historical prompt-artifact revisions were not separately recorded and are reported as unavailable. Selected content is bounded and may be omitted by size/secret-safety checks. Recognised authentication headers, credential-bearing connection strings and service access keys are rejected by the shared Artifact/knowledge secret check. Unmatched text remains unverified; detection is not proof of universal safety and does not permit automatic disclosure. External tool payloads are omitted because their disclosure safety cannot be established; payload inspection exposes only validated native target/selection arguments and selected native result metadata.
- The newly generated default includes `adt_advisor_knowledge_search`; existing definitions remain unchanged. Add it explicitly to existing Agents. It supports text/type/status/tag/Workflow/Agent filters or direct stable-ID retrieval.
- Scheduling, notifications and persistent conversation memory are outside this scope.

## Review and publish knowledge

- Open **Advisor → Browse knowledge and review proposals**. Search approved Git entries or create knowledge manually; Advisor need not be configured to use this interface.
- Choose **Save to knowledge** on a finished analysis to create a private operational proposal. Long results become a marked excerpt with stable execution references, not a copy of the whole execution history. The Advisor run ID and its Workflow revision are investigation provenance only. The neutral draft title and empty Workflow/Agent subjects must be reviewed; explicitly enter investigated subject IDs without relying on parsed model output.
- Edit title, type, lifecycle, tags, subject/related/superseding references, evidence revisions and Markdown. Suggested model content is untrusted; check every claim and remove secrets or unnecessary execution content.
- **Save draft** persists the proposal in Runtime PostgreSQL. **Review publication** saves the current edit and displays the exact document, canonical Git target and observed revision. Check the approval box and choose **Approve and publish to Git** for each mutation. Detected credentials prohibit publication even after approval; remove them, save the edited draft and review again.
- Review consent expires after five minutes, is bound to your current application session/account and draft revision, and is invalidated by edits. Both review and publication revalidate OAuth repository authority. No auto-publish option or model-callable publisher exists.
- Select an approved entry and **Prepare update** to correct it or change lifecycle/relationships. Git optimistic concurrency rejects stale updates and duplicate creates. Refresh the Git entry and prepare a new review after a conflict.
- Publishing/uncertain proposals are locked against replay. Inspect the current Git entry by stable ID (and Git history) before preparing another proposal. An interrupted response is never proof that publication failed.
- See the [knowledge contract](external-artifact-repository-contract.md#advisor-knowledge) for metadata and lifecycle semantics.

## Initial limits and rollout

- The GitHub App needs existing repository Contents write permission for human publication; native readers mint only read authority. Runtime receives short-lived read credentials through the Worker broker. Human publication stays in the Worker.
- Search scans at most 200 flat entries and 2 MiB per immutable Git revision with four concurrent blob reads. Exceeding a bound reports unavailable rather than incomplete results. Direct-ID reads still work for larger libraries; use **Open entry by ID**. The proposals panel shows your latest 50 proposals. Invalid entries are counted and excluded; validate the configured artifact checkout with `npm run artifacts:validate -- <checkout>`.
- Execution reads page at most 20 records and enforce existing journal result/call/token budgets. Tool payload inspection requires an exact invocation ID and restricts arbitrary text. Narrow questions and explicit Workflow execution limits are preferable to loading whole histories.

After recovering Advisor settings, validate them with a tool-using Workflow. Published knowledge remains in Git. See [PostgreSQL recovery](runtime-postgresql.md#recover-from-a-deployment-issue).
