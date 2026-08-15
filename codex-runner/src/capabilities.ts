export const PROTOCOL_VERSION=1;
export function capabilities(runnerVersion:string,codexAvailable:boolean,deviceAuthCompatible:boolean){return{protocolVersion:PROTOCOL_VERSION,runnerVersion,codexAvailable,deviceAuth:codexAvailable&&deviceAuthCompatible,jobExecution:true};}
