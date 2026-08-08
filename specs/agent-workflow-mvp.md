# WF-001 durable sequential workflow architecture

WF-001 separates durable concerns deliberately. Git stores maintainer-authored draft Agent and Workflow definitions. A run copies safe immutable snapshots into D1, which stores the cursor, attempts, raw input and output, failures, cancellation and terminal result. Cloudflare Workflows receives only `{ runId }` and reloads canonical state at each durable boundary.

Each attempt uses `<runId>:<stepId>:<iteration>:<attempt>` as its idempotency key. An existing provider task is checked rather than started again. A successful output is written to D1 before the cursor advances; the next invocation consumes that exact stored string. Outputs are never returned from durable workflow steps or written to logs.

Connections expose a safe descriptor while credentials and private provider options remain server-only. The included deterministic adapter supports testing and local smoke runs and must not be represented as an AI service. Its production availability is explicitly opt-in.

WF-002 adds the first real provider behind that unchanged boundary. `openai-responses` uses the fixed OpenAI Responses endpoint, a server-only `encrypted D1 provider connection`, and the safely snapshotted deployment model from `D1 provider model configuration`. Every create maps the master prompt to `instructions` and raw persisted input to `input`, sends `background=true` and `store=false`, enables no tools, and persists the returned Response ID for durable GET polling and POST cancellation. Only ordered `output_text` and documented textual `refusal` message fragments become opaque workflow output; reasoning and raw provider objects are discarded. An ambiguous create network or 5xx outcome becomes non-automatically-retryable `provider_start_ambiguous`, because ADT cannot safely create a second billable task without a known Response ID.

The engine is intentionally bounded and sequential. It has no autonomous routing, conditions, loops, parallel work, mapping language or schema-aware handoff. Automatic retry is limited to transient categories, while manual retry preserves history and resumes at the failed step. Cancellation stops local progression; a cancellation racing a step claim converts a provider-free `starting` attempt to `cancelled`, and unsupported external cancellation is reported without claiming external work stopped.

Run launch is a D1 compare-and-set state machine (`unclaimed`, `launching`, `attached`, or `launch_failed`). A client idempotency key resolves to one run, and only the caller that reserves the deterministic `<runId>-g<generation>` Workflow instance ID may create it. A recent `launching` claim has a conservative two-minute lease; after that lease, one compare-and-set takeover may reuse the exact reservation and reconcile either creation or an already-existing instance. Ordinary run-detail observation, including the normal run-status page, can reconcile a stale nonterminal launch after the bounded lease. Attachment and safe launch failure are replay-safe, so an interrupted request cannot permanently strand a queued run.

Automatic transient retries remain inside the attached Workflow generation and use durable 10- and 30-second backoff. Manual retry is separately bounded, preserves all attempts, advances the Workflow generation, and uses the same launch reservation protocol. Provider polling guidance is clamped from one second to fifteen minutes and persisted for replay-stable sleep. Run duration, step duration, poll count, text size, transition count, automatic attempts, and total attempts are bounded.


### Provider credential storage

Provider credentials are never stored in Git. Configured provider credentials are encrypted with AES-256-GCM before persistence in D1. The provider-secret encryption root remains a Cloudflare Worker secret and is never stored in D1. Models are safe D1 connection configuration; provider endpoints remain fixed in application code.
