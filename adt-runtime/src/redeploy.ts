export const REDEPLOY_PATH="/v1/infrastructure/redeploy",REDEPLOY_CAPABILITY="infrastructure:redeploy",REDEPLOY_TIMEOUT_MS=10_000;
export type RedeployTarget="runtime"|"runner";
export type RedeployRole="runtime"|"executor"|"repository-manager"|"controller";
export type RedeployConfiguration=Partial<Record<RedeployRole,string>>;
export type RedeployOutcome={role:RedeployRole;outcome:"accepted"|"rejected"|"ambiguous";httpStatus?:number;elapsedMs:number};

export function validRedeployUrl(value:string|undefined){
 if(!value||value.length>2048)return false;
 try{const url=new URL(value);return (url.protocol==="http:"||url.protocol==="https:")&&!url.username&&!url.password&&Boolean(url.hostname)}catch{return false}
}

export function redeployAvailable(target:RedeployTarget,configuration:RedeployConfiguration){
 const roles:RedeployRole[]=target==="runtime"?["runtime"]:["executor","repository-manager","controller"];
 return roles.every(role=>validRedeployUrl(configuration[role]));
}

export async function requestRedeploy(target:RedeployTarget,configuration:RedeployConfiguration,fetcher:typeof fetch=fetch,now=Date.now):Promise<{accepted:boolean;ambiguous:boolean;outcomes:RedeployOutcome[]}>{
 const roles:RedeployRole[]=target==="runtime"?["runtime"]:["executor","repository-manager","controller"],outcomes:RedeployOutcome[]=[];
 for(const role of roles){
  const url=configuration[role];if(!validRedeployUrl(url))throw new Error("redeploy_not_configured");
  const started=now();
  try{
   const response=await fetcher(url!,{method:"POST",redirect:"manual",signal:AbortSignal.timeout(REDEPLOY_TIMEOUT_MS)}),elapsedMs=Math.max(0,Math.min(60_000,now()-started));
   if(response.status>=200&&response.status<300){outcomes.push({role,outcome:"accepted",httpStatus:response.status,elapsedMs});continue}
   outcomes.push({role,outcome:"rejected",httpStatus:response.status,elapsedMs});return{accepted:false,ambiguous:false,outcomes};
  }catch{outcomes.push({role,outcome:"ambiguous",elapsedMs:Math.max(0,Math.min(60_000,now()-started))});return{accepted:false,ambiguous:true,outcomes}}
 }
 return{accepted:true,ambiguous:false,outcomes};
}
