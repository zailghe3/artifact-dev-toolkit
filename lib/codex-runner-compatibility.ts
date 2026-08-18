import {EXPECTED_RUNNER_RELEASE,type ExpectedRunnerRelease} from "./codex-runner-release";

export type ProtocolStatus="compatible"|"incompatible"|"unknown";
export type RunnerRevisionStatus="current"|"update_available"|"runner_newer_than_adt"|"unknown";
export type CodexVersionStatus="current"|"mismatch"|"unknown";
export interface RunnerVersionFacts{protocolVersion?:number;runnerRevision?:number;codexVersion?:string;runnerVersion?:string}
export interface RunnerCompatibility{protocol:ProtocolStatus;runnerRevision:RunnerRevisionStatus;codexVersion:CodexVersionStatus}

export function evaluateRunnerCompatibility(installed:RunnerVersionFacts|undefined,expected:ExpectedRunnerRelease=EXPECTED_RUNNER_RELEASE):RunnerCompatibility{
 if(!installed)return{protocol:"unknown",runnerRevision:"unknown",codexVersion:"unknown"};
 const protocol=Number.isInteger(installed.protocolVersion)?installed.protocolVersion===expected.protocolVersion?"compatible":"incompatible":"unknown";
 const runnerRevision=!Number.isInteger(installed.runnerRevision)?"unknown":installed.runnerRevision===expected.runnerRevision?"current":installed.runnerRevision!<expected.runnerRevision?"update_available":"runner_newer_than_adt";
 const codexVersion=typeof installed.codexVersion!=="string"?"unknown":installed.codexVersion===expected.codexVersion?"current":"mismatch";
 return{protocol,runnerRevision,codexVersion};
}

export const shortBuildRevision=(revision:string)=>revision==="development"?revision:revision.slice(0,10);
