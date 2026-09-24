import {safeConnectionSnapshot,type ConnectionDescriptor} from "./workflow-connections.ts";
import type {WorkflowProviderConnectionStore} from "./workflow-provider-connection-store.ts";
import {isExecutableGitProviderAdapter} from "./provider-connection-types.ts";

type CredentialResolver=Pick<WorkflowProviderConnectionStore,"resolveForExecution">|Pick<WorkflowProviderConnectionStore,"resolveCredential">;

/** Resolve the public connection metadata that is safe to persist with a Workflow run. */
export async function resolveWorkflowRunConnectionSnapshot(connection:ConnectionDescriptor,providerStore:CredentialResolver):Promise<ConnectionDescriptor>{
 if(!connection.enabled)throw new Error("connection_unavailable");
 if(connection.adapter==="codex-runner"||connection.adapter==="deterministic-test")return safeConnectionSnapshot(connection);
 if(!isExecutableGitProviderAdapter(connection.adapter))throw new Error("connection_unavailable");
 const resolve="resolveForExecution" in providerStore?providerStore.resolveForExecution.bind(providerStore):providerStore.resolveCredential.bind(providerStore);
 const resolved=await resolve(connection.key,connection);
 if(!resolved.enabled||resolved.key!==connection.key||resolved.adapter!==connection.adapter)throw new Error("connection_unavailable");
 return safeConnectionSnapshot(resolved);
}
