import {noStoreHeaders} from "./auth-core.ts";
import type {InfrastructureFreshnessSnapshot} from "./infrastructure-freshness.ts";
import type {RuntimeRedeployResult} from "./adt-runtime-client.ts";

type Target="runtime"|"runner";
type Dependencies={
 authorize:(request:Request)=>Promise<unknown|Response>;
 freshness:()=>Promise<InfrastructureFreshnessSnapshot>;
 redeploy:(target:Target)=>Promise<RuntimeRedeployResult>;
 invalidate:()=>void;
};
const json=(value:unknown,status:number)=>Response.json(value,{status,headers:noStoreHeaders});

export async function handleInfrastructureRedeploy(request:Request,dependencies:Dependencies){
 const authorization=await dependencies.authorize(request);if(authorization instanceof Response)return authorization;
 if(request.headers.get("origin")!==new URL(request.url).origin)return json({state:"rejected",message:"Request origin is invalid."},403);
 let target:Target;try{const value=await request.json() as Record<string,unknown>;if(!value||Array.isArray(value)||Object.keys(value).length!==1||(value.target!=="runtime"&&value.target!=="runner"))throw Error();target=value.target}catch{return json({state:"rejected",message:"Redeploy target is invalid."},400)}
 try{
  const snapshot=await dependencies.freshness(),state=snapshot.components[target].state;
  if(state!=="superseded")return json({state:"rejected",message:state==="unknown"?"Update eligibility could not be confirmed.":"This component is not currently superseded."},409);
  const result=await dependencies.redeploy(target);if(result.state==="accepted")dependencies.invalidate();
  return json(result,result.state==="accepted"?202:result.state==="unsupported"?501:result.state==="ambiguous"?502:503);
 }catch{return json({state:"rejected",message:"Redeploy is temporarily unavailable."},503)}
}
