# Agent tools, approval and recovery

ADT owns tool authority. Models may propose calls, but only ADT can admit and execute them. Tool calls are internal Agent events rather than authored Workflow blocks.

## Responsibilities

- Git owns Agent grants, Workflow restrictions, non-secret Tool definitions, frozen catalogues, and declarative policy text.
- PostgreSQL owns durable conversations, proposals, approvals, admissions, results, uncertainty, reconciliation evidence, and trusted policy attestations.
- Runtime owns model/tool progression, credential resolution, policy/security evaluation, and exact admitted execution.
- Model requests receive tool schemas but never MCP credentials or independent tool-execution authority.
- The explicit Workflow Approval block remains separate from per-tool approval.

## Authoring and maximum authority

- Tools are enabled explicitly on an Agent; tool-free Agents remain tool-free.
- Agent grants define maximum authority.
- A Workflow Agent block may inherit or narrow those grants, require approval, or lower execution budgets; it cannot expand authority.
- Tool discovery never changes an existing Agent's grants automatically.
- Runtime freezes the selected non-secret tool contract for a run. Normal Agent execution does not rediscover a broader catalogue.
- Exact grant identifiers, authoring schema, and numeric limits remain authoritative in source and the editor.

## Trusted policy and delegated roles

Tool-policy administration, human approval, and uncertainty reconciliation are separate operator-delegated roles. Current repository access is required in addition to the relevant role.

- `ADT_TOOL_POLICY_ADMINS` authorises trusted policy changes.
- `ADT_TOOL_APPROVERS` authorises approval/rejection of eligible exact calls.
- `ADT_TOOL_OPERATORS` authorises reconciliation of uncertain admitted work.
- One role never implies another, and per-tool reviewer restrictions may only narrow eligible approvers.
- Ordinary Git authorship or repository write access is not proof of policy-administrator authority.

Trusted policy is bound to the exact repository/tool/target/authentication identity by protected Runtime state. Direct or stale Git edits cannot create trusted execution authority by themselves.

- Trusted read-only work may execute automatically after mandatory checks.
- Unknown, mutating, or sensitive work requires approval unless trusted policy explicitly permits a narrower automatic case.
- Denial always wins over approval/automatic execution.
- Agent/Workflow restrictions, frozen policy, current mandatory policy, credential identity, and Security Profile checks can only narrow execution.
- Replacing relevant credentials or trust-boundary configuration invalidates authority that depended on the prior identity.
- Missing, stale, conflicting, or unverified policy state fails closed until an authorised administrator repairs/reviews it.

Exact policy JSON, digest construction, attestation representation, mutation sequencing, and conditional-rule schema remain authoritative in source/tests.

## Model and tool lifecycle

1. Runtime claims a bounded model turn and presents only the Agent's effective tool schemas.
2. The model returns text and zero or more proposals.
3. ADT durably records the proposals before any external tool call.
4. ADT validates the exact proposal against grants, schema, resource restrictions, credentials, trusted policy, and Security Profile.
5. If human approval is required, the exact invocation waits durably without holding an execution lease.
6. Approval/rejection is recorded against that immutable invocation; approval revalidates current mandatory authority before execution.
7. Runtime admits at most the exact authorised call and resolves only its scoped tool credential.
8. The external result, denial, known failure, or uncertainty is persisted before the Agent can continue.
9. A later model turn receives correlated tool results only after the relevant earlier calls have reached authoritative outcomes.

Rejection produces a correlated denial rather than executing the call. Calls within one Agent are ordered; separate Workflow branches may progress independently.

## Security Profiles

- A configured Security Profile evaluates an exact call after ADT grant/policy checks.
- Security Profiles never grant a tool or relax ADT policy.
- Required enforcement must be available and affirmative; missing, ambiguous, or negative evidence prevents execution.
- Human approval never overrides Security Profile denial.
- Security credentials remain Runtime-vault material and never enter model-visible tool definitions.

## Durable recovery

- Model turns and tool calls are durably bounded.
- A model request with an uncertain provider outcome is not automatically replayed.
- An admitted external tool call is never reassigned merely because time passed.
- Recorded successful/known outcomes are reused after Runtime replacement.
- Missing results, transport uncertainty, or inability to persist a returned outcome become explicit recovery states rather than fabricated success/failure.
- Cancellation prevents new admissions but does not claim that already-dispatched external work stopped.
- Exact deadlines, byte/token budgets, retry counters, transport cancellation, and persistence state transitions remain implementation details in source/tests.

## Operator reconciliation

Use the run inspector's **Agent tool activity** panel for an invocation whose external outcome is unknown. Only a delegated tool operator may reconcile it.

1. Inspect the recorded invocation/admission identity, target, arguments, and audit history.
2. Investigate the target system's independent audit/idempotency evidence.
3. Record one of the supported conclusions: verified success with a result, confirmed non-execution, still unresolved, or terminate without asserting an external outcome.
4. Record the evidence/basis used for that conclusion.

Never infer non-execution from a timeout or missing response. Before confirming non-execution, ensure the prior executor can no longer dispatch the old admission and independently verify that the action did not occur.

A matching late result may still become authoritative until a competing authoritative reconciliation decision wins. Stale evidence cannot settle a replacement admission.

## Provider and schema compatibility

- Tool-capable provider paths use the common ADT grant, approval, Security Profile, journaling, and recovery contract.
- Provider/model availability and tool capability are separate observations; successful model discovery alone does not prove that a model will accept tools/settings.
- Provider-specific API restrictions, model-specific option rules, endpoint allowlists, JSON Schema subset, and exact size limits are validated by the current implementation and may evolve independently.
- Hosted provider tools, provider-managed handoffs, arbitrary reasoning persistence, and other provider features are unsupported unless ADT explicitly models them.

The provider registry, model-policy code, schemas, and tests are authoritative for the current capability matrix.

## Commissioning tools

Before enabling a tool/provider combination in production:

- commission Runtime and the provider connection separately;
- discover the intended Tool definition through the application and grant only the required tool;
- verify the intended trusted policy and delegated approver/operator roles;
- use a harmless operator-controlled tool with independent audit evidence to prove one exact proposal produces one exact external call and correlated result;
- verify approval blocks external execution until the exact decision is recorded;
- verify rejection produces no external effect;
- verify the configured Security Profile allows and denies known cases as intended;
- exercise uncertainty/reconciliation using an independently auditable non-production target;
- record the provider/model/tool/security identities tested without recording credentials or private reasoning.

Fixture/unit coverage does not certify a live provider, model, MCP server, or Security Profile deployment. A commissioning result applies only to the configuration that was actually tested.
