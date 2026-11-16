import {z} from "zod";
import {readBoundedJson} from "./bounded-json.ts";
import {KNOWLEDGE_ROOT,MAX_KNOWLEDGE_BYTES,knowledgePath,isKnowledgePath,parseKnowledge,serializeKnowledge,searchKnowledge,type KnowledgeEntry,type KnowledgeQuery,type KnowledgeDocument} from "./advisor-knowledge.ts";
import {writeGitHubContents,GitContentWriteError} from "./github-content-write.ts";
import {assertNoSecrets,ArtifactSecretRejectedError} from "./artifact-repository.ts";
import type {RunRepositoryContext} from "./workflow-storage.ts";
import type {RepositoryCredentialCapability,RepositoryCredential} from "./github-app.ts";

const sha=z.string().regex(/^[a-f0-9]{40,64}$/i);
const treeSchema=z.object({tree:z.array(z.object({path:z.string().max(256),mode:z.string(),type:z.string(),sha,size:z.number().int().nonnegative().optional()})).max(10000),truncated:z.boolean().optional()});
type TreeEntry=z.infer<typeof treeSchema>["tree"][number];
export interface KnowledgeReader{search(query:KnowledgeQuery):Promise<unknown>;read(id:string):Promise<KnowledgeEntry|undefined>}
/** Only this exact namespace is addressable. Immutable Git trees/blobs prevent Contents symlink following. */
export class GitHubKnowledgeRepository implements KnowledgeReader{
 private context:RunRepositoryContext;private credential:(capability:RepositoryCredentialCapability)=>Promise<RepositoryCredential>;private fetchImpl:typeof fetch;
 constructor(context:RunRepositoryContext,credential:(capability:RepositoryCredentialCapability)=>Promise<RepositoryCredential>,fetchImpl:typeof fetch=fetch){this.context=context;this.credential=credential;this.fetchImpl=fetchImpl}
 private url(path:string){return `https://api.github.com/repos/${encodeURIComponent(this.context.owner)}/${encodeURIComponent(this.context.repository)}${path}`}
 private async get(path:string):Promise<unknown>{
  const credential=await this.credential("read");if(!["read","write"].includes(credential.permissions.contents??""))throw Error("permission_denied");
  let response:Response;try{response=await this.fetchImpl(this.url(path),{headers:{accept:"application/vnd.github+json",authorization:`Bearer ${credential.token}`,"user-agent":"artifact-dev-toolkit"},redirect:"error",cache:"no-store"})}catch{throw Error("knowledge_unavailable")}
  if(!response.ok)throw Error("knowledge_unavailable");
  try{return await readBoundedJson(response,2_000_000)}catch{throw Error("knowledge_unavailable")}
 }
 private async tree(revision:string){const value=treeSchema.parse(await this.get(`/git/trees/${sha.parse(revision)}`));if(value.truncated)throw Error("knowledge_library_limit");if(new Set(value.tree.map(e=>e.path)).size!==value.tree.length)throw Error("knowledge_invalid");return value.tree}
 private async namespace(){
  const ref=z.object({object:z.object({sha})}).parse(await this.get(`/git/ref/heads/${encodeURIComponent(this.context.branch)}`)),revision=ref.object.sha;
  let entries=await this.tree(revision);
  for(const name of KNOWLEDGE_ROOT.split("/")){
   const entry=entries.find(e=>e.path===name);if(!entry)return {revision,entries:[]};
   if(entry.type!=="tree"||entry.mode!=="040000")throw Error("knowledge_invalid");entries=await this.tree(entry.sha);
  }
  return {revision,entries};
 }
 private async document(entry:TreeEntry,revision:string):Promise<KnowledgeEntry>{
  const path=`${KNOWLEDGE_ROOT}/${entry.path}`;
  if(entry.type!=="blob"||entry.mode!=="100644"||!isKnowledgePath(path)||entry.size!==undefined&&entry.size>MAX_KNOWLEDGE_BYTES)throw Error("knowledge_invalid");
  const blob=z.object({sha:z.literal(entry.sha),encoding:z.literal("base64"),size:z.number().int().min(1).max(MAX_KNOWLEDGE_BYTES),content:z.string().max(MAX_KNOWLEDGE_BYTES*2)}).parse(await this.get(`/git/blobs/${entry.sha}`));
  const document=parseKnowledge(Buffer.from(blob.content.replace(/\s/g,""),"base64").toString("utf8"),path);
  return {...document,path,fileSha:entry.sha,revision,sourceUrl:`https://github.com/${encodeURIComponent(this.context.owner)}/${encodeURIComponent(this.context.repository)}/blob/${revision}/${path}`};
 }
 async read(id:string){const path=knowledgePath(id),{revision,entries}=await this.namespace(),entry=entries.find(e=>`${KNOWLEDGE_ROOT}/${e.path}`===path);return entry?this.document(entry,revision):undefined}
 async search(query:KnowledgeQuery){
  if(query.id){const entry=await this.read(query.id);return entry?{available:true,...entry,untrusted:true}:{available:false,reason:"not_found"}}
  const {revision,entries}=await this.namespace();
  if(entries.length>200)throw Error("knowledge_library_limit");
  const documents:KnowledgeEntry[]=[];let invalidCount=0,scannedBytes=0;
  // Bounded concurrency; one immutable revision for the complete scan. No authoritative D1 index.
  for(let offset=0;offset<entries.length;offset+=4){
   const batch=await Promise.all(entries.slice(offset,offset+4).map(async entry=>{
    try{return await this.document(entry,revision)}catch(error){if(error instanceof Error&&["knowledge_unavailable","permission_denied"].includes(error.message))throw error;invalidCount++;return undefined}
   }));
   for(const entry of batch)if(entry){documents.push(entry);scannedBytes+=Buffer.byteLength(serializeKnowledge({metadata:entry.metadata,body:entry.body}));if(scannedBytes>2_000_000)throw Error("knowledge_library_limit")}
  }
  return {...searchKnowledge(documents,query),revision,invalidCount};
 }
 /** Trusted application operation only; never registered as an Agent tool. */
 async publish(document:KnowledgeDocument,expectedSha:string|null,actor:string){
  const markdown=serializeKnowledge(document),path=knowledgePath(document.metadata.id);
  try{assertNoSecrets(markdown)}catch(error){if(error instanceof ArtifactSecretRejectedError)throw Error("knowledge_secret_rejected");throw error}
  if(!/^[A-Za-z0-9-]{1,80}$/.test(actor))throw Error("permission_denied");
  if(expectedSha!==null)sha.parse(expectedSha);
  const current=await this.read(document.metadata.id);
  if((current?.fileSha??null)!==expectedSha)throw Error("knowledge_conflict");
  const credential=await this.credential("write");if(credential.permissions.contents!=="write")throw Error("permission_denied");
  try{
   const result=await writeGitHubContents({url:this.url(`/contents/${path}`),token:credential.token,path,markdown,message:`Publish Advisor knowledge ${document.metadata.id} (approved by @${actor})`,branch:this.context.branch,sha:expectedSha??undefined,fetchImpl:this.fetchImpl});
   if(!sha.safeParse(result.fileSha).success||!sha.safeParse(result.commitSha).success||result.commitUrl!==`https://github.com/${this.context.owner}/${this.context.repository}/commit/${result.commitSha}`)throw Error("knowledge_publish_uncertain");
   return result;
  }catch(error){if(error instanceof GitContentWriteError)throw Error(error.code==="conflict"?"knowledge_conflict":error.code==="permission"||error.code==="authentication"?"permission_denied":"knowledge_publish_uncertain");throw error}
 }
}
