import {createGitHubAppJwt,getConfiguredRepository,getRepositoryInstallation,mintInstallationTokenForRepositoryName,type GitHubAppIdentityConfig} from "./github-app.ts";

export type ManagedRepositoryDescriptor={environmentKey:string;managed:true;owner:string;repository:string;baseBranch:string};
export type ManagedCodeRepositoryContext=ManagedRepositoryDescriptor&{repositoryId:number;installationId:number};
export class ManagedCodeRepositoryAuthorizationError extends Error{readonly name="ManagedCodeRepositoryAuthorizationError";readonly reason:"app_access"|"identity_mismatch"|"temporary_unavailable";readonly code:string;constructor(reason:"app_access"|"identity_mismatch"|"temporary_unavailable"){super(`Managed code repository authorization failed: ${reason}`);this.reason=reason;this.code=`managed_code_repository_${reason}`}}

const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
export async function resolveManagedCodeRepositoryContext(descriptor:ManagedRepositoryDescriptor,app:GitHubAppIdentityConfig,fetchImpl:typeof fetch=fetch):Promise<ManagedCodeRepositoryContext>{
 try{
  const appJwt=await createGitHubAppJwt(app.appId,app.privateKey),installation=await getRepositoryInstallation({owner:descriptor.owner,repo:descriptor.repository},appJwt,fetchImpl);
  const token=await mintInstallationTokenForRepositoryName(installation.id,descriptor.repository,appJwt,"read",fetchImpl);
  if(token.permissions.contents!=="read"&&token.permissions.contents!=="write")throw new ManagedCodeRepositoryAuthorizationError("app_access");
  const repository=await getConfiguredRepository({owner:descriptor.owner,repo:descriptor.repository},token.token,fetchImpl);
  if(!Number.isSafeInteger(repository.id)||repository.id<1||!same(repository.owner.login,descriptor.owner)||!same(repository.name,descriptor.repository))throw new ManagedCodeRepositoryAuthorizationError("identity_mismatch");
  return{...descriptor,owner:repository.owner.login,repository:repository.name,repositoryId:repository.id,installationId:installation.id};
 }catch(error){if(error instanceof ManagedCodeRepositoryAuthorizationError)throw error;const status=(error as {status?:number}).status;throw new ManagedCodeRepositoryAuthorizationError(status===401||status===403||status===404?"app_access":"temporary_unavailable")}
}
