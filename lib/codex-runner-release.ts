import releaseJson from "@/codex-runner/release.json";

export const MAX_RUNNER_RELEASE_INTEGER=1_000_000;
export const STRICT_RUNNER_SEMVER=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export interface ExpectedRunnerRelease{protocolVersion:number;runnerRevision:number;codexVersion:string}

export function validateExpectedRunnerRelease(value:unknown):ExpectedRunnerRelease{
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("invalid_runner_release");
 const release=value as Record<string,unknown>,keys=["protocolVersion","runnerRevision","codexVersion"];
 if(Object.keys(release).length!==keys.length||Object.keys(release).some(key=>!keys.includes(key))||!Number.isInteger(release.protocolVersion)||Number(release.protocolVersion)<1||Number(release.protocolVersion)>MAX_RUNNER_RELEASE_INTEGER||!Number.isInteger(release.runnerRevision)||Number(release.runnerRevision)<1||Number(release.runnerRevision)>MAX_RUNNER_RELEASE_INTEGER||typeof release.codexVersion!=="string"||release.codexVersion.length>32||!STRICT_RUNNER_SEMVER.test(release.codexVersion))throw new Error("invalid_runner_release");
 return release as unknown as ExpectedRunnerRelease;
}
export const EXPECTED_RUNNER_RELEASE=validateExpectedRunnerRelease(releaseJson);
