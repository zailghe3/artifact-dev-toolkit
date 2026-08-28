import type {WorkflowDefinitionV2} from "./workflow-definitions.ts";
import type {WorkflowLayoutV1} from "./workflow-layout.ts";

type Fetcher=(input:string,init:RequestInit)=>Promise<Response>;

export async function persistWorkflowSemantics(fetcher:Fetcher,definition:WorkflowDefinitionV2,fileSha?:string){
 const existing=Boolean(fileSha),response=await fetcher(existing?`/api/workflow-definitions/${definition.id}`:"/api/workflow-definitions",{method:existing?"PUT":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(existing?{definition,fileSha}:definition)}),body=await response.json() as {fileSha?:string;error?:string};
 if(!response.ok||!body.fileSha)throw new Error(body.error??"Workflow could not be saved.");return body.fileSha;
}

export async function persistWorkflowLayout(fetcher:Fetcher,layout:WorkflowLayoutV1,fileSha?:string){
 const response=await fetcher(`/api/workflow-definitions/${layout.workflowId}/layout`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({layout,...(fileSha?{fileSha}:{})})}),body=await response.json() as {fileSha?:string;error?:string};
 if(!response.ok||!body.fileSha)throw new Error(body.error??"Layout could not be saved.");return body.fileSha;
}
