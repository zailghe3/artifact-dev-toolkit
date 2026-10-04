import "server-only";
import {deploymentMetadata} from "./deployment-metadata.ts";
import {runnerReleaseFreshness} from "./codex-runner-compatibility.ts";
import {getCodexRunnerClient} from "./codex-runner-client.ts";
import {diagnoseADTRuntime} from "./workflow-services.ts";
import {adtRuntimeReleaseFreshness} from "./adt-runtime-release.ts";
import {collectInfrastructureFreshness} from "./infrastructure-freshness-service.ts";
import {infrastructureFreshnessServerTtl,INFRASTRUCTURE_FRESHNESS_SERVER_TIMEOUT_MS,type InfrastructureFreshnessSnapshot} from "./infrastructure-freshness.ts";
let cached:{expiresAt:number;snapshot:InfrastructureFreshnessSnapshot}|undefined,inFlight:Promise<InfrastructureFreshnessSnapshot>|undefined;
export const resolveRuntimeReleaseFreshness=(diagnostic:{runtimeRevision?:unknown;runtimeReleaseRevision?:unknown})=>adtRuntimeReleaseFreshness(diagnostic);
async function collectLiveInfrastructureFreshness(){return collectInfrastructureFreshness({workerRevision:deploymentMetadata?.commitSha,runtimeFreshness:async()=>{const diagnostic=await diagnoseADTRuntime();return{...resolveRuntimeReleaseFreshness(diagnostic),redeployTargets:diagnostic.protocolCompatible?diagnostic.redeployTargets??[]:[]}},runnerFreshness:async signal=>{try{return runnerReleaseFreshness(await getCodexRunnerClient().capabilities(signal))}catch{return{state:"unknown" as const,unknownReason:"observation_unavailable" as const}}},timeoutMs:INFRASTRUCTURE_FRESHNESS_SERVER_TIMEOUT_MS})}
export async function getInfrastructureFreshnessSnapshot(now=Date.now()){if(cached&&cached.expiresAt>now)return cached.snapshot;if(inFlight)return inFlight;const promise=collectLiveInfrastructureFreshness().then(snapshot=>(cached={snapshot,expiresAt:Date.now()+infrastructureFreshnessServerTtl(snapshot)},snapshot)).finally(()=>{if(inFlight===promise)inFlight=undefined});inFlight=promise;return promise}
export async function getFreshInfrastructureFreshnessSnapshot(){const snapshot=await collectLiveInfrastructureFreshness();cached={snapshot,expiresAt:Date.now()+infrastructureFreshnessServerTtl(snapshot)};return snapshot}
export function invalidateInfrastructureFreshnessCache(){cached=undefined}
export function clearInfrastructureFreshnessCacheForTests(){cached=undefined;inFlight=undefined}
