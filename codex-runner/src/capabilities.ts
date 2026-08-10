export const PROTOCOL_VERSION=1;
export function capabilities(runnerVersion:string){return{protocolVersion:PROTOCOL_VERSION,runnerVersion,codexAvailable:true,deviceAuth:true,jobExecution:false};}
