import {adrian,gateToolCallIds,type EventHandler,type InitOptions,type LlmEndData,type ToolCallRecord,type TokenUsage} from "@secureagentics/adrian";
import type {AgentInputItem,AgentOutputItem,ModelRequest,ModelResponse} from "@openai/agents";
import type {ModelTurnInstrumentation} from "./model-instrumentation.js";
import type {ToolSecurityContext,ToolSecurityGate} from "./tools.js";

export class AdrianToolDeniedError extends Error{readonly category="provider_rejected";readonly safeMessage="The tool call was blocked by the experimental security observer.";readonly retryable=false;constructor(){super("adrian_tool_denied")}}

function text(value:unknown){return typeof value==="string"?value:JSON.stringify(value??"")}
const SECRET_KEY=/(?:authorization|api[_-]?key|bearer|credential|ciphertext|wrapped[_-]?key|secret|token)$/i;
function safeValue(value:unknown):unknown{
 if(Array.isArray(value))return value.map(safeValue);
 if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).filter(([key])=>!SECRET_KEY.test(key)).map(([key,item])=>[key,safeValue(item)]));
 return value;
}
function safeText(value:unknown){if(typeof value!=="string")return text(safeValue(value));try{return text(safeValue(JSON.parse(value)))}catch{return value}}
function messages(request:ModelRequest){
 const result:Array<{role:string;content:string}>=[];
 if(request.systemInstructions)result.push({role:"system",content:request.systemInstructions});
 if(typeof request.input==="string")result.push({role:"user",content:request.input});
 else for(const item of request.input)result.push(message(item));
 return result;
}
function message(item:AgentInputItem){
 const value=item as unknown as Record<string,unknown>,role=typeof value.role==="string"?value.role:String(value.type??"unknown");
 return{role,content:text(value.content??value)};
}
function toolCall(item:AgentOutputItem):ToolCallRecord|null{
 const value=item as unknown as Record<string,unknown>;
 if(value.type!=="function_call"||typeof value.callId!=="string"||typeof value.name!=="string")return null;
 let args:Record<string,never>={};try{const parsed=typeof value.arguments==="string"?JSON.parse(value.arguments):value.arguments;if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))args=parsed as Record<string,never>}catch{}
 return{id:value.callId,name:value.name,args};
}
function outputText(output:AgentOutputItem[]){return output.flatMap(item=>{const value=item as unknown as Record<string,unknown>;if(value.type!=="message"||!Array.isArray(value.content))return[];return value.content.flatMap(part=>{const p=part as Record<string,unknown>;return typeof p.text==="string"?[p.text]:[]})}).join("\n")}
function usage(response:ModelResponse):TokenUsage{
 const value=response.usage as unknown as Record<string,unknown>;
 const prompt=Number(value.inputTokens??value.input_tokens??0),completion=Number(value.outputTokens??value.output_tokens??0);
 return{promptTokens:prompt,completionTokens:completion,totalTokens:Number(value.totalTokens??value.total_tokens??prompt+completion)};
}

/** Runtime-local spike adapter. Production execution never constructs this class by default. */
export class AdrianRuntimeIntegration implements ModelTurnInstrumentation,ToolSecurityGate{
 private readonly toolRuns=new WeakMap<ToolSecurityContext,string>();
 private constructor(private readonly handler:NonNullable<ReturnType<typeof adrian.getHandler>>,private readonly verdictTimeoutSeconds:number){}
 static async create(options:InitOptions&{verdictTimeoutSeconds?:number}){await adrian.init(options);const handler=adrian.getHandler();if(!handler)throw new Error("adrian_handler_unavailable");return new AdrianRuntimeIntegration(handler,options.verdictTimeoutSeconds??options.blockTimeout??30)}
 async modelTurnStarted({turnId,model,request}:{turnId:string;model:string;request:ModelRequest}){await this.handler.handleChatModelStart({name:model},[messages(request)],turnId,undefined,{metadata:{adt_turn_id:turnId}})}
 async modelTurnCompleted({turnId,response}:{turnId:string;model:string;response:ModelResponse}){const data:LlmEndData={output:outputText(response.output),toolCalls:response.output.map(toolCall).filter((call):call is ToolCallRecord=>call!==null),usage:usage(response)};await this.handler.handleLLMEnd(data,turnId)}
 async modelTurnFailed({turnId,error}:{turnId:string;model:string;error:unknown}){await this.handler.handleLLMError(error,turnId)}
 async authorize(input:ToolSecurityContext){
  const runId=`tool:${input.callId??crypto.randomUUID()}`;this.toolRuns.set(input,runId);await this.handler.handleToolStart({name:input.name},safeText(input.arguments),runId,undefined,{tool_call_id:input.callId});
  const verdict=await gateToolCallIds(input.callId?[input.callId]:[],adrian.getWebSocketClient(),this.verdictTimeoutSeconds);
  if(verdict.action==="block"){await this.handler.handleToolError(new AdrianToolDeniedError(),runId);throw new AdrianToolDeniedError()}
 }
 async completed(input:ToolSecurityContext,result:string){await this.handler.handleToolEnd(safeText(result),this.toolRuns.get(input)??`tool:${input.callId??"uncorrelated"}`);this.toolRuns.delete(input)}
 async failed(input:ToolSecurityContext,error:unknown){await this.handler.handleToolError(error,this.toolRuns.get(input)??`tool:${input.callId??"uncorrelated"}`);this.toolRuns.delete(input)}
 async shutdown(){await adrian.shutdown()}
}

export type {EventHandler};
