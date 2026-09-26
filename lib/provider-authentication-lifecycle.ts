import type {ProviderConnectionTypePolicy} from "./provider-connection-types.ts";

export function assertCompatibleConnectionTypeChange(current:ProviderConnectionTypePolicy,target:ProviderConnectionTypePolicy){if(current.provider!==target.provider||current.authentication!==target.authentication)throw new Error("connection_type_change_incompatible")}

export function connectionAuthenticationPayload(policy:Pick<ProviderConnectionTypePolicy,"authentication">,credential:string){if(policy.authentication==="api-key")return{credential};return{}}

function isRegisteredWorkIqDelegated(policy:ProviderConnectionTypePolicy){return policy.authentication==="delegated-oauth"&&policy.id==="work-iq-rest"&&policy.provider==="microsoft-work-iq"}
export async function createConnectionForAuthentication<T>(policy:ProviderConnectionTypePolicy,credential:string|undefined,createApiKey:(credential:string)=>Promise<T>,createDelegated?:()=>Promise<T>){if(policy.authentication==="api-key"){if(!credential)throw new Error("credential_required");return createApiKey(credential)}if(isRegisteredWorkIqDelegated(policy)&&createDelegated)return createDelegated();throw new Error("authentication_lifecycle_unsupported")}

export async function resolveAuthenticationForExecution<T>(policy:ProviderConnectionTypePolicy,resolveApiKey:()=>Promise<T>,resolveDelegated?:()=>Promise<T>){if(policy.authentication==="api-key")return resolveApiKey();if(isRegisteredWorkIqDelegated(policy)&&resolveDelegated)return resolveDelegated();throw new Error("authentication_lifecycle_unsupported")}

export async function resolveAuthenticationForReadiness<T>(policy:ProviderConnectionTypePolicy,resolveApiKey:()=>Promise<T>,resolveDelegated?:()=>Promise<T>){return resolveAuthenticationForExecution(policy,resolveApiKey,resolveDelegated)}
export async function resolveAuthenticationForSnapshot<T>(policy:ProviderConnectionTypePolicy,resolveApiKey:()=>Promise<T>,resolveDelegated?:()=>Promise<T>){return resolveAuthenticationForExecution(policy,resolveApiKey,resolveDelegated)}
