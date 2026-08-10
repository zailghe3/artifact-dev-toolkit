export interface CodexJobStartInput { prompt:string }
export interface CodexJobStartResult { jobId:string }
export interface CodexJobStatus { jobId:string;state:"queued"|"running"|"failed"|"completed" }
export interface CodexJobCancellation { jobId:string;cancelled:boolean }
export interface CodexJobRunner {start(input:CodexJobStartInput):Promise<CodexJobStartResult>;get(jobId:string):Promise<CodexJobStatus>;cancel(jobId:string):Promise<CodexJobCancellation>}
export class UnavailableCodexJobRunner implements CodexJobRunner{private unavailable():never{throw new Error("job_execution_not_implemented")}start():Promise<CodexJobStartResult>{return this.unavailable()}get():Promise<CodexJobStatus>{return this.unavailable()}cancel():Promise<CodexJobCancellation>{return this.unavailable()}}
