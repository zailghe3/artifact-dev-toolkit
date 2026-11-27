import {z} from "zod";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {createKnowledgeProposalStore,createKnowledgeRepository} from "@/lib/advisor-knowledge-services";
import {knowledgeError,requireKnowledgeIntent} from "@/lib/advisor-knowledge-http";
import {readBoundedJson} from "@/lib/bounded-json";
import {noStoreHeaders} from "@/lib/auth-core";
const input=z.discriminatedUnion("action",[
 z.object({action:z.literal("review"),revision:z.number().int().positive()}).strict(),
 z.object({action:z.literal("publish"),revision:z.number().int().positive(),reviewToken:z.string().min(40).max(64),confirmation:z.literal("publish")}).strict(),
]);
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;
 try{
  const id=z.string().uuid().parse((await params).id);
  const store=await createKnowledgeProposalStore(auth.access,{githubId:auth.session.githubId,login:auth.session.login,sessionId:auth.session.id});
  return Response.json(await store.get(id),{headers:noStoreHeaders});
 }catch(error){return knowledgeError(error)}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 // Fresh OAuth repository authority for each review and each actual Git mutation. Runtime bearer auth is not accepted here.
 const auth=await requireApiRepositoryAccess(request,{fresh:true});if(auth instanceof Response)return auth;
 try{
  requireKnowledgeIntent(request);const id=z.string().uuid().parse((await params).id),body=input.parse(await readBoundedJson(request,2048));
  const store=await createKnowledgeProposalStore(auth.access,{githubId:auth.session.githubId,login:auth.session.login,sessionId:auth.session.id});
  if(body.action==="review")return Response.json(await store.review(id,body.revision),{headers:noStoreHeaders});
  const repository=createKnowledgeRepository(auth.access);
  return Response.json(await store.publish(id,body.revision,body.reviewToken,(document,sha,actor)=>repository.publish(document,sha,actor)),{headers:noStoreHeaders});
 }catch(error){return knowledgeError(error)}
}
