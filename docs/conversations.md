# Using Conversations

## Start and continue

- Open **Conversations**, choose an Agent or a Workflow, and send a message. A Workflow's saved input template can prefill the first message.
- Reopen a conversation from History. Search by title or earlier user messages. Use the title's rename button to change how it appears in History.
- Each message starts a new Run with the current authorised definition of the same target. The timeline marks definition changes and links to each frozen Run under **Workflows**.
- The composer becomes available when the active turn ends. Use the Run controls to cancel or retry eligible work. Retrying the latest failed turn keeps its original Run and input.
- If submission cannot be confirmed, use **Retry submission** to check the same message identity. ADT recovers an accepted Run or admits the still-pending message once.
- **Workflows → Runs** provides technical history, including standalone Runs opened through existing links.

## Manage earlier context

- Follow-ups can include final answers, displayed results, and accepted human decisions from successful or rejected Runs. Recent exchanges get priority. A rolling summary carries older material across turns and Runtime restarts.
- To keep an earlier exchange verbatim, including its response sections, select **Include exact exchange in next message** on that turn. If the full exchange exceeds the context budget, choose fewer exchanges or paste the needed excerpt into the current message.
- The timeline flags summaries, shortened excerpts, and exchanges that could not fit. Run details show the original request and exact assembled Workflow input.
- Failed and cancelled turns stay visible in the timeline. Their outputs are excluded from follow-up context.
- ADT history supplies text at Workflow entry. Provider-side conversation continuation still requires explicit Workflow configuration.

## Review a response

- Switch between rendered and raw Markdown. **Copy complete response** includes all sections in order. Individual sections and code blocks also have their own copy controls.
- When a Workflow asks for a choice, answer, edit or approval, submit from the request in the turn. ADT resumes the same Run after recording the response. Reopen a recorded request to see its exact content and response.
- Use **Workflow activity** to see the blocks that ran, the selected routes and any waits or retries. A pending sensitive tool approval has its own controls.
- **Display Output** sections appear during execution. For long sections, use **View full output** or copy the complete section.
- A **Knowledge Proposal** activation can offer **Review & save to knowledge** after the Run succeeds. Use **View output** to open its section. Repeated visits to the same block can offer separate actions, each tied to its source output. The editable draft records the source Run and revision.
- Review the draft, correct the evidence and metadata, and save it. Publication requires a separate review of the exact document and explicit confirmation. [Advisor and knowledge](advisor-setup.md)
