import type {Tool} from "@openai/agents";

export type ToolSecurityContext={name:string;arguments:unknown;callId?:string};
export type ToolSecurityGate={authorize(input:ToolSecurityContext):Promise<void>;completed?(input:ToolSecurityContext,result:string):Promise<void>;failed?(input:ToolSecurityContext,error:unknown):Promise<void>};
export const allowAllToolSecurityGate:ToolSecurityGate={async authorize(){}};
export type RuntimeTool={name:string;execute(arguments_:unknown,callId?:string):Promise<string>;asAgentTool(execute:(arguments_:unknown,callId?:string)=>Promise<string>):Tool<unknown>};

async function report(callback:(()=>Promise<void>)|undefined){if(!callback)return;try{await callback()}catch{/* Post-execution observers cannot change an established tool outcome. */}}

export async function executeToolWithSecurityGate(definition:Pick<RuntimeTool,"name"|"execute">,gate:ToolSecurityGate,arguments_:unknown,callId?:string){
 const context={name:definition.name,arguments:arguments_,...(callId?{callId}:{})};
 await gate.authorize(context);
 let result:string;
 try{result=await definition.execute(arguments_,callId)}catch(error){await report(gate.failed?()=>gate.failed!(context,error):undefined);throw error}
 await report(gate.completed?()=>gate.completed!(context,result):undefined);return result;
}

export function registerAgentTools(tools:RuntimeTool[],gate:ToolSecurityGate=allowAllToolSecurityGate,maxCalls=4){
 let calls=0;
 return tools.map(definition=>definition.asAgentTool(async(arguments_,callId)=>{
  if(++calls>maxCalls)throw Object.assign(new Error("tool_limit"),{category:"provider_rejected",safeMessage:"The Agent exceeded the permitted tool-call limit.",retryable:false});
  return executeToolWithSecurityGate(definition,gate,arguments_,callId);
 }));
}
