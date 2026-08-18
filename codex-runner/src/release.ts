import {readFileSync} from "node:fs";

export const MAX_RELEASE_INTEGER=1_000_000;
export const STRICT_SEMVER=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export interface RunnerRelease{protocolVersion:number;runnerRevision:number;codexVersion:string}

export function validateRunnerRelease(value:unknown):RunnerRelease{
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("invalid_runner_release");
 const release=value as Record<string,unknown>,keys=["protocolVersion","runnerRevision","codexVersion"];
 if(Object.keys(release).length!==keys.length||Object.keys(release).some(key=>!keys.includes(key)))throw new Error("invalid_runner_release");
 if(!Number.isInteger(release.protocolVersion)||Number(release.protocolVersion)<1||Number(release.protocolVersion)>MAX_RELEASE_INTEGER)throw new Error("invalid_runner_release");
 if(!Number.isInteger(release.runnerRevision)||Number(release.runnerRevision)<1||Number(release.runnerRevision)>MAX_RELEASE_INTEGER)throw new Error("invalid_runner_release");
 if(typeof release.codexVersion!=="string"||release.codexVersion.length>32||!STRICT_SEMVER.test(release.codexVersion))throw new Error("invalid_runner_release");
 return release as unknown as RunnerRelease;
}

function loadRunnerRelease(){try{return validateRunnerRelease(JSON.parse(readFileSync(new URL("../release.json",import.meta.url),"utf8")))}catch{throw new Error("invalid_runner_release")}}
export const RUNNER_RELEASE=loadRunnerRelease();
