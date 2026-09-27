import type {Tool} from "@openai/agents";

export type ToolSecurityGate={authorize(input:{name:string;arguments:unknown}):Promise<void>};
export const allowAllToolSecurityGate:ToolSecurityGate={async authorize(){}};
export type RuntimeTool={name:string;execute(arguments_:unknown,callId?:string):Promise<string>;asAgentTool(execute:(arguments_:unknown,callId?:string)=>Promise<string>):Tool<unknown>};

export function registerAgentTools(tools:RuntimeTool[],gate:ToolSecurityGate=allowAllToolSecurityGate,maxCalls=4){
 let calls=0;
 return tools.map(definition=>definition.asAgentTool(async(arguments_,callId)=>{
  if(++calls>maxCalls)throw Object.assign(new Error("tool_limit"),{category:"provider_rejected",safeMessage:"The Agent exceeded the permitted tool-call limit.",retryable:false});
  await gate.authorize({name:definition.name,arguments:arguments_});
  return definition.execute(arguments_,callId);
 }));
}
