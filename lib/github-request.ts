// Includes response-body consumption. A read may retry; a mutation must never
// retry on this deadline because GitHub may already have committed it.
export const GITHUB_REQUEST_TIMEOUT_MS = 10_000;
export const ARTIFACT_VALIDATION_TIMEOUT_MS = 45_000;
export class GitHubRequestTimeoutError extends Error {
  constructor() { super("github_request_timeout"); }
}

export async function withGitHubDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs = GITHUB_REQUEST_TIMEOUT_MS, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(parent?.reason);
  if (parent?.aborted) cancel();
  else parent?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new GitHubRequestTimeoutError()), timeoutMs);
  let onAbort: () => void = () => {};
  try {
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(controller.signal.reason);
      if (controller.signal.aborted) onAbort();
      else controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    return await Promise.race([aborted, Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return operation(controller.signal);
    })]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
