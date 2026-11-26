import { buttonStyles } from "./Ui";

export function WorkflowServiceUnavailable({ retryPath }: { retryPath: "/workflows" | "/workflows/runs" }) {
  return <section className="adt-panel mt-8" aria-labelledby="workflow-service-unavailable">
    <h2 id="workflow-service-unavailable" className="text-xl font-bold">Workflow service unavailable</h2>
    <p role="status" className="mt-2">Workflow history could not be loaded. Try again to refresh the history.</p>
    <form action={retryPath} method="get" className="mt-4">
      <button type="submit" className={buttonStyles.secondary}>Retry loading history</button>
    </form>
  </section>;
}
