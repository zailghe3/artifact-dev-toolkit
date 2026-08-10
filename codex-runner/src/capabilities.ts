export const PROTOCOL_VERSION=1;
export function capabilities(runnerVersion:string,codexAvailable:boolean){return{protocolVersion:PROTOCOL_VERSION,runnerVersion,codexAvailable,deviceAuth:codexAvailable,jobExecution:false};}
