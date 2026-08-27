import { z } from "zod";
import { noStoreHeaders } from "./auth-core.ts";
import { ArtifactSearchAuthorityBudget, boundedArtifactSearch, verifyArtifactSearchAuthority } from "./artifact-search-tool.ts";
import type { Artifact } from "./artifact-repository.ts";
import type { RunRepositoryContext, WorkflowRunStorage } from "./workflow-storage.ts";

const requestSchema=z.object({runId:z.string().uuid(),tool:z.literal("artifact_search"),callId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),arguments:z.unknown()}).strict();
const sameContext=(a:RunRepositoryContext,b:RunRepositoryContext)=>a.repositoryId===b.repositoryId&&a.installationId===b.installationId&&a.owner.toLowerCase()===b.owner.toLowerCase()&&a.repository.toLowerCase()===b.repository.toLowerCase()&&a.branch===b.branch&&a.root===b.root;
const denied=()=>Response.json({error:"Artifact search authority is invalid."},{status:401,headers:noStoreHeaders});

export function createArtifactSearchGateway(dependencies:{storage:WorkflowRunStorage;secret:string;loadArtifacts:(context:RunRepositoryContext)=>Promise<readonly Artifact[]>;budget?:ArtifactSearchAuthorityBudget;now?:()=>number}){
 const budget=dependencies.budget??new ArtifactSearchAuthorityBudget();
 return async(request:Request)=>{let input:z.infer<typeof requestSchema>;try{const raw=await request.text();if(Buffer.byteLength(raw,"utf8")>2048)throw new Error();input=requestSchema.parse(JSON.parse(raw));}catch{return Response.json({error:"Artifact search request is invalid."},{status:400,headers:noStoreHeaders})}const header=request.headers.get("authorization")??"",token=header.startsWith("Bearer ")?header.slice(7):"";let authority;try{authority=verifyArtifactSearchAuthority(token,dependencies.secret,input.runId,dependencies.now?.());}catch{return denied()}const detail=await dependencies.storage.getRun(input.runId),context=detail?.run.repositoryContext,agent=detail?.run.currentStepId?detail.run.workflowSnapshot.steps.find(step=>step.id===detail.run.currentStepId):undefined,snapshot=agent?detail?.run.agentSnapshots[agent.agentId]:undefined;if(!detail||!context||!snapshot?.tools?.includes("artifact_search")||!sameContext(authority,context))return denied();try{budget.accept(authority,input.callId,dependencies.now?.());const artifacts=await dependencies.loadArtifacts(context);return Response.json(boundedArtifactSearch(artifacts,input.arguments),{headers:noStoreHeaders});}catch{return Response.json({error:"Artifact search failed safely."},{status:422,headers:noStoreHeaders})}};
}
