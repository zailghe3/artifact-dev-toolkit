declare module "cloudflare:workers" {
  export abstract class WorkflowEntrypoint<Env = unknown, Params = unknown> {
    protected env: Env;
    protected ctx: unknown;
    abstract run(event: { payload: Params; instanceId: string }, step: unknown): Promise<unknown>;
  }
}
