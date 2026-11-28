import {z} from "zod";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {knowledgeDocumentSchema} from "@/lib/advisor-knowledge";
import {createKnowledgeProposalStore} from "@/lib/advisor-knowledge-services";
import {knowledgeError} from "@/lib/advisor-knowledge-http";
import {readBoundedJson} from "@/lib/bounded-json";
import {noStoreHeaders} from "@/lib/auth-core";
const input=z.object({document:knowledgeDocumentSchema,expectedSha:z.string().regex(/^[a-f0-9]{40,64}$/i).nullable(),id:z.string().uuid().optional(),revision:z.number().int().positive().optional()}).strict();
export async function GET(request:Request){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;try{return Response.json({proposals:await(await createKnowledgeProposalStore(auth.access,{githubId:auth.session.githubId,login:auth.session.login,sessionId:auth.session.id})).list()},{headers:noStoreHeaders})}catch(error){return knowledgeError(error)}}
export async function POST(request:Request){
 const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;
 try{const body=input.parse(await readBoundedJson(request,65536));return Response.json(await(await createKnowledgeProposalStore(auth.access,{githubId:auth.session.githubId,login:auth.session.login,sessionId:auth.session.id})).save(body),{headers:noStoreHeaders})}catch(error){return knowledgeError(error)}
}
