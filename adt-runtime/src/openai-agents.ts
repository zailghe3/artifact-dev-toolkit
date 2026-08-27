import {Agent,MaxTurnsExceededError,ModelBehaviorError,ModelRefusalError,ModelTimeoutError,OpenAIProvider,Runner,UserError,tool,type ModelProvider,type ModelSettings} from "@openai/agents";
import {z} from "zod";
import OpenAI from "openai";
import type {ExecutionRequest} from "./protocol.js";

export const MAX_TURNS=6, MAX_TOOL_CALLS=4, MODEL_TIMEOUT_MS=30_000, MAX_OUTPUT_BYTES=262_144,MAX_TOOL_RESULT_BYTES=128_000;
export type SafeFailure={category:string;safeMessage:string;retryable:false};
export class RuntimeFailure extends Error implements SafeFailure{readonly retryable=false as const;constructor(readonly category:string,readonly safeMessage:string){super(category)}}
const fail=(category:string,safeMessage:string)=>new RuntimeFailure(category,safeMessage);
function classify(error:unknown){
 if(error instanceof MaxTurnsExceededError)return fail("provider_rejected","The model exceeded the permitted execution turns.");
 if(error instanceof ModelTimeoutError)return fail("provider_timeout","The model request timed out.");
 if(error instanceof ModelRefusalError)return fail("provider_rejected","The model refused the request.");
 if(error instanceof ModelBehaviorError)return fail("malformed_response","The model returned an invalid response.");
 if(error instanceof UserError)return fail("configuration_invalid","The Agents runtime configuration is invalid.");
 const status=error&&typeof error==="object"&&"status" in error&&typeof error.status==="number"?error.status:undefined;
 if(status===401)return fail("authentication_failed","Authentication failed.");if(status===403)return fail("permission_denied","Permission denied.");if(status===429)return fail("rate_limited","Provider rate limited.");if(status&&status>=500)return fail("provider_unavailable","Provider temporarily unavailable.");if(status&&status>=400)return fail("provider_rejected","Configured model was rejected.");
 return fail("internal_error","The Agents runtime failed unexpectedly.");
}
export type Factories={client:(c:{apiKey:string;maxRetries:0})=>OpenAI;provider:(c:{openAIClient:OpenAI;useResponses:true})=>ModelProvider&{close?:()=>Promise<void>};runner:(c:{modelProvider:ModelProvider;tracingDisabled:true})=>Pick<Runner,"run">;agent:(c:{name:string;instructions:string;model:string;modelSettings:ModelSettings;tools?:any[]})=>Agent<unknown,"text">;fetcher:typeof fetch};
const defaults:Factories={client:c=>new OpenAI(c),provider:c=>new OpenAIProvider(c),runner:c=>new Runner(c),agent:c=>new Agent(c),fetcher:fetch};
export async function executeOpenAIAgents(request:ExecutionRequest,credential:string,overrides:Partial<Factories>={}){
 const f={...defaults,...overrides},client=f.client({apiKey:credential,maxRetries:0}),provider=f.provider({openAIClient:client,useResponses:true}),runner=f.runner({modelProvider:provider,tracingDisabled:true});
 const o=request.options,modelSettings:ModelSettings={store:false,parallelToolCalls:false,timeoutMs:MODEL_TIMEOUT_MS,...(o.maxOutputTokens?{maxTokens:o.maxOutputTokens}:{}),...(o.reasoningEffort?{reasoning:{effort:o.reasoningEffort}}:{}),...(o.verbosity?{text:{verbosity:o.verbosity}}:{})};
 let toolCalls=0;const tools=(request.tools??[]).length?[tool({name:"artifact_search",description:"Search the authorised ADT Artifact Library.",parameters:z.object({query:z.string().min(1).max(500),limit:z.number().int().min(1).max(10).optional()}).strict(),execute:async args=>{if(++toolCalls>MAX_TOOL_CALLS)throw fail("provider_rejected","The Agent exceeded the permitted tool-call limit.");const response=await f.fetcher(request.toolGateway!.url,{method:"POST",headers:{authorization:`Bearer ${request.toolGateway!.authority}`,"content-type":"application/json"},body:JSON.stringify({runId:request.idempotencyKey.split(":",1)[0],tool:"artifact_search",arguments:args})});const value=await response.text();if(!response.ok||Buffer.byteLength(value,"utf8")>MAX_TOOL_RESULT_BYTES)throw fail("provider_rejected","Artifact search failed safely.");return value;}})]:[];
 const agent=f.agent({name:request.agentName,instructions:request.instructions,model:request.model,modelSettings,tools});
 try{const result=await runner.run(agent,request.input,{maxTurns:MAX_TURNS});if(typeof result.finalOutput!=="string")throw fail("malformed_response","The Agents runtime returned no textual output.");if(Buffer.byteLength(result.finalOutput,"utf8")>MAX_OUTPUT_BYTES)throw fail("output_too_large","The Agents runtime output exceeded the permitted size.");return result.finalOutput;}
 catch(error){if(error instanceof RuntimeFailure)throw error;throw classify(error)}finally{await provider.close?.().catch(()=>undefined)}
}
