import {resolveComponentFreshness} from "./deployment-freshness-resolution.ts";
import type {InfrastructureComponentFreshness} from "./infrastructure-freshness.ts";

const FULL_SHA=/^[0-9a-f]{40}$/i;

export async function resolveObservedComponentFreshness(
  component:"worker"|"runtime",
  deployedRevision:string|undefined,
  signal:AbortSignal,
  loadHead:(signal:AbortSignal)=>Promise<string|undefined>,
  loadComparison:(deployedRevision:string,headRevision:string,signal:AbortSignal)=>Promise<unknown|undefined>,
):Promise<InfrastructureComponentFreshness> {
  const revision=deployedRevision?.trim().toLowerCase();
  if(!revision||!FULL_SHA.test(revision)||signal.aborted)return{state:"unknown"};
  const headRevision=await loadHead(signal);
  if(!headRevision||!FULL_SHA.test(headRevision)||signal.aborted)return{state:"unknown",deployedRevision:revision};
  const result=await resolveComponentFreshness(component,revision,headRevision,()=>loadComparison(revision,headRevision,signal));
  return signal.aborted?{state:"unknown",deployedRevision:revision}:{...result,deployedRevision:revision};
}
