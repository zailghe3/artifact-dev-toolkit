# Author interactive Workflows

An interaction pauses its block until an authorised user confirms a response in a Conversation or in Run details. One Run can ask several questions or revisit an interaction during a revision loop. Place each interaction before fan-out or after the Join.

| Block | Configuration and continuation |
| --- | --- |
| Human Decision v1 | Static options each have an ID, title, optional description, and optional value. Data selection uses the `out` port. Branch selection uses one connection per option ID. Dynamic choices always use `out`. Either source can accept human guidance. |
| Human Input v1 | Use a configured question or incoming text. An optional explanation and placeholder can clarify the request. Choose whether to require an answer, display incoming context, or pass it downstream alongside the answer. |
| Human Edit v1 | Set a review instruction. The user can edit, preview, reset, or confirm the incoming text. The next block receives the exact confirmed text. |
| Approval v2 | Connect `approve` and the enabled `revise` route. An enabled `reject` route can connect to a branch or end the Run with a rejected outcome. Revision requires feedback by default. Define a loop by connecting `revise` to an earlier block. |
| Display Output v1 | Optionally name the section. Incoming text appears in the Conversation as soon as the activation completes and continues downstream unchanged. This block can serve as the terminal output. |

Approval v1 retains its single `out` route and passes incoming text through on approval. The editor creates new approvals as v2. An Agent's `context.publishOutput` setting still controls reference context for later blocks.

## Dynamic decisions

Configure a preceding Agent to return one JSON object. The `options` array holds two to eight choices. Each choice has a unique lowercase slug ID, a title, a nonempty value, and an optional description. The object may include a `message` to show as the question. The contract enforces field bounds and a 64 KiB UTF-8 payload limit. Invalid output fails the block with a configuration diagnostic.

```json
{
  "message": "Which narrative should we use?",
  "options": [
    { "id": "evidence-first", "title": "Evidence first", "value": "Lead with the measured results." },
    { "id": "story-first", "title": "Story first", "description": "Start with one customer example.", "value": "Introduce the decision through an example." }
  ]
}
```

Example Agent instruction

> Compare two or three presentation narratives for the supplied audience. Return one JSON object with an optional message and an options array. Give each option a unique lowercase hyphenated id, a concise title, a concrete downstream value, and an optional description. Return JSON only. Keep the choices independent and leave the selection to the reviewer.

## Downstream text

- Human Decision outputs a JSON object with `selectedTitle`, `selectedValue`, and optional `humanGuidance`. Static choices without a supplied value use the title. Branch routing uses the chosen ID from the issued request.
- Human Input returns the answer verbatim. If passing context, it returns JSON with `humanResponse` and `incomingContext`. An optional empty answer still requires confirmation.
- Approval with no feedback passes the reviewed text through. Revision or a supplied feedback string yields JSON with `reviewedContent` and `humanFeedback`.
- Human Edit and Display Output preserve confirmed or incoming text, including whitespace and line breaks. Unsubmitted edits stay in the local form.

## Examples

- **Slide Narrative Builder.** Framer publishes audience and objectives for explicit reuse. Router proposes options as structured JSON. Human Decision passes the choice and guidance to Architect, and Display Output shows each draft. Challenger ends its assessment with `REVISE: YES` or `REVISE: NO`. A Condition loops back to Architect or delivers the latest narrative. [Workflow definition](../test-fixtures/interactive-workflows/slide-narrative.workflow.json)
- **Editorial Review.** Human Input clarifies the audience. The drafting Agent's result goes through Human Edit and Approval. A revision request sends the reviewed text and feedback back to the drafting Agent. Approval displays the final text. Rejection ends the Run. [Workflow definition](../test-fixtures/interactive-workflows/editorial-review.workflow.json)
