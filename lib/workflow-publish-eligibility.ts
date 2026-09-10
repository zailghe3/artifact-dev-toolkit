export function isAgentPublishEligible(agent:{connectionKey:string;adapterOptions?:unknown},connections:{key:string;adapter:string}[],environments:{key:string;enabled:boolean;ready:boolean;managedRepository?:boolean}[]){
 const options=agent.adapterOptions as {managedGit?:boolean;environmentKey?:string}|undefined;
 return connections.find(connection=>connection.key===agent.connectionKey)?.adapter==="codex-runner"&&options?.managedGit===true&&environments.some(environment=>environment.key===options.environmentKey&&environment.enabled&&environment.ready&&environment.managedRepository===true);
}
