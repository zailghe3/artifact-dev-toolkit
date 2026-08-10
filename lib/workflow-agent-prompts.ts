import type {Artifact} from "./artifacts.ts";
import {searchArtifacts} from "./search.ts";
export type WorkflowAgentPromptDescriptor={id:string;title:string;description:string;status:"production"|"draft"|"archived";tags:string[];excerpt:string};
export type WorkflowAgentPromptSummary=WorkflowAgentPromptDescriptor&{status:"production"|"draft"};
export function searchWorkflowAgentPrompts(artifacts:Artifact[],query:string,limit=15):WorkflowAgentPromptSummary[]{return searchArtifacts(artifacts.filter((artifact):artifact is Artifact&{status:"production"|"draft"}=>artifact.type==="prompt"&&artifact.status!=="archived"),query).sort((a,b)=>(a.status==="production"?0:1)-(b.status==="production"?0:1)||a.title.localeCompare(b.title)).slice(0,limit).map(({id,title,description,status,tags,excerpt})=>({id,title,description,status,tags,excerpt}));}
