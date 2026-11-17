import { z } from "zod";
import { withGitHubDeadline } from "./github-request.ts";

export class GitContentWriteError extends Error {
  readonly responseInvalid: boolean;
  readonly status?: number;
  readonly code: "authentication" | "permission" | "conflict" | "uncertain";
  readonly stage: "mutation_put" | "mutation_response";
  constructor(code: GitContentWriteError["code"], responseInvalid = false, status?: number, stage: GitContentWriteError["stage"] = "mutation_put") {
    super(`git_content_${code}`);
    this.code = code; this.responseInvalid = responseInvalid; this.status = status; this.stage = stage;
  }
}
/** Shared single-attempt Contents mutation. Never retries a possibly successful write. */
export async function writeGitHubContents(input: { url: string; token: string; path: string; markdown: string; message: string; branch: string; sha?: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
  const state: { stage: GitContentWriteError["stage"] } = { stage: "mutation_put" };
  let status: number | undefined;
  try {
    return await withGitHubDeadline(async signal => {
      const response = await (input.fetchImpl ?? fetch)(input.url, {
        method: "PUT",
        // Workers rejects redirect:"error" before sending a request. Manual
        // preserves fail-closed redirects without forwarding credentials.
        redirect: "manual", signal,
        headers: { accept: "application/vnd.github+json", authorization: `Bearer ${input.token}`, "content-type": "application/json", "user-agent": "artifact-dev-toolkit", "x-github-api-version": "2022-11-28" },
        body: JSON.stringify({ message: input.message, content: Buffer.from(input.markdown).toString("base64"), branch: input.branch, ...(input.sha ? { sha: input.sha } : {}) }),
      });
      status = response.status;
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new GitContentWriteError(status === 401 ? "authentication" : status === 403 ? "permission" : [404, 409, 422].includes(status) ? "conflict" : "uncertain", false, status);
      }
      state.stage = "mutation_response";
      const value = z.object({ content: z.object({ path: z.string(), sha: z.string().min(1) }), commit: z.object({ sha: z.string().min(1), html_url: z.string().url() }) }).parse(await response.json());
      if (value.content.path !== input.path) throw new Error("invalid_write_path");
      return { path: input.path, fileSha: value.content.sha, commitSha: value.commit.sha, commitUrl: value.commit.html_url, repositoryRevision: value.commit.sha };
    }, input.timeoutMs);
  } catch (error) {
    if (error instanceof GitContentWriteError) throw error;
    throw new GitContentWriteError("uncertain", state.stage === "mutation_response", status, state.stage);
  }
}
