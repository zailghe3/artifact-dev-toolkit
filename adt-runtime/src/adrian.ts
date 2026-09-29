import {adrian,gateToolCallIds,shouldHalt,type EventHandler,type InitOptions,type LlmEndData,type ToolCallRecord,type TokenUsage,type WebSocketClient} from "@secureagentics/adrian";
import type {AgentInputItem,AgentOutputItem,ModelRequest,ModelResponse} from "@openai/agents";
import type {ModelTurnInstrumentation} from "./model-instrumentation.js";
import type {SecurityDecision,ToolSecurityContext,ToolSecurityGate} from "./tools.js";

export class AdrianExecutionLeaseUnavailableError extends Error{readonly category="security_unavailable";readonly safeMessage="Security enforcement is temporarily unavailable.";readonly retryable=false;constructor(){super("adrian_execution_lease_unavailable")}}
export class SecurityDecisionError extends Error{readonly retryable=false;readonly category;readonly safeMessage;constructor(readonly outcome:Exclude<SecurityDecision["outcome"],"allow">){const category=outcome==="deny"?"security_denied":`security_${outcome}`;super(category);this.category=category;this.safeMessage=outcome==="deny"?"The tool call was denied by the security policy.":outcome==="timeout"?"The security decision timed out.":"Security enforcement is unavailable."}}

let leaseHeld=false;
export function acquireAdrianExecutionLease(){if(leaseHeld)throw new AdrianExecutionLeaseUnavailableError();leaseHeld=true;let released=false;return()=>{if(!released){released=true;leaseHeld=false}}}
export async function withAdrianExecutionLease<T>(operation:()=>Promise<T>,shutdown:()=>Promise<void>=()=>adrian.shutdown()){const release=acquireAdrianExecutionLease();try{return await operation()}finally{try{await shutdown()}catch{/* Shutdown is best-effort and cannot replace an established outcome. */}release()}}

/** Uses only exact-call lower-level verdict evidence. The SDK's fail-open gate is intentionally not consulted. */
export async function evaluateAdrianToolCall(client:Pick<WebSocketClient,"loginAcked"|"policyActive"|"waitForToolCallVerdict">|null,callId:string|undefined,timeoutMs:number):Promise<SecurityDecision>{const started=Date.now();if(!client||!callId||!client.loginAcked()||!client.policyActive())return{outcome:"unavailable",elapsedMs:Date.now()-started};try{const verdict=await client.waitForToolCallVerdict(callId,timeoutMs/1000);const elapsedMs=Date.now()-started;if(verdict)return{outcome:shouldHalt(verdict)?"deny":"allow",elapsedMs};return{outcome:"unavailable",elapsedMs}}catch{return{outcome:"unavailable",elapsedMs:Date.now()-started}}}

export class ProductionAdrianSecurityGate implements ToolSecurityGate,ModelTurnInstrumentation{
 private readonly toolRuns=new WeakMap<ToolSecurityContext,string>();
 private terminalFailure:SecurityDecisionError|undefined;
 constructor(private handler:NonNullable<ReturnType<typeof adrian.getHandler>>,private client:WebSocketClient,private timeoutMs:number,private diagnostic?:(decision:SecurityDecision)=>void){}
 async modelTurnStarted({turnId,model,request}:{turnId:string;model:string;request:ModelRequest}){try{await this.handler.handleChatModelStart({name:model},[messages(request)],turnId,undefined,{metadata:{adt_turn_id:turnId}})}catch{throw new AdrianExecutionLeaseUnavailableError()}}
 async modelTurnCompleted({turnId,response}:{turnId:string;model:string;response:ModelResponse}){const data:LlmEndData={output:outputText(response.output),toolCalls:response.output.map(toolCall).filter((call):call is ToolCallRecord=>call!==null),usage:usage(response)};try{await this.handler.handleLLMEnd(data,turnId)}catch{throw new AdrianExecutionLeaseUnavailableError()}}
 async modelTurnFailed({turnId}:{turnId:string;model:string;error:unknown}){await this.handler.handleLLMError(safeError("model"),turnId)}
 async authorize(input:ToolSecurityContext){const runId=`tool:${input.callId??crypto.randomUUID()}`;this.toolRuns.set(input,runId);try{await this.handler.handleToolStart({name:input.name},safeText(input.arguments),runId,undefined,{tool_call_id:input.callId})}catch{this.toolRuns.delete(input);throw new AdrianExecutionLeaseUnavailableError()}const decision=await evaluateAdrianToolCall(this.client,input.callId,this.timeoutMs);this.diagnostic?.(decision);if(decision.outcome!=="allow"){try{await this.handler.handleToolError(safeError("tool"),runId)}catch{}this.toolRuns.delete(input);this.terminalFailure=new SecurityDecisionError(decision.outcome);throw this.terminalFailure}}
 assertNoFailure(){if(this.terminalFailure)throw this.terminalFailure}
 async completed(input:ToolSecurityContext,result:string){await this.handler.handleToolEnd(safeText(result),this.toolRuns.get(input)??`tool:${input.callId??"uncorrelated"}`);this.toolRuns.delete(input)}
 async failed(input:ToolSecurityContext){await this.handler.handleToolError(safeError("tool"),this.toolRuns.get(input)??`tool:${input.callId??"uncorrelated"}`);this.toolRuns.delete(input)}
}

