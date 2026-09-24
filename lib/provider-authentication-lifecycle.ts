import type {ProviderConnectionTypePolicy} from "./provider-connection-types.ts";

export function assertCompatibleConnectionTypeChange(current:ProviderConnectionTypePolicy,target:ProviderConnectionTypePolicy){if(current.provider!==target.provider||current.authentication!==target.authentication)throw new Error("connection_type_change_incompatible")}

export function connectionAuthenticationPayload(policy:Pick<ProviderConnectionTypePolicy,"authentication">,credential:string){if(policy.authentication==="api-key")return{credential};return{}}

export async function createConnectionForAuthentication<T>(policy:ProviderConnectionTypePolicy,credential:string|undefined,createApiKey:(credential:string)=>Promise<T>){if(policy.authentication!=="api-key")throw new Error("authentication_lifecycle_unsupported");if(!credential)throw new Error("credential_required");return createApiKey(credential)}

export async function resolveAuthenticationForExecution<T>(policy:ProviderConnectionTypePolicy,resolveApiKey:()=>Promise<T>){if(policy.authentication!=="api-key")throw new Error("authentication_lifecycle_unsupported");return resolveApiKey()}

export async function resolveAuthenticationForReadiness<T>(policy:ProviderConnectionTypePolicy,resolveApiKey:()=>Promise<T>){return resolveAuthenticationForExecution(policy,resolveApiKey)}
