import type {ConnectionDescriptor,ResolvedConnection} from "./workflow-connections.ts";
/** Current provider configuration is Git-owned and resolves credentials only through the ADT vault. */
export interface WorkflowProviderConnectionStore{listSafeDescriptors():Promise<ConnectionDescriptor[]>;getSafeDescriptor(key:string):Promise<ConnectionDescriptor|undefined>;resolveCredential(key:string,snapshot?:ConnectionDescriptor):Promise<ResolvedConnection>}
