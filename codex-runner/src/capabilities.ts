import {RUNNER_RELEASE} from "./release.js";
export const PROTOCOL_VERSION=RUNNER_RELEASE.protocolVersion;
export function capabilities(runnerVersion:string,codexAvailable:boolean,deviceAuthCompatible:boolean){return{protocolVersion:RUNNER_RELEASE.protocolVersion,runnerRevision:RUNNER_RELEASE.runnerRevision,runnerVersion,codexVersion:RUNNER_RELEASE.codexVersion,codexAvailable,deviceAuth:codexAvailable&&deviceAuthCompatible,jobExecution:true};}
