const HISTORICAL_SECRET_BINDING=/^WORKFLOW_PROVIDER_CONNECTION_[A-Z0-9][A-Z0-9_]{0,79}$/;

export interface WorkflowProviderSecretResolver{resolve(secretRef:string):string}
export function createWorkflowProviderSecretResolver(readBinding:(allowedRef:string)=>unknown):WorkflowProviderSecretResolver{return{resolve(secretRef){if(!HISTORICAL_SECRET_BINDING.test(secretRef))throw new Error("connection_unavailable");const value=readBinding(secretRef);if(typeof value!=="string"||!value)throw new Error("connection_unavailable");return value}}}
