"use client";
import Link from "next/link";
import {useCallback,useEffect,useState} from "react";
import {buttonStyles} from "@/components/Ui";
import {knowledgeDocumentSchema,type KnowledgeDocument,type KnowledgeEntry} from "@/lib/advisor-knowledge";
import type {KnowledgeProposal} from "@/lib/advisor-knowledge-proposals";

type Summary=Omit<KnowledgeEntry,"body">&{excerpt:string};
const initialDocument=():KnowledgeDocument=>({metadata:{id:`knowledge-${crypto.randomUUID()}`,title:"",type:"finding",status:"active",tags:[],workflowIds:[],agentIds:[],runIds:[],related:[],supersedes:[],evidence:[]},body:""});
async function request<T>(url:string,body?:unknown):Promise<T>{
 const response=await fetch(url,body===undefined?{cache:"no-store"}:{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
 const value=await response.json() as T&{error?:string};if(!response.ok)throw Error(value.error??"Knowledge is unavailable.");return value;
}
export function AdvisorKnowledge({initialProposalId=""}:{initialProposalId?:string}){
 const [evidenceText,setEvidenceText]=useState("[]"),[entryId,setEntryId]=useState("");
 const [query,setQuery]=useState(""),[type,setType]=useState(""),[status,setStatus]=useState(""),[tags,setTags]=useState(""),[workflow,setWorkflow]=useState(""),[agent,setAgent]=useState("");
 const [results,setResults]=useState<Summary[]>([]),[nextOffset,setNextOffset]=useState<number|null>(null),[invalidCount,setInvalidCount]=useState(0),[proposals,setProposals]=useState<KnowledgeProposal[]>([]);
 const [document,setDocument]=useState<KnowledgeDocument>(initialDocument),[proposal,setProposal]=useState<KnowledgeProposal>(),[entry,setEntry]=useState<KnowledgeEntry>(),[expectedSha,setExpectedSha]=useState<string|null>(null),[editing,setEditing]=useState(false),[reviewToken,setReviewToken]=useState(""),[reviewed,setReviewed]=useState<KnowledgeProposal>(),[confirmed,setConfirmed]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const openProposal=useCallback((p:KnowledgeProposal)=>{setProposal(p);setDocument(p.document);setEvidenceText(JSON.stringify(p.document.metadata.evidence,null,2));setExpectedSha(p.expectedSha);setEditing(true);setEntry(undefined);setReviewToken("");setReviewed(undefined);setConfirmed(false);setError("");setMessage("")},[]);
 const refreshProposals=useCallback(async()=>{const value=await request<{proposals:KnowledgeProposal[]}>("/api/advisor/knowledge/proposals");setProposals(value.proposals);return value.proposals},[]);
 useEffect(()=>{let active=true;void request<{proposals:KnowledgeProposal[]}>("/api/advisor/knowledge/proposals").then(value=>{if(!active)return;setProposals(value.proposals);const p=value.proposals.find(p=>p.id===initialProposalId);if(p)openProposal(p);else if(initialProposalId)void request<KnowledgeProposal>(`/api/advisor/knowledge/proposals/${encodeURIComponent(initialProposalId)}`).then(item=>{if(active)openProposal(item)},()=>{if(active)setError("The selected proposal could not be loaded.")})}).catch(()=>{if(active)setError("Proposals could not be loaded.")});return()=>{active=false}},[initialProposalId,openProposal]);
 async function search(offset=0){
  setPending(true);setError("");try{
   const p=new URLSearchParams({query,offset:String(offset),limit:"10"});for(const [key,value] of [["type",type],["status",status],["tags",tags],["workflowId",workflow],["agentId",agent]])if(value)p.set(key,value);
   const value=await request<{results:Summary[];nextOffset:number|null;invalidCount:number}>(`/api/advisor/knowledge?${p}`);setResults(value.results);setNextOffset(value.nextOffset);setInvalidCount(value.invalidCount);setMessage(value.results.length?"":"No approved knowledge matched.");
  }catch(e){setError(e instanceof Error?e.message:"Search failed.")}finally{setPending(false)}
 }
 async function openEntry(id:string){setPending(true);setError("");try{const value=await request<KnowledgeEntry&{available:boolean}>(`/api/advisor/knowledge?id=${encodeURIComponent(id)}`);if(!value.available)throw Error("Knowledge entry not found.");setEntry(value);setEditing(false);setProposal(undefined);setReviewToken("");setReviewed(undefined);setMessage("")}catch(e){setError(e instanceof Error?e.message:"Entry could not be loaded.")}finally{setPending(false)}}
 function edit(value:KnowledgeDocument){setDocument(value);setReviewToken("");setReviewed(undefined);setConfirmed(false);setMessage("")}
 function startNew(){setDocument(initialDocument());setEvidenceText("[]");setProposal(undefined);setEntry(undefined);setExpectedSha(null);setEditing(true);setReviewToken("");setReviewed(undefined);setMessage("");setError("")}
 async function save(review=false){
  if(pending)return;setPending(true);setError("");setMessage("");setReviewToken("");setReviewed(undefined);
  try{
   const parsed=knowledgeDocumentSchema.safeParse({...document,metadata:{...document.metadata,evidence:JSON.parse(evidenceText)}});if(!parsed.success)throw Error("Enter a valid ID, title, type, status, references and Markdown body.");
   const now=new Date().toISOString();const saved=await request<KnowledgeProposal>("/api/advisor/knowledge/proposals",{document:{...parsed.data,metadata:{...parsed.data.metadata,createdAt:parsed.data.metadata.createdAt??now,updatedAt:now}},expectedSha,...(proposal?{id:proposal.id,revision:proposal.revision}:{})});setProposal(saved);setDocument(saved.document);
   if(review){const value=await request<{proposal:KnowledgeProposal;reviewToken:string}>(`/api/advisor/knowledge/proposals/${saved.id}`,{action:"review",revision:saved.revision});setReviewed(value.proposal);setReviewToken(value.reviewToken);setConfirmed(false)}else setMessage("Proposal saved. It is not published.");
   await refreshProposals();
  }catch(e){setError(e instanceof Error?e.message:"Proposal could not be saved.")}finally{setPending(false)}
 }
 async function publish(){
  if(pending||!confirmed||!reviewed||!reviewToken)return;setPending(true);setError("");
  try{const p=await request<KnowledgeProposal>(`/api/advisor/knowledge/proposals/${reviewed.id}`,{action:"publish",revision:reviewed.revision,reviewToken,confirmation:"publish"});setProposal(p);setMessage("Knowledge published to Git. Future authorised executions can retrieve it.");await refreshProposals()}
  catch(e){setError(e instanceof Error?e.message:"Publication outcome is uncertain. Inspect Git before continuing.");try{const values=await refreshProposals();const p=values.find(p=>p.id===reviewed.id);if(p)setProposal(p)}catch{setProposal({...reviewed,state:"uncertain"})}}
  finally{setReviewToken("");setReviewed(undefined);setConfirmed(false);setPending(false)}
 }
 const locked=pending||Boolean(proposal&&["publishing","published","uncertain"].includes(proposal.state));
 return <div className="mt-6 grid min-w-0 gap-6">
  <p>Approved knowledge lives in Git. Findings and recommendations may be uncertain; an accepted decision does not establish implementation or a verified outcome.</p>
  <form className="grid gap-3 sm:grid-cols-2" onSubmit={event=>{event.preventDefault();void search()}} aria-label="Search approved knowledge">
   <label>Search text<input className="adt-field" value={query} maxLength={120} onChange={e=>setQuery(e.target.value)}/></label>
   <label>Type<select className="adt-field" value={type} onChange={e=>setType(e.target.value)}><option value="">All types</option>{["decision","principle","finding","design"].map(v=><option key={v}>{v}</option>)}</select></label>
   <label>Status<select className="adt-field" value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{["active","resolved","superseded"].map(v=><option key={v}>{v}</option>)}</select></label>
   <label>Tags (comma separated)<input className="adt-field" value={tags} onChange={e=>setTags(e.target.value)}/></label>
   <label>Workflow ID<input className="adt-field" value={workflow} onChange={e=>setWorkflow(e.target.value)}/></label><label>Agent ID<input className="adt-field" value={agent} onChange={e=>setAgent(e.target.value)}/></label>
   <button className={buttonStyles.secondary} disabled={pending}>Search knowledge</button><button type="button" className={buttonStyles.secondary} disabled={pending} onClick={startNew}>Create knowledge</button>
  </form>
  <form className="flex flex-wrap items-end gap-3" aria-label="Open knowledge by ID" onSubmit={event=>{event.preventDefault();void openEntry(entryId)}}><label>Stable knowledge ID<input className="adt-field" value={entryId} maxLength={80} required pattern="[a-z0-9]+(-[a-z0-9]+)*" onChange={e=>setEntryId(e.target.value)}/></label><button className={buttonStyles.secondary} disabled={pending}>Open entry by ID</button></form>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{pending&&<p role="status">Working…</p>}
  {invalidCount>0&&<p role="status">{invalidCount} invalid Git entries were omitted. Validate the knowledge namespace before using them.</p>}
  <ul className="grid gap-3">{results.map(item=><li key={item.metadata.id} className="min-w-0 rounded border p-3"><button className="font-bold underline" disabled={pending} onClick={()=>void openEntry(item.metadata.id)}>{item.metadata.title}</button><p>{item.metadata.id} · {item.metadata.type} · {item.metadata.status}</p><p className="break-words">{item.excerpt}</p><p className="break-all text-sm">Git revision {item.revision}</p></li>)}</ul>
  {nextOffset!==null&&<button className={buttonStyles.secondary} disabled={pending} onClick={()=>void search(nextOffset)}>Next results</button>}
  <section aria-label="Your knowledge proposals"><h2 className="text-lg font-bold">Your proposals</h2>{proposals.length?<ul>{proposals.map(p=><li key={p.id}><button className="underline" disabled={pending} onClick={()=>openProposal(p)}>{p.document.metadata.title}</button> · {p.state}</li>)}</ul>:<p>No saved proposals.</p>}</section>
  {entry&&!editing&&<section className="min-w-0 rounded border p-4" aria-label="Approved knowledge entry"><h2 className="text-xl font-bold">{entry.metadata.title}</h2><p>{entry.metadata.type} · {entry.metadata.status}</p><p className="break-all">{entry.path} · {entry.fileSha}</p>{entry.sourceUrl&&<a className="underline" href={entry.sourceUrl} target="_blank" rel="noreferrer">Open Git revision</a>}<KnowledgeReferences document={entry} onKnowledge={openEntry}/><pre className="my-4 whitespace-pre-wrap break-words font-sans">{entry.body}</pre><button className={buttonStyles.secondary} disabled={pending} onClick={()=>{setDocument({metadata:entry.metadata,body:entry.body});setEvidenceText(JSON.stringify(entry.metadata.evidence,null,2));setExpectedSha(entry.fileSha);setProposal(undefined);setEditing(true)}}>Prepare update</button></section>}
  {editing&&<section className="min-w-0 rounded border p-4" aria-label="Edit knowledge proposal"><h2 className="text-xl font-bold">Review and edit proposal</h2><p>Review every claim and remove secrets or unnecessary execution content. Saving a draft never publishes it.</p><p>Enter the investigated Workflow and Agent IDs explicitly. Source Run IDs and evidence revisions record where the proposal came from.</p>{proposal&&<p>Proposal state: {proposal.state}</p>}{proposal&&["publishing","uncertain"].includes(proposal.state)&&<p role="alert">Publication needs inspection in Git. This proposal cannot be replayed. Open the current Git entry by ID before preparing a new update.</p>}
   <fieldset disabled={locked} className="mt-4 grid min-w-0 gap-3">
    <label>Stable ID<input className="adt-field" value={document.metadata.id} maxLength={80} disabled={expectedSha!==null} onChange={e=>edit({...document,metadata:{...document.metadata,id:e.target.value}})}/></label>
    <label>Title<input className="adt-field" value={document.metadata.title} maxLength={160} onChange={e=>edit({...document,metadata:{...document.metadata,title:e.target.value}})}/></label>
    <label>Knowledge type<select className="adt-field" value={document.metadata.type} onChange={e=>edit({...document,metadata:{...document.metadata,type:e.target.value as KnowledgeDocument["metadata"]["type"]}})}>{["decision","principle","finding","design"].map(v=><option key={v}>{v}</option>)}</select></label>
    <label>Lifecycle status<select className="adt-field" value={document.metadata.status} onChange={e=>edit({...document,metadata:{...document.metadata,status:e.target.value as KnowledgeDocument["metadata"]["status"]}})}>{["active","resolved","superseded"].map(v=><option key={v}>{v}</option>)}</select></label>
    <p className="text-sm">Active means current reviewed knowledge, resolved records a completed investigation or implementation, and superseded means replaced. Describe the actual evidence and outcome in the body.</p>
    {(["tags","workflowIds","agentIds","runIds","related","supersedes"] as const).map(key=><label key={key}>{({tags:"Knowledge tags",workflowIds:"Investigated Workflow IDs",agentIds:"Investigated Agent IDs",runIds:"Execution references",related:"Related knowledge IDs",supersedes:"Superseded knowledge IDs"})[key]} (comma separated)<input key={`${proposal?.id??"new"}:${proposal?.revision??0}:${key}`} className="adt-field" defaultValue={document.metadata[key].join(", ")} onChange={e=>edit({...document,metadata:{...document.metadata,[key]:e.target.value.split(",").map(s=>s.trim()).filter(Boolean)}})}/></label>)}
    <label>Markdown content<textarea className="adt-field min-h-64" maxLength={32768} value={document.body} onChange={e=>edit({...document,body:e.target.value})}/></label>
    <details><summary>Investigation provenance, evidence revisions and timestamps</summary><label>Evidence references (JSON)<textarea className="adt-field" value={evidenceText} onChange={e=>{setEvidenceText(e.target.value);setReviewToken("");setReviewed(undefined);setConfirmed(false)}}/></label><pre className="whitespace-pre-wrap break-words text-sm">{JSON.stringify({evidence:document.metadata.evidence,createdAt:document.metadata.createdAt,updatedAt:document.metadata.updatedAt},null,2)}</pre><button type="button" className="underline" onClick={()=>{setEvidenceText("[]");edit({...document,metadata:{...document.metadata,evidence:[]}})}}>Clear suggested evidence</button></details>
    <div className="flex flex-wrap gap-3"><button type="button" className={buttonStyles.secondary} onClick={()=>void save()}>Save draft</button><button type="button" className={buttonStyles.primary} onClick={()=>void save(true)}>Review publication</button></div>
   </fieldset>
   {reviewed&&reviewToken&&<section className="mt-5 grid min-w-0 gap-3 border-t pt-4" aria-label="Confirm knowledge publication"><h3 className="font-bold">Approve this exact Git publication</h3><p className="break-all">Target: advisor/knowledge/{reviewed.document.metadata.id}.md · {reviewed.expectedSha?`replace revision ${reviewed.expectedSha}`:"create new entry"}</p><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(reviewed.document.metadata,null,2)}{"\n\n"}{reviewed.document.body}</pre><label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={pending} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed the metadata and content and approve publishing this document to Git.</label><button type="button" className={buttonStyles.primary} disabled={pending||!confirmed} aria-busy={pending} onClick={()=>void publish()}>{pending?"Publishing…":"Approve and publish to Git"}</button></section>}
   {proposal?.state==="published"&&<button className="mt-3 underline" onClick={()=>void openEntry(proposal.document.metadata.id)}>Open published knowledge</button>}
  </section>}
 </div>;
}
function KnowledgeReferences({document,onKnowledge}:{document:KnowledgeDocument;onKnowledge:(id:string)=>Promise<void>}){
 return <div className="mt-3 flex flex-wrap gap-3 text-sm">{document.metadata.workflowIds.map(id=><Link className="underline" key={id} href={`/workflows/definitions/${id}`}>Workflow {id}</Link>)}{document.metadata.agentIds.map(id=><Link className="underline" key={id} href={`/workflows/agents/${id}`}>Agent {id}</Link>)}{document.metadata.runIds.map(id=><Link className="underline" key={id} href={`/workflows/runs/${id}`}>Execution {id}</Link>)}{[...new Set([...document.metadata.related,...document.metadata.supersedes])].map(id=><button className="underline" key={id} onClick={()=>void onKnowledge(id)}>Knowledge {id}</button>)}</div>;
}
