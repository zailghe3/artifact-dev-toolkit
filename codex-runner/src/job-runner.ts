import {createHash,randomBytes} from "node:crypto";
import {readFile,readdir,rename,writeFile} from "node:fs/promises";
import {join} from "node:path";
import type {AppServerClient} from "./app-server-client.js";
import type {RunnerEnvironment} from "./environments.js";
import {ensureStateDirectory} from "./environments.js";
import {SafeError} from "./errors.js";

export type JobFailureReason="authentication_failed"|"runner_restarted"|"thread_start_failed"|"turn_start_failed"|"turn_failed"|"interaction_required"|"output_too_large"|"internal_error";
export interface CodexJobStartInput{idempotencyKey:string;environmentKey:string;prompt:string;model?:string;reasoningEffort?:string}
export type CodexJobStatus={jobId:string;state:"queued"|"running"}|{jobId:string;state:"completed";outputText:string}|{jobId:string;state:"failed";reason:JobFailureReason}|{jobId:string;state:"cancelled"};
type RecordState="queued"|"running"|"cancelling"|"completed"|"failed"|"cancelled";
type JobRecord={schemaVersion:1;jobId:string;idempotencyDigest:string;fingerprint:string;environmentKey:string;state:RecordState;outputText?:string;reason?:JobFailureReason;threadId?:string;turnId?:string;createdAt:string;updatedAt:string};
const JOB_ID=/^[a-f0-9]{48}$/,DIGEST=/^[a-f0-9]{64}$/;
const digest=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");
export const idempotencyDigest=digest;
export class PersistentCodexJobRunner{
 private records=new Map<string,JobRecord>();private byDigest=new Map<string,string>();private activeJob?:string;
 private constructor(private readonly app:AppServerClient,private readonly environments:RunnerEnvironment[],private readonly stateDirectory:string){}
 static async create(app:AppServerClient,environments:RunnerEnvironment[],stateDirectory:string){const value=new PersistentCodexJobRunner(app,environments,stateDirectory);await ensureStateDirectory(stateDirectory);await value.load();return value}
 private path(id:string){return join(this.stateDirectory,`${id}.json`)}
 private async persist(record:JobRecord){record.updatedAt=new Date().toISOString();const path=this.path(record.jobId),temp=`${path}.${randomBytes(8).toString("hex")}.tmp`,body=JSON.stringify(record);if(Buffer.byteLength(body)>300_000)throw new Error("job_state_too_large");await writeFile(temp,body,{mode:0o600,flag:"wx"});await rename(temp,path)}
 private async load(){for(const file of await readdir(this.stateDirectory)){if(!/^[a-f0-9]{48}\.json$/.test(file))continue;try{const raw=await readFile(join(this.stateDirectory,file),"utf8");if(Buffer.byteLength(raw)>300_000)continue;const value=JSON.parse(raw) as JobRecord;if(value.schemaVersion!==1||!JOB_ID.test(value.jobId)||!DIGEST.test(value.idempotencyDigest)||!DIGEST.test(value.fingerprint))continue;if(["queued","running","cancelling"].includes(value.state)){value.state="failed";value.reason="runner_restarted";delete value.threadId;delete value.turnId;await this.persist(value)}this.records.set(value.jobId,value);this.byDigest.set(value.idempotencyDigest,value.jobId)}catch{/* Invalid state is ignored without exposing its contents. */}}
 }
 private public(value:JobRecord):CodexJobStatus{if(value.state==="completed")return{jobId:value.jobId,state:"completed",outputText:value.outputText??""};if(value.state==="failed")return{jobId:value.jobId,state:"failed",reason:value.reason??"internal_error"};if(value.state==="cancelled")return{jobId:value.jobId,state:"cancelled"};return{jobId:value.jobId,state:value.state==="queued"?"queued":"running"}}
 lookup(token:string){if(!DIGEST.test(token))throw new SafeError("invalid_request",400);const id=this.byDigest.get(token);return id?this.public(this.records.get(id)!):undefined}
 get(jobId:string){if(!JOB_ID.test(jobId)||!this.records.has(jobId))throw new SafeError("not_found",404);return this.public(this.records.get(jobId)!)}
 async start(input:CodexJobStartInput){
  const environment=this.environments.find(item=>item.key===input.environmentKey);if(!environment)throw new SafeError("unknown_environment",400);if(!environment.enabled)throw new SafeError("environment_disabled",409);if(!environment.ready)throw new SafeError("environment_not_ready",409);
  const idem=digest(input.idempotencyKey),fingerprint=digest([input.environmentKey,input.prompt,input.model??"<default>",input.reasoningEffort??"<default>"].join("\0")),existingId=this.byDigest.get(idem);if(existingId){const existing=this.records.get(existingId)!;if(existing.fingerprint!==fingerprint)throw new SafeError("idempotency_conflict",409);return this.public(existing)}
  if(this.activeJob)throw new SafeError("runner_busy",409);
  const status=await this.app.status() as {account?:unknown};if(!status||!status.account)throw new SafeError("authentication_failed",401);
  if(!this.app.listModels||!this.app.runWorkflowTurn)throw new SafeError("configuration_unavailable",503);const models=await this.app.listModels(),selected=input.model?models.find(item=>item.id===input.model):models.find(item=>item.isDefault);if(input.model&&!selected)throw new SafeError("unknown_model",400);if(input.reasoningEffort&&(!selected||!selected.supportedReasoningEfforts.some(item=>item.reasoningEffort===input.reasoningEffort)))throw new SafeError("unsupported_reasoning_effort",400);
  const now=new Date().toISOString(),record:JobRecord={schemaVersion:1,jobId:randomBytes(24).toString("hex"),idempotencyDigest:idem,fingerprint,environmentKey:input.environmentKey,state:"queued",createdAt:now,updatedAt:now};this.records.set(record.jobId,record);this.byDigest.set(idem,record.jobId);this.activeJob=record.jobId;await this.persist(record);void this.execute(record,environment,input,input.model?selected?.threadModel:undefined);return this.public(record)
 }
 private async execute(record:JobRecord,environment:RunnerEnvironment,input:CodexJobStartInput,threadModel?:string){try{record.state="running";await this.persist(record);const result=await this.app.runWorkflowTurn!({cwd:environment.cwd,sandbox:environment.sandbox,prompt:input.prompt,...(threadModel?{model:threadModel}:{}),...(input.reasoningEffort?{reasoningEffort:input.reasoningEffort}:{}),onStarted:(threadId,turnId)=>{record.threadId=threadId;record.turnId=turnId;void this.persist(record)}});if(["cancelling","cancelled"].includes((record as JobRecord).state)){record.state="cancelled"}else if(result.ok){record.state="completed";record.outputText=result.outputText}else{record.state="failed";record.reason=result.reason}await this.persist(record)}catch{record.state="failed";record.reason="internal_error";await this.persist(record).catch(()=>{})}finally{if(this.activeJob===record.jobId)this.activeJob=undefined}}
 async cancel(jobId:string){if(!JOB_ID.test(jobId)||!this.records.has(jobId))throw new SafeError("not_found",404);const record=this.records.get(jobId)!;if(["completed","failed","cancelled"].includes(record.state))return this.public(record);record.state="cancelling";await this.persist(record);if(record.threadId&&record.turnId)await this.app.interruptWorkflowTurn?.(record.threadId,record.turnId);record.state="cancelled";await this.persist(record);if(this.activeJob===record.jobId)this.activeJob=undefined;return this.public(record)}
}
