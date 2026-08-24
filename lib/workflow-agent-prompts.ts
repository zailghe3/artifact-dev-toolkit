import type {Artifact} from "./artifacts.ts";
import {searchArtifacts} from "./search.ts";
import {AGENT_MASTER_PROMPT_MAX_LENGTH,type AgentPrompt} from "./workflow-definitions.ts";
export type WorkflowAgentPromptDescriptor={id:string;title:string;description:string;tags:string[];excerpt:string};
export type WorkflowAgentPromptSummary=WorkflowAgentPromptDescriptor;
export function workflowAgentPromptDescriptor(artifact:Artifact|undefined):WorkflowAgentPromptDescriptor|undefined{if(!artifact||artifact.type!=="prompt")return undefined;const {id,title,description,tags,excerpt}=artifact;return {id,title,description,tags,excerpt};}
export function workflowAgentPromptSelection(prompt:Pick<WorkflowAgentPromptDescriptor,"id">|undefined):AgentPrompt{return prompt?{source:"artifact",artifactId:prompt.id}:{source:"custom",text:""};}
export function copiedWorkflowAgentPrompt(value:unknown):AgentPrompt|undefined{if(!value||typeof value!=="object")return undefined;const root=value as Record<string,unknown>,candidate=root.artifact&&typeof root.artifact==="object"?root.artifact as Record<string,unknown>:root,body=candidate.body;if(candidate.type!=="prompt"||typeof body!=="string"||body.length>AGENT_MASTER_PROMPT_MAX_LENGTH)return undefined;return {source:"custom",text:body};}
export type WorkflowAgentPromptKeyAction={type:"move";index:number}|{type:"choose";index:number}|{type:"close"};
export function workflowAgentPromptKeyAction(key:string,active:number,count:number,open:boolean):WorkflowAgentPromptKeyAction|undefined{if(key==="ArrowDown")return {type:"move",index:Math.min(active+1,count-1)};if(key==="ArrowUp")return {type:"move",index:Math.max(active-1,0)};if(key==="Enter"&&open)return {type:"choose",index:active};if(key==="Escape")return {type:"close"};return undefined;}
export function searchWorkflowAgentPrompts(artifacts:Artifact[],query:string,limit=15):WorkflowAgentPromptSummary[]{return searchArtifacts(artifacts.filter(artifact=>artifact.type==="prompt"),query).sort((a,b)=>a.title.localeCompare(b.title)).slice(0,limit).map(({id,title,description,tags,excerpt})=>({id,title,description,tags,excerpt}));}
