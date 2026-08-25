import {SECRET_BINDING} from "./workflow-connection-definitions.ts";

export interface WorkflowProviderSecretResolver{resolve(secretRef:string):string}
export function createWorkflowProviderSecretResolver(readBinding:(allowedRef:string)=>unknown):WorkflowProviderSecretResolver{return{resolve(secretRef){if(!SECRET_BINDING.test(secretRef))throw new Error("connection_unavailable");const value=readBinding(secretRef);if(typeof value!=="string"||!value)throw new Error("connection_unavailable");return value}}}
