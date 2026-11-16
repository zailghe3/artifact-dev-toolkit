import { noStoreHeaders } from "./auth-core.ts";
import { ARTIFACT_VALIDATION_TIMEOUT_MS, withGitHubDeadline } from "./github-request.ts";
import type { RepositoryDiagnostics } from "./repository-diagnostics.ts";

// A separate observational request: no Runtime/Runner calls or catalogue mutation.
export async function artifactValidationRequest<T>(request: Request, authorize: (request: Request) => Promise<T | Response>, validate: (session: T, signal: AbortSignal) => Promise<RepositoryDiagnostics["validation"]>, timeoutMs = ARTIFACT_VALIDATION_TIMEOUT_MS) {
  const operationId = crypto.randomUUID(), started = Date.now();
  try {
    return await withGitHubDeadline(async signal => {
      const session = await authorize(request);
      if (session instanceof Response) return session;
      const validation = await validate(session, signal);
      console.info(JSON.stringify({event:"artifact_repository_operation",operationId,operation:"validation",stage:"diagnostic_validation",outcome:validation.state === "unavailable" ? "failure" : "success",elapsedMs:Date.now()-started,mutation:"not_attempted"}));
      return Response.json({validation}, {headers:noStoreHeaders});
    }, timeoutMs, request.signal);
  } catch {
    console.error(JSON.stringify({event:"artifact_repository_operation",operationId,operation:"validation",stage:"diagnostic_validation",outcome:"failure",category:"validation_unavailable",elapsedMs:Date.now()-started,mutation:"not_attempted"}));
    return Response.json({validation:{state:"unavailable",reason:"repository_unavailable"}}, {status:503, headers:noStoreHeaders});
  }
}
