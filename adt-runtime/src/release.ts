import {readFileSync} from "node:fs";

export const MAX_RUNTIME_RELEASE_INTEGER=1_000_000;
export interface RuntimeRelease{protocolVersion:number;releaseRevision:number}

export function validateRuntimeRelease(value:unknown):RuntimeRelease{
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("invalid_runtime_release");
 const release=value as Record<string,unknown>,keys=["protocolVersion","releaseRevision"];
 if(Object.keys(release).length!==keys.length||Object.keys(release).some(key=>!keys.includes(key)))throw new Error("invalid_runtime_release");
 if(!Number.isInteger(release.protocolVersion)||Number(release.protocolVersion)<1||Number(release.protocolVersion)>MAX_RUNTIME_RELEASE_INTEGER)throw new Error("invalid_runtime_release");
 if(!Number.isInteger(release.releaseRevision)||Number(release.releaseRevision)<1||Number(release.releaseRevision)>MAX_RUNTIME_RELEASE_INTEGER)throw new Error("invalid_runtime_release");
 return release as unknown as RuntimeRelease;
}

function loadRuntimeRelease(){try{return validateRuntimeRelease(JSON.parse(readFileSync(new URL("../release.json",import.meta.url),"utf8")))}catch{throw new Error("invalid_runtime_release")}}
export const RUNTIME_RELEASE=loadRuntimeRelease();
