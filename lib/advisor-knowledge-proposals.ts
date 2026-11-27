import {randomBytes} from "node:crypto";
import {agentDigest} from "./agent-journal.ts";
import {knowledgeDocumentSchema,serializeKnowledge,type KnowledgeDocument} from "./advisor-knowledge.ts";
import type {RunRepositoryContext} from "./workflow-storage.ts";
import type {WorkflowD1Database} from "./workflow-d1-storage.ts";

type ProposalRow={id:string;document_json:string;expected_sha:string|null;revision:number;state:"draft"|"reviewed"|"publishing"|"published"|"conflict"|"uncertain";review_digest:string|null;review_session:string|null;review_expires_at:number|null;publication_json:string|null;created_at:number;updated_at:number};
export type KnowledgeProposal={id:string;document:KnowledgeDocument;expectedSha:string|null;revision:number;state:ProposalRow["state"];publication:unknown;createdAt:number;updatedAt:number};
export type KnowledgeActor={githubId:number;login:string;sessionId:string};
const view=(row:ProposalRow):KnowledgeProposal=>({id:row.id,document:knowledgeDocumentSchema.parse(JSON.parse(row.document_json)),expectedSha:row.expected_sha,revision:row.revision,state:row.state,publication:row.publication_json?JSON.parse(row.publication_json):null,createdAt:row.created_at,updatedAt:row.updated_at});
/** Session-owned operational proposals. A proposal's contents never authorise a mutation. */
export class KnowledgeProposalStore{
 private db:WorkflowD1Database;private scope:string;private actor:KnowledgeActor;private now:()=>number;
 constructor(db:WorkflowD1Database,context:RunRepositoryContext,actor:KnowledgeActor,now=()=>Date.now()){this.db=db;this.scope=agentDigest({...context,owner:context.owner.toLowerCase(),repository:context.repository.toLowerCase()});this.actor=actor;this.now=now}
 private async row(id:string){const row=await this.db.prepare("SELECT * FROM advisor_knowledge_proposals WHERE id=? AND repository_scope=? AND owner_id=?").bind(id,this.scope,this.actor.githubId).first<ProposalRow>();if(!row)throw Error("knowledge_proposal_not_found");return row}
 async get(id:string){return view(await this.row(id))}
 async list(){const rows=(await this.db.prepare("SELECT * FROM advisor_knowledge_proposals WHERE repository_scope=? AND owner_id=? ORDER BY updated_at DESC,id LIMIT 50").bind(this.scope,this.actor.githubId).all<ProposalRow>()).results??[];return rows.map(view)}
 async save(input:{id?:string;revision?:number;document:KnowledgeDocument;expectedSha:string|null}){
  const document=knowledgeDocumentSchema.parse(input.document);serializeKnowledge(document);
  const id=input.id??crypto.randomUUID(),now=this.now();
  const result=input.id?await this.db.prepare("UPDATE advisor_knowledge_proposals SET document_json=?,expected_sha=?,revision=revision+1,state='draft',review_digest=NULL,review_session=NULL,review_expires_at=NULL,updated_at=? WHERE id=? AND repository_scope=? AND owner_id=? AND revision=? AND state IN ('draft','reviewed','conflict')").bind(JSON.stringify(document),input.expectedSha,now,id,this.scope,this.actor.githubId,input.revision??0).run():await this.db.prepare("INSERT INTO advisor_knowledge_proposals(id,repository_scope,owner_id,actor,document_json,expected_sha,state,created_at,updated_at) VALUES(?,?,?,?,?,?,'draft',?,?)").bind(id,this.scope,this.actor.githubId,this.actor.login,JSON.stringify(document),input.expectedSha,now,now).run();
  if(result.meta?.changes!==1)throw Error("knowledge_conflict");return this.get(id);
 }
 async saveFromAction(actionId:string, input:KnowledgeDocument){
  const document=knowledgeDocumentSchema.parse(input);serializeKnowledge(document);
  const now=this.now();
  await this.db.prepare(`INSERT INTO advisor_knowledge_proposals
   (id,repository_scope,owner_id,actor,document_json,source_action_id,state,created_at,updated_at)
   VALUES (?,?,?,?,?,?,'draft',?,?) ON CONFLICT (repository_scope,owner_id,source_action_id) DO NOTHING`)
   .bind(crypto.randomUUID(),this.scope,this.actor.githubId,this.actor.login,JSON.stringify(document),actionId,now,now).run();
  const proposal=await this.db.prepare(`SELECT * FROM advisor_knowledge_proposals WHERE repository_scope=? AND owner_id=? AND source_action_id=?`)
   .bind(this.scope,this.actor.githubId,actionId).first<ProposalRow>();
  if(!proposal)throw new Error("knowledge_proposal_not_found");
  return view(proposal);
 }
 async review(id:string,revision:number){
  const row=await this.row(id);if(row.revision!==revision||!["draft","reviewed"].includes(row.state))throw Error("knowledge_conflict");
  const token=randomBytes(32).toString("base64url"),expires=this.now()+300000;
  const result=await this.db.prepare("UPDATE advisor_knowledge_proposals SET state='reviewed',review_digest=?,review_session=?,review_expires_at=?,updated_at=? WHERE id=? AND repository_scope=? AND owner_id=? AND revision=? AND state IN ('draft','reviewed')").bind(agentDigest(token),agentDigest(this.actor.sessionId),expires,this.now(),id,this.scope,this.actor.githubId,revision).run();
  if(result.meta?.changes!==1)throw Error("knowledge_conflict");
  return {proposal:await this.get(id),reviewToken:token,expiresAt:expires};
 }
 async claimPublication(id:string,revision:number,reviewToken:string){
  const row=await this.row(id);
  if(row.state!=="reviewed"||row.revision!==revision||row.review_digest!==agentDigest(reviewToken)||row.review_session!==agentDigest(this.actor.sessionId)||!row.review_expires_at||row.review_expires_at<=this.now())throw Error("knowledge_review_required");
  const result=await this.db.prepare("UPDATE advisor_knowledge_proposals SET state='publishing',review_digest=NULL,review_session=NULL,review_expires_at=NULL,updated_at=? WHERE id=? AND repository_scope=? AND owner_id=? AND revision=? AND state='reviewed' AND review_digest=? AND review_session=? AND review_expires_at>?").bind(this.now(),id,this.scope,this.actor.githubId,revision,row.review_digest,row.review_session,this.now()).run();
  if(result.meta?.changes!==1)throw Error("knowledge_review_required");
  return {document:view(row).document,expectedSha:row.expected_sha,actor:this.actor.login};
 }
 async finishPublication(id:string,input:{state:"published"|"draft"|"conflict"|"uncertain";publication?:unknown}){
  if(!["published","draft","conflict","uncertain"].includes(input.state))throw Error("knowledge_publish_uncertain");
  const result=await this.db.prepare("UPDATE advisor_knowledge_proposals SET state=?,publication_json=?,updated_at=? WHERE id=? AND repository_scope=? AND owner_id=? AND state='publishing'")
   .bind(input.state,input.publication===undefined?null:JSON.stringify(input.publication),this.now(),id,this.scope,this.actor.githubId).run();
  if(result.meta?.changes!==1)throw Error("knowledge_publish_uncertain");
  return this.get(id);
 }
 async publish(id:string,revision:number,reviewToken:string,publisher:(document:KnowledgeDocument,expectedSha:string|null,actor:string)=>Promise<unknown>){
  return publishClaimedKnowledge(this,id,revision,reviewToken,publisher);
 }
}

export async function publishClaimedKnowledge(
 store:Pick<KnowledgeProposalStore,"claimPublication"|"finishPublication">,id:string,revision:number,reviewToken:string,
 publisher:(document:KnowledgeDocument,expectedSha:string|null,actor:string)=>Promise<unknown>,
){
 const claim=await store.claimPublication(id,revision,reviewToken);
 let publication:unknown;
 try {
  publication=await publisher(claim.document,claim.expectedSha,claim.actor);
 } catch(error) {
  const code=error instanceof Error?error.message:"";
  const state=code==="knowledge_secret_rejected"?"draft":code==="knowledge_conflict"?"conflict":"uncertain";
  await store.finishPublication(id,{state});
  throw Error(state==="draft"?"knowledge_secret_rejected":state==="conflict"?"knowledge_conflict":"knowledge_publish_uncertain");
 }
 return store.finishPublication(id,{state:"published",publication});
}
