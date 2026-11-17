export type ArtifactOperationCategory = "artifact_create" | "variation_create" | "artifact_edit" | "artifact_delete" | "validation";
export type ArtifactOperationStage = "write_credential" | "preflight_tree" | "preflight_blob" | "content_validation" | "mutation_put" | "mutation_response" | "cache_invalidation" | "diagnostic_validation";
export class ArtifactOperation {
  readonly id: string;
  signal?: AbortSignal;
  mutation: "not_attempted" | "uncertain" | "committed" = "not_attempted";
  readonly category: ArtifactOperationCategory;
  private readonly logger: Pick<Console, "info" | "error">;
  constructor(category: ArtifactOperationCategory, logger: Pick<Console, "info" | "error">, id = crypto.randomUUID()) { this.id = id; this.category = category; this.logger = logger; }
  log(stage: ArtifactOperationStage, outcome: "success" | "failure" | "started", started: number, status?: number, retries = 0, errorCategory?: string) {
    this.logger[outcome === "failure" ? "error" : "info"](JSON.stringify({ event: "artifact_repository_operation", operationId: this.id, operation: this.category, stage, outcome, elapsedMs: Date.now() - started, ...(status === undefined ? {} : { status }), retries, mutation: this.mutation, ...(errorCategory ? { category: errorCategory } : {}) }));
  }
  async run<T>(stage: ArtifactOperationStage, action: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try { const result = await action(); this.log(stage, "success", started); return result; }
    catch (error) {
      const status = (error as { status?: unknown } | null)?.status;
      const categories: Record<string, string> = { GitHubRequestTimeoutError: "timeout", ArtifactSecretRejectedError: "secret_rejected", ArtifactWriteValidationError: "invalid_input", ArtifactWriteTooLargeError: "too_large", ArtifactRepositoryContentError: "invalid_content", ArtifactDuplicateError: "duplicate", ArtifactWritePermissionError: "permission", ArtifactWriteAuthenticationError: "authentication" };
      const category = error instanceof Error ? categories[error.constructor.name] : undefined;
      this.log(stage, "failure", started, typeof status === "number" ? status : undefined, 0, category ?? (status === 429 ? "rate_limited" : "operation_failed"));
      throw error;
    }
  }
}
