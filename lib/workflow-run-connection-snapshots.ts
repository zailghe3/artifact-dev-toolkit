import {safeConnectionSnapshot,type ConnectionDescriptor} from "./workflow-connections.ts";
import type {WorkflowProviderConnectionStore} from "./workflow-provider-connection-store.ts";

type CredentialResolver=Pick<WorkflowProviderConnectionStore,"resolveCredential">;

/** Resolve the public connection metadata that is safe to persist with a Workflow run. */
export async function resolveWorkflowRunConnectionSnapshot(connection:ConnectionDescriptor,providerStore:CredentialResolver):Promise<ConnectionDescriptor>{
 if(!connection.enabled)throw new Error("connection_unavailable");
 if(connection.adapter==="codex-runner"||connection.adapter==="deterministic-test")return safeConnectionSnapshot(connection);
 if(connection.adapter!=="openai-responses")throw new Error("connection_unavailable");
 const resolved=await providerStore.resolveCredential(connection.key,connection);
 if(!resolved.enabled||resolved.key!==connection.key||resolved.adapter!==connection.adapter)throw new Error("connection_unavailable");
 return safeConnectionSnapshot(resolved);
}
