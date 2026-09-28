import type {Tool} from "@openai/agents";

export type ToolSecurityContext={name:string;arguments:unknown;callId?:string};
export type ToolSecurityGate={authorize(input:ToolSecurityContext):Promise<void>;completed?(input:ToolSecurityContext,result:string):Promise<void>;failed?(input:ToolSecurityContext,error:unknown):Promise<void>};
export const allowAllToolSecurityGate:ToolSecurityGate={async authorize(){}};
export type RuntimeTool={name:string;execute(arguments_:unknown,callId?:string):Promise<string>;asAgentTool(execute:(arguments_:unknown,callId?:string)=>Promise<string>):Tool<unknown>};

export function registerAgentTools(tools:RuntimeTool[],gate:ToolSecurityGate=allowAllToolSecurityGate,maxCalls=4){
 let calls=0;
 return tools.map(definition=>definition.asAgentTool(async(arguments_,callId)=>{
  if(++calls>maxCalls)throw Object.assign(new Error("tool_limit"),{category:"provider_rejected",safeMessage:"The Agent exceeded the permitted tool-call limit.",retryable:false});
  const context={name:definition.name,arguments:arguments_,...(callId?{callId}:{})};
  await gate.authorize(context);
  let result:string;try{result=await definition.execute(arguments_,callId)}catch(error){await gate.failed?.(context,error);throw error}
  await gate.completed?.(context,result);return result;
 }));
}
