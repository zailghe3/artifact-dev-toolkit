# Using Conversations

## Start and continue

- Open **Conversations**, choose an Agent or a Workflow, and send a message. A Workflow's saved input template can prefill the first message.
- Reopen a conversation from History. Search by title or earlier user messages. Use the title's rename button to change how it appears in History.
- Each message starts a new Run with the current authorised definition of the same target. The timeline marks definition changes and links to each frozen Run under **Workflows**.
- Wait for the active turn before sending another message. Use the controls in the timeline to approve, cancel, or retry eligible work. Retrying the latest failed turn keeps its original Run and input.
- If submission cannot be confirmed, use **Retry submission** to check the same message identity. ADT recovers an accepted Run or admits the still-pending message once.
- **Workflows → Runs** provides technical history, including standalone Runs opened through existing links.

## Manage earlier context

- Follow-ups carry successful user and assistant exchanges into the next Run. Recent exchanges get priority and older exchanges may be summarised.
- To keep an earlier prompt, code block, or response verbatim, select **Include exact exchange in next message** on the earlier turn. If it exceeds the context budget, choose fewer exchanges or paste the relevant excerpt into the current message.
- The timeline identifies summarised or omitted history. Run details show the original request and the exact assembled Workflow input.
- Failed and cancelled turns stay visible in the timeline. Their outputs are excluded from follow-up context.
- ADT history supplies text at Workflow entry. Provider-side conversation continuation still requires explicit Workflow configuration.

## Review a response

- Switch between rendered and raw Markdown. Use **Copy** on the response or code block you need.
- A successfully executed **Knowledge Proposal** block can offer **Review & save to knowledge** on a response section. The editable draft records the source Run and revision.
- Review the draft, correct the evidence and metadata, and save it. Publication requires a separate review of the exact document and explicit confirmation. [Advisor and knowledge](advisor-setup.md)
