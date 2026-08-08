export type ConnectionDescriptor = { key: string; name: string; adapter: string; endpoint?: string; defaultModel?: string; enabled: boolean; capabilities: { asynchronous: boolean; cancellation: boolean } };
export type ResolvedConnection = ConnectionDescriptor & { credential?: string; serverConfiguration?: unknown; privateOptions?: unknown };

const deterministic: ConnectionDescriptor = { key: "deterministic-test", name: "Deterministic test connection", adapter: "deterministic-test", enabled: true, capabilities: { asynchronous: true, cancellation: true } };
const OPENAI_ENDPOINT="https://api.openai.com/v1";

export function listConnectionDescriptors(environment: Record<string, string | undefined> = process.env): ConnectionDescriptor[] {
  const enabled = environment.NODE_ENV === "test" || environment.NODE_ENV === "development" || environment.WORKFLOW_ENABLE_DETERMINISTIC_TEST_CONNECTION === "true";
  const credential=environment.WORKFLOW_OPENAI_API_KEY?.trim(),model=environment.WORKFLOW_OPENAI_MODEL?.trim();
  return [{ ...deterministic, enabled },{key:"openai-primary",name:"OpenAI Responses",adapter:"openai-responses",endpoint:OPENAI_ENDPOINT,...(model?{defaultModel:model}:{}),enabled:Boolean(credential&&model),capabilities:{asynchronous:true,cancellation:true}}];
}
export function resolveConnection(key: string, environment: Record<string, string | undefined> = process.env): ResolvedConnection {
  const descriptor = listConnectionDescriptors(environment).find((item) => item.key === key);
  if (!descriptor?.enabled) throw new Error("connection_unavailable");
  return descriptor.adapter==="openai-responses"?{...descriptor,credential:environment.WORKFLOW_OPENAI_API_KEY}:descriptor;
}
export function safeConnectionSnapshot(connection: ResolvedConnection): ConnectionDescriptor {
  const { key, name, adapter, endpoint, defaultModel, enabled, capabilities } = connection;
  return { key, name, adapter, ...(endpoint ? { endpoint } : {}), ...(defaultModel ? { defaultModel } : {}), enabled, capabilities };
}