export class AdrianToolDeniedError extends Error{readonly category="provider_rejected";readonly safeMessage="The tool call was blocked by the experimental security observer.";readonly retryable=false;constructor(){super("adrian_tool_denied")}}

function text(value:unknown){return typeof value==="string"?value:JSON.stringify(value??"")}
function secretKey(key:string){const value=key.replace(/[^a-z0-9]/gi,"").toLowerCase();return value==="authorization"||value.endsWith("authority")||value.includes("credential")||value.includes("secret")||value==="token"||value.endsWith("accesstoken")||value.endsWith("bearertoken")||value.endsWith("apikey")||value==="ciphertext"||value==="wrappedkey"}
function safeValue(value:unknown):unknown{
 if(Array.isArray(value))return value.map(safeValue);
 if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).filter(([key])=>!secretKey(key)).map(([key,item])=>[key,safeValue(item)]));
 if(typeof value==="string")try{const parsed=JSON.parse(value);if(parsed&&typeof parsed==="object")return JSON.stringify(safeValue(parsed))}catch{}
 return value;
}
function safeText(value:unknown){if(typeof value!=="string")return text(safeValue(value));try{return text(safeValue(JSON.parse(value)))}catch{return value}}
function safeError(kind:"model"|"tool"){const error=new Error(`ADT Runtime ${kind} operation failed.`);error.name="AdrianObservedError";error.stack=undefined;return error}
function messages(request:ModelRequest){
 const result:Array<{role:string;content:string}>=[];
 if(request.systemInstructions)result.push({role:"system",content:safeText(request.systemInstructions)});
 if(typeof request.input==="string")result.push({role:"user",content:safeText(request.input)});
 else for(const item of request.input)result.push(message(item));
 return result;
}
function message(item:AgentInputItem){
 const value=item as unknown as Record<string,unknown>,role=typeof value.role==="string"?value.role:String(value.type??"unknown");
 return{role,content:safeText(value.content??value)};
}
function toolCall(item:AgentOutputItem):ToolCallRecord|null{
 const value=item as unknown as Record<string,unknown>;
 if(value.type!=="function_call"||typeof value.callId!=="string"||typeof value.name!=="string")return null;
 let args:Record<string,never>={};try{const parsed=typeof value.arguments==="string"?JSON.parse(value.arguments):value.arguments;if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))args=parsed as Record<string,never>}catch{}
 return{id:value.callId,name:value.name,args:safeValue(args) as ToolCallRecord["args"]};
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
 async modelTurnFailed({turnId}:{turnId:string;model:string;error:unknown}){await this.handler.handleLLMError(safeError("model"),turnId)}
 async authorize(input:ToolSecurityContext){
  const runId=`tool:${input.callId??crypto.randomUUID()}`;this.toolRuns.set(input,runId);await this.handler.handleToolStart({name:input.name},safeText(input.arguments),runId,undefined,{tool_call_id:input.callId});
  const verdict=await gateToolCallIds(input.callId?[input.callId]:[],adrian.getWebSocketClient(),this.verdictTimeoutSeconds);
  if(verdict.action==="block"){const blocked=new AdrianToolDeniedError();try{await this.handler.handleToolError(safeError("tool"),runId)}catch{}this.toolRuns.delete(input);throw blocked}
 }
 async completed(input:ToolSecurityContext,result:string){await this.handler.handleToolEnd(safeText(result),this.toolRuns.get(input)??`tool:${input.callId??"uncorrelated"}`);this.toolRuns.delete(input)}
 async failed(input:ToolSecurityContext,_error:unknown){await this.handler.handleToolError(safeError("tool"),this.toolRuns.get(input)??`tool:${input.callId??"uncorrelated"}`);this.toolRuns.delete(input)}
 async shutdown(){await adrian.shutdown()}
}

export type {EventHandler};
