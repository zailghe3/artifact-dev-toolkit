import {mkdir,readFile,rename,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {randomBytes} from "node:crypto";

export interface EmergencyState{emergencyStopped:boolean;stoppedGeneration?:string;updatedAt:string;hardRestart:{attempted:boolean;succeeded:boolean;reason?:"not_configured"|"request_failed"}}
export class EmergencyStopController{
 private state:EmergencyState={emergencyStopped:false,updatedAt:new Date(0).toISOString(),hardRestart:{attempted:false,succeeded:false}};
 private constructor(private directory:string,private webhook?:string){}
 static async create(directory:string,webhook?:string){const value=new EmergencyStopController(directory,webhook);await mkdir(directory,{recursive:true,mode:0o700});try{const parsed=JSON.parse(await readFile(join(directory,"control.json"),"utf8"));if(typeof parsed.emergencyStopped!=="boolean")throw new Error();value.state=parsed}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw new Error("control_state_untrusted")}return value}
 snapshot(){return structuredClone(this.state)}
 private async persist(next:EmergencyState){const target=join(this.directory,"control.json"),temp=`${target}.${randomBytes(8).toString("hex")}.tmp`;await writeFile(temp,JSON.stringify(next),{mode:0o600,flag:"wx"});await rename(temp,target);this.state=next}
 async latch(generation?:string){await this.persist({emergencyStopped:true,...(generation?{stoppedGeneration:generation}:{}),updatedAt:new Date().toISOString(),hardRestart:{attempted:false,succeeded:false}});return this.snapshot()}
 async triggerHardRestart(){let hardRestart:EmergencyState["hardRestart"]={attempted:false,succeeded:false,reason:"not_configured"};if(this.webhook){try{const response=await fetch(new URL(this.webhook),{method:"POST",redirect:"manual",signal:AbortSignal.timeout(10_000)});hardRestart={attempted:true,succeeded:response.status>=200&&response.status<300};if(!hardRestart.succeeded)hardRestart.reason="request_failed"}catch{hardRestart={attempted:true,succeeded:false,reason:"request_failed"}}}await this.persist({...this.state,hardRestart,updatedAt:new Date().toISOString()});return this.snapshot()}
 async stop(generation:string|undefined,interrupt:()=>Promise<void>){await this.latch(generation);await interrupt().catch(()=>{});return this.triggerHardRestart()}
 async resume(currentGeneration:string|undefined,idle:boolean){if(!this.state.emergencyStopped)return this.snapshot();if(!currentGeneration||!idle||(this.state.stoppedGeneration&&currentGeneration===this.state.stoppedGeneration))throw new Error("unsafe_resume");await this.persist({emergencyStopped:false,updatedAt:new Date().toISOString(),hardRestart:this.state.hardRestart});return this.snapshot()}
}
