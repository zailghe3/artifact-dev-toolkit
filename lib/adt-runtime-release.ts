import releaseJson from "../adt-runtime/release.json" with {type:"json"};

export const MAX_ADT_RUNTIME_RELEASE_INTEGER=1_000_000;
export interface ExpectedADTRuntimeRelease{protocolVersion:number;releaseRevision:number}

export function validateExpectedADTRuntimeRelease(value:unknown):ExpectedADTRuntimeRelease{
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("invalid_runtime_release");
 const release=value as Record<string,unknown>,keys=["protocolVersion","releaseRevision"];
 if(Object.keys(release).length!==keys.length||Object.keys(release).some(key=>!keys.includes(key))||!Number.isInteger(release.protocolVersion)||Number(release.protocolVersion)<1||Number(release.protocolVersion)>MAX_ADT_RUNTIME_RELEASE_INTEGER||!Number.isInteger(release.releaseRevision)||Number(release.releaseRevision)<1||Number(release.releaseRevision)>MAX_ADT_RUNTIME_RELEASE_INTEGER)throw new Error("invalid_runtime_release");
 return release as unknown as ExpectedADTRuntimeRelease;
}
export const EXPECTED_ADT_RUNTIME_RELEASE=validateExpectedADTRuntimeRelease(releaseJson);

export function adtRuntimeReleaseFreshness(installed:{runtimeRevision?:unknown;runtimeReleaseRevision?:unknown}|undefined,expected:ExpectedADTRuntimeRelease=EXPECTED_ADT_RUNTIME_RELEASE){
 const deployedRevision=typeof installed?.runtimeRevision==="string"&&/^[0-9a-f]{40}$/i.test(installed.runtimeRevision)?installed.runtimeRevision.toLowerCase():undefined;
 const deployedReleaseRevision=Number.isInteger(installed?.runtimeReleaseRevision)&&Number(installed?.runtimeReleaseRevision)>=1&&Number(installed?.runtimeReleaseRevision)<=MAX_ADT_RUNTIME_RELEASE_INTEGER?Number(installed?.runtimeReleaseRevision):undefined;
 const expectedReleaseRevision=expected.releaseRevision;
 const state=deployedReleaseRevision===undefined?"unknown":deployedReleaseRevision===expectedReleaseRevision?"current":deployedReleaseRevision<expectedReleaseRevision?"superseded":"unknown";
 return{state,...(deployedRevision?{deployedRevision}:{}),...(deployedReleaseRevision===undefined?{}:{deployedReleaseRevision}),expectedReleaseRevision,...(state==="unknown"?{unknownReason:deployedReleaseRevision===undefined?"release_revision_unavailable" as const:"release_revision_newer" as const}: {})} as const;
}
