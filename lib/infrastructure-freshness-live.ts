import "server-only";
import {deploymentMetadata} from "./deployment-metadata.ts";
import {runnerReleaseFreshness} from "./codex-runner-compatibility.ts";
import type {RunnerCapabilities} from "./codex-runner-client.ts";
import {diagnoseADTRuntime,workflowRuntimeCommand} from "./workflow-services.ts";
import {adtRuntimeReleaseFreshness} from "./adt-runtime-release.ts";
import {collectInfrastructureFreshness} from "./infrastructure-freshness-service.ts";
import {infrastructureFreshnessServerTtl,INFRASTRUCTURE_FRESHNESS_SERVER_TIMEOUT_MS,type InfrastructureFreshnessSnapshot} from "./infrastructure-freshness.ts";
let cached:{expiresAt:number;snapshot:InfrastructureFreshnessSnapshot}|undefined,inFlight:Promise<InfrastructureFreshnessSnapshot>|undefined;
let cacheGeneration=0;
export const resolveRuntimeReleaseFreshness=(diagnostic:{runtimeRevision?:unknown;runtimeReleaseRevision?:unknown})=>adtRuntimeReleaseFreshness(diagnostic);
async function collectLiveInfrastructureFreshness(){return collectInfrastructureFreshness({workerRevision:deploymentMetadata?.commitSha,runtimeFreshness:async()=>{const diagnostic=await diagnoseADTRuntime();return{...resolveRuntimeReleaseFreshness(diagnostic),redeployTargets:diagnostic.protocolCompatible?diagnostic.redeployTargets??[]:[]}},runnerFreshness:async()=>{try{return runnerReleaseFreshness(await workflowRuntimeCommand<RunnerCapabilities>({operation:"runner.release"}))}catch{return{state:"unknown" as const,unknownReason:"observation_unavailable" as const}}},timeoutMs:INFRASTRUCTURE_FRESHNESS_SERVER_TIMEOUT_MS})}

export async function getFreshInfrastructureFreshnessSnapshot() {
 const generation=++cacheGeneration;
 const snapshot=await collectLiveInfrastructureFreshness();
 if(generation===cacheGeneration)cached={snapshot,expiresAt:Date.now()+infrastructureFreshnessServerTtl(snapshot)};
 return snapshot;
}

export async function getInfrastructureFreshnessSnapshot(now=Date.now()) {
 if(cached&&cached.expiresAt>now)return cached.snapshot;
 if(inFlight)return inFlight;
 const promise=getFreshInfrastructureFreshnessSnapshot().finally(()=>{if(inFlight===promise)inFlight=undefined});
 inFlight=promise;
 return promise;
}

export function invalidateInfrastructureFreshnessCache() {
 cacheGeneration++;
 cached=undefined;
 inFlight=undefined;
}

export function clearInfrastructureFreshnessCacheForTests(){invalidateInfrastructureFreshnessCache()}
