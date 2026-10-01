import {resolveComponentFreshness} from "./deployment-freshness-resolution.ts";
import type {InfrastructureComponentFreshness} from "./infrastructure-freshness.ts";
import {GitHubFreshnessEvidenceError} from "./github-freshness-evidence.ts";

const FULL_SHA=/^[0-9a-f]{40}$/i;

export async function resolveObservedComponentFreshness(
  component:"worker"|"runtime",
  deployedRevision:string|undefined,
  signal:AbortSignal,
  loadHead:(signal:AbortSignal)=>Promise<string|undefined>,
  loadComparison:(deployedRevision:string,headRevision:string,signal:AbortSignal)=>Promise<unknown|undefined>,
):Promise<InfrastructureComponentFreshness> {
  const revision=deployedRevision?.trim().toLowerCase();
  if(!revision||!FULL_SHA.test(revision)||signal.aborted)return{state:"unknown",unknownReason:"revision_unavailable"};
  let headRevision:string|undefined;
  try{headRevision=await loadHead(signal)}catch(error){return{state:"unknown",deployedRevision:revision,unknownReason:error instanceof GitHubFreshnessEvidenceError?error.reason:"github_access_unavailable"}}
  if(!headRevision||!FULL_SHA.test(headRevision)||signal.aborted)return{state:"unknown",deployedRevision:revision,unknownReason:"source_head_unavailable"};
  let result:InfrastructureComponentFreshness;
  try{result=await resolveComponentFreshness(component,revision,headRevision,()=>loadComparison(revision,headRevision!,signal))}catch(error){return{state:"unknown",deployedRevision:revision,sourceHeadRevision:headRevision,unknownReason:error instanceof GitHubFreshnessEvidenceError?error.reason:"comparison_unavailable"}}
  return signal.aborted?{state:"unknown",deployedRevision:revision}:{...result,deployedRevision:revision};
}
