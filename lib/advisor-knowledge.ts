import {z} from "zod";
import {parseMarkdownFrontMatter,serializeMarkdownFrontMatter} from "./markdown-front-matter.ts";

export const KNOWLEDGE_ROOT="advisor/knowledge",MAX_KNOWLEDGE_BYTES=32768;
export const knowledgeId=z.string().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const references=z.array(knowledgeId).max(32).default([]);
export const knowledgeMetadataSchema=z.object({
 id:knowledgeId,title:z.string().trim().min(1).max(160),type:z.enum(["decision","principle","finding","design"]),
 tags:z.array(z.string().trim().min(1).max(40)).max(16).default([]),status:z.enum(["active","resolved","superseded"]),
 workflowIds:references,agentIds:references,runIds:z.array(z.string().uuid()).max(32).default([]),related:references,supersedes:references,
 evidence:z.array(z.object({revision:z.string().min(1).max(128),source:z.string().min(1).max(240)}).strict()).max(16).default([]),
 createdAt:z.string().datetime().optional(),updatedAt:z.string().datetime().optional(),
}).strict().superRefine((v,c)=>{if(v.related.includes(v.id)||v.supersedes.includes(v.id))c.addIssue({code:"custom",message:"An entry cannot reference itself."})});
export const knowledgeDocumentSchema=z.object({metadata:knowledgeMetadataSchema,body:z.string().trim().min(1).max(MAX_KNOWLEDGE_BYTES)}).strict();
export type KnowledgeDocument=z.infer<typeof knowledgeDocumentSchema>;
export type KnowledgeEntry=KnowledgeDocument&{path:string;fileSha:string;revision:string;sourceUrl?:string};
export function knowledgePath(id:string){return `${KNOWLEDGE_ROOT}/${knowledgeId.parse(id)}.md`}
export function isKnowledgePath(path:string){return /^advisor\/knowledge\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(path)&&path.length<=KNOWLEDGE_ROOT.length+1+80+3}
export function serializeKnowledge(input:unknown){
 const document=knowledgeDocumentSchema.parse(input);
 try{return serializeMarkdownFrontMatter(document.metadata,`${document.body}\n`,MAX_KNOWLEDGE_BYTES)}
 catch{throw Error("knowledge_too_large")}
}
export function parseKnowledge(markdown:string,path:string):KnowledgeDocument{
 if(!isKnowledgePath(path)||Buffer.byteLength(markdown)>MAX_KNOWLEDGE_BYTES)throw Error("knowledge_invalid");
 try{
  const parsed=parseMarkdownFrontMatter(markdown,MAX_KNOWLEDGE_BYTES);
  const document=knowledgeDocumentSchema.parse({metadata:parsed.data,body:parsed.body});
  if(knowledgePath(document.metadata.id)!==path)throw Error("knowledge_invalid");
  return document;
 }catch{throw Error("knowledge_invalid")}
}
export type KnowledgeQuery={id?:string;query?:string;type?:string;status?:string;tags?:string[];workflowId?:string;agentId?:string;offset?:number;limit?:number};
export function searchKnowledge(entries:KnowledgeEntry[],query:KnowledgeQuery){
 const {offset=0,limit=10}=query,terms=(query.query??"").toLowerCase().split(/\s+/).filter(Boolean);
 const matched=entries.filter(({metadata:m,body})=>(!query.type||m.type===query.type)&&(!query.status||m.status===query.status)&&(!query.workflowId||m.workflowIds.includes(query.workflowId))&&(!query.agentId||m.agentIds.includes(query.agentId))&&(!query.tags||query.tags.every(tag=>m.tags.includes(tag)))&&terms.every(term=>`${m.id} ${m.title} ${m.tags.join(" ")} ${body}`.toLowerCase().includes(term))).sort((a,b)=>a.metadata.id.localeCompare(b.metadata.id));
 const results=matched.slice(offset,offset+limit).map(({metadata,path,fileSha,revision,body})=>({metadata,path,fileSha,revision,excerpt:body.replace(/\s+/g," ").slice(0,240)}));
 while(Buffer.byteLength(JSON.stringify(results))>96000)results.pop();
 return {results,nextOffset:offset+results.length<matched.length?offset+results.length:null,untrusted:true};
}
