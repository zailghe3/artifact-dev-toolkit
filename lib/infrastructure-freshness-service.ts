import {aggregateInfrastructureFreshness,INFRASTRUCTURE_FRESHNESS_SERVER_TIMEOUT_MS,type InfrastructureComponentFreshness,type InfrastructureFreshnessSnapshot} from "./infrastructure-freshness.ts";

export type InfrastructureComponentFreshnessProbe=(signal:AbortSignal)=>Promise<InfrastructureComponentFreshness>;
export type InfrastructureFreshnessDependencies={workerRevision?:string;runtimeFreshness:InfrastructureComponentFreshnessProbe;runnerFreshness:InfrastructureComponentFreshnessProbe;now?:()=>Date;timeoutMs?:number};
const FULL_SHA=/^[0-9a-f]{40}$/i;
const normalizedRevision=(value:string|undefined)=>value?.trim()&&FULL_SHA.test(value.trim())?value.trim().toLowerCase():undefined;

async function observed(value:Promise<InfrastructureComponentFreshness>,signal:AbortSignal):Promise<InfrastructureComponentFreshness>{
 try{const item=await value;if(signal.aborted)return{state:"unknown",unknownReason:"observation_timeout"};return item}catch{return{state:"unknown",unknownReason:"observation_unavailable"}}
}
function deadline(value:Promise<InfrastructureComponentFreshness>,signal:AbortSignal){return Promise.race([value,new Promise<InfrastructureComponentFreshness>(resolve=>signal.addEventListener("abort",()=>resolve({state:"unknown",unknownReason:"observation_timeout"}),{once:true}))])}

export async function collectInfrastructureFreshness(dependencies:InfrastructureFreshnessDependencies):Promise<InfrastructureFreshnessSnapshot>{
 const controller=new AbortController(),timeoutMs=Math.max(250,Math.min(dependencies.timeoutMs??INFRASTRUCTURE_FRESHNESS_SERVER_TIMEOUT_MS,5_000)),timer=setTimeout(()=>controller.abort(),timeoutMs),signal=controller.signal;
 try{
  const workerRevision=normalizedRevision(dependencies.workerRevision),worker:InfrastructureComponentFreshness=workerRevision?{state:"current",deployedRevision:workerRevision}:{state:"unknown",unknownReason:"revision_unavailable"};
  const [runtime,runner]=await Promise.all([deadline(observed(dependencies.runtimeFreshness(signal),signal),signal),deadline(observed(dependencies.runnerFreshness(signal),signal),signal)]);
  const components={worker,runtime,runner};
  return{state:aggregateInfrastructureFreshness(components),checkedAt:(dependencies.now?.()??new Date()).toISOString(),components};
 }finally{clearTimeout(timer);controller.abort()}
}
