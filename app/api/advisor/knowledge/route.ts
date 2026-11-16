import {requireApiRepositoryAccess} from "@/lib/auth";
import {adtDataArgumentSchemas} from "@/lib/adt-data-contract";
import {createKnowledgeRepository} from "@/lib/advisor-knowledge-services";
import {knowledgeError} from "@/lib/advisor-knowledge-http";
import {noStoreHeaders} from "@/lib/auth-core";
export async function GET(request:Request){
 const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;
 try{
  const p=new URL(request.url).searchParams;
  const query=adtDataArgumentSchemas.adt_advisor_knowledge_search.parse(Object.fromEntries([...p.entries()].map(([key,value])=>[key,key==="offset"||key==="limit"?Number(value):key==="tags"?value.split(","):value])));
  return Response.json(await createKnowledgeRepository(auth.access).search(query),{headers:noStoreHeaders});
 }catch(error){return knowledgeError(error)}
}
