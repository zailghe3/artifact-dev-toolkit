import {canonicalJson} from "./workflow-definitions.ts";
import {workflowLayoutPath,workflowLayoutSchema,type WorkflowLayoutV1} from "./workflow-layout.ts";
import {DefinitionConflictError,DefinitionNotFoundError,type Versioned} from "./workflow-definition-repository.ts";

export interface WorkflowLayoutRepository{
 getLayout(workflowId:string):Promise<Versioned<WorkflowLayoutV1>|undefined>;
 createLayout(value:WorkflowLayoutV1):Promise<Versioned<WorkflowLayoutV1>>;
 updateLayout(value:WorkflowLayoutV1,fileSha:string):Promise<Versioned<WorkflowLayoutV1>>;
}

export class InMemoryWorkflowLayoutRepository implements WorkflowLayoutRepository{
 private layouts=new Map<string,Versioned<WorkflowLayoutV1>>();private revision=0;
 async getLayout(id:string){workflowLayoutPath(id);return structuredClone(this.layouts.get(id));}
 async createLayout(value:WorkflowLayoutV1){const parsed=workflowLayoutSchema.parse(value);if(this.layouts.has(parsed.workflowId))throw new DefinitionConflictError();const stored={definition:structuredClone(parsed),fileSha:`layout-sha-${++this.revision}`,sourcePath:workflowLayoutPath(parsed.workflowId)};this.layouts.set(parsed.workflowId,stored);return structuredClone(stored);}
 async updateLayout(value:WorkflowLayoutV1,fileSha:string){const parsed=workflowLayoutSchema.parse(value),old=this.layouts.get(parsed.workflowId);if(!old)throw new DefinitionNotFoundError();if(old.fileSha!==fileSha)throw new DefinitionConflictError();const stored={definition:structuredClone(parsed),fileSha:`layout-sha-${++this.revision}`,sourcePath:workflowLayoutPath(parsed.workflowId)};this.layouts.set(parsed.workflowId,stored);return structuredClone(stored);}
}

export class GitHubWorkflowLayoutRepository implements WorkflowLayoutRepository{
 private request:(path:string,init?:RequestInit)=>Promise<Response>;
 constructor(request:(path:string,init?:RequestInit)=>Promise<Response>){this.request=request;}
 async getLayout(workflowId:string){const path=workflowLayoutPath(workflowId),response=await this.request(`/contents/${path}`);if(response.status===404)return undefined;if(!response.ok)throw new Error("definition_repository_unavailable");const body=await response.json() as {content:string;sha:string};const definition=workflowLayoutSchema.parse(JSON.parse(Buffer.from(body.content.replace(/\s/g,""),"base64").toString("utf8")));if(definition.workflowId!==workflowId)throw new Error("invalid_json");return{definition,fileSha:body.sha,sourcePath:path};}
 private async put(value:WorkflowLayoutV1,sha?:string){const parsed=workflowLayoutSchema.parse(value),path=workflowLayoutPath(parsed.workflowId),response=await this.request(`/contents/${path}`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({message:`Update ${path}`,content:Buffer.from(canonicalJson(parsed)).toString("base64"),...(sha?{sha}:{})})});if(response.status===409||response.status===422)throw new DefinitionConflictError();if(!response.ok)throw new Error("definition_repository_unavailable");const body=await response.json() as {content?:{sha?:string}};return{definition:parsed,fileSha:body.content?.sha??"",sourcePath:path};}
 async createLayout(value:WorkflowLayoutV1){const parsed=workflowLayoutSchema.parse(value);if(await this.getLayout(parsed.workflowId))throw new DefinitionConflictError();return this.put(parsed);}
 async updateLayout(value:WorkflowLayoutV1,fileSha:string){const parsed=workflowLayoutSchema.parse(value),old=await this.getLayout(parsed.workflowId);if(!old)throw new DefinitionNotFoundError();if(old.fileSha!==fileSha)throw new DefinitionConflictError();return this.put(parsed,fileSha);}
}
