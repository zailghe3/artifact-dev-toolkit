import {OpenAIProvider,withTrace,NoopTrace,UserError,type ModelRequest,type AgentInputItem} from "@openai/agents";
import OpenAI from "openai";
import {compileToolSchema,modelProgressSchema,modelProgressResultSchema,type ModelProgress,type ModelProgressResult,type Conversation} from "./agent-contract.js";
import {providerPost,providerHttpFailure,record,type ProviderHttpDependencies} from "./provider-http.js";
import {approvedOllamaConfiguration,ollamaChatRejection,ollamaToolCapability} from "./ollama.js";
import {anthropicMessagesRejection} from "./anthropic-messages.js";
import {parseOllamaConfiguration} from "./ollama-configuration.js";
import {RuntimeFailure} from "./provider-execution.js";
import {openAIModelCompatibilityIssue,openAIRequestRejection,openAIReasoningEfforts,openAIVerbosities} from "./openai-model-policy.js";
import {z} from "zod";
const invalid=()=>new RuntimeFailure("malformed_response","The provider returned an unsupported or uncorrelatable response.");
export function validateConversation(conversation:Conversation){const pending=new Map<string,string>();for(const turn of conversation){if(turn.role==="tool"){if(pending.get(turn.callId)!==turn.name)throw invalid();pending.delete(turn.callId)}else{if(pending.size)throw invalid();if(turn.role==="assistant")for(const call of turn.calls){if(pending.has(call.id))throw invalid();pending.set(call.id,call.name)}}}if(pending.size)throw invalid()}
export async function progressAgentModel(input:ModelProgress,credential:string,allowed:ReadonlySet<string>,dependencies:ProviderHttpDependencies={}):Promise<ModelProgressResult>{
 const request=modelProgressSchema.parse(input);validateConversation(request.conversation);for(const tool of request.tools){if(tool.schema.type!=="object")throw new RuntimeFailure("configuration_invalid","Tools require object argument schemas.");compileToolSchema(tool.schema)}
 const hasTools=request.tools.length>0;
 const historicalCalls=request.conversation.some(turn=>turn.role!=="user"&&(turn.role==="tool"||turn.calls.length>0));
 const reasoningEffort=z.enum(openAIReasoningEfforts).optional().safeParse(request.options.reasoningEffort);
 const verbosity=z.enum(openAIVerbosities).optional().safeParse(request.options.verbosity);
 if(!reasoningEffort.success||!verbosity.success||request.provider!=="openai-agents"&&
    (reasoningEffort.data!==undefined||verbosity.data!==undefined||(request.options.maxOutputTokens??0)>32_768))
  throw new RuntimeFailure("unsupported_model_option","The requested setting is outside the ADT options for this provider. Check the Agent’s provider settings.");
 let result:unknown;
 if(request.provider==="openai-agents"){
  // Public SDK Model boundary. ADT journals text, function calls and their results.
  const issue=openAIModelCompatibilityIssue("chat-completions",request.model,request.options,hasTools||historicalCalls);
  if(issue)throw new RuntimeFailure(issue.category,issue.safeMessage);
  const client=new OpenAI({apiKey:credential,maxRetries:0,...(dependencies.fetcher?{fetch:dependencies.fetcher}:{})}),provider=new OpenAIProvider({openAIClient:client,useResponses:false,strictFeatureValidation:true});
  const model=await provider.getModel(request.model),items:AgentInputItem[]=[];
  for(const turn of request.conversation){if(turn.role==="tool")items.push({type:"function_call_result",name:turn.name,callId:turn.callId,status:"completed",output:turn.text});else if(turn.role==="user")items.push({role:"user",content:turn.text});else{if(turn.text)items.push({role:"assistant",status:"completed",content:[{type:"output_text",text:turn.text}]});for(const call of turn.calls)items.push({type:"function_call",name:call.name,callId:call.id,arguments:JSON.stringify(call.arguments),status:"completed"})}}
  const modelRequest:ModelRequest={
   systemInstructions:request.instructions,input:items,
   modelSettings:{
    store:false,parallelToolCalls:false,timeoutMs:request.timeoutMs,
    // The SDK’s maxTokens targets deprecated max_tokens, which some models reject.
    providerData:{max_completion_tokens:request.options.maxOutputTokens},
    ...(reasoningEffort.data?{reasoning:{effort:reasoningEffort.data}}:{}),
    ...(verbosity.data?{text:{verbosity:verbosity.data}}:{}),
   },
   tools:request.tools.map(t=>({type:"function",name:t.name,description:t.description,
    parameters:t.schema as Extract<ModelRequest["tools"][number],{type:"function"}>["parameters"],strict:false})),
   toolsExplicitlyProvided:true,outputType:"text",handoffs:[],tracing:false,
  };
  try{
   dependencies.onProviderEntry?.();
   const response=await withTrace(new NoopTrace(),()=>model.getResponse({...modelRequest,signal:AbortSignal.timeout(request.timeoutMs)}));
   const choice=response.providerData?.choices?.[0] as {finish_reason?:string;message?:Record<string,unknown>}|undefined;
   if(!choice||!["stop","tool_calls"].includes(choice.finish_reason??"")||!choice.message||choice.message.function_call)throw invalid();
   const providerCalls=choice.message.tool_calls??undefined;
   if((providerCalls!==undefined&&!Array.isArray(providerCalls))||
      (choice.finish_reason==="tool_calls")!==Boolean(Array.isArray(providerCalls)&&providerCalls.length))throw invalid();
   let text="";const calls=[];for(const item of response.output){if(item.type==="function_call")calls.push({id:item.callId,name:item.name,arguments:JSON.parse(item.arguments)});else if(item.type==="message")for(const part of item.content){if(typeof part==="string"||part.type!=="output_text")throw invalid();text+=part.text}else if(item.type==="reasoning")throw new RuntimeFailure("provider_api_unsupported","The model returned reasoning state outside the journaled Chat Completions contract. Select another model or reasoning setting.");
   else throw invalid()}
   if(Array.isArray(providerCalls)&&providerCalls.length!==calls.length)throw invalid();
   result={version:1,text,calls,usage:{inputTokens:response.usage.inputTokens,outputTokens:response.usage.outputTokens}};
  }catch(error){if(error instanceof RuntimeFailure)throw error;
   if(error instanceof SyntaxError||error instanceof UserError)throw invalid();
   if(error instanceof OpenAI.APIError&&error.status!==undefined&&[400,401,403,404,422,429].includes(error.status)){
    const issue=openAIRequestRejection(error.status,error.error,"chat-completions");
    throw issue?new RuntimeFailure(issue.category,issue.safeMessage):providerHttpFailure(error.status);
   }
   throw new RuntimeFailure("provider_start_ambiguous","The model request outcome is uncertain; ADT will not repeat it automatically.")}finally{await provider.close().catch(()=>undefined)}
 }else if(request.provider==="anthropic-messages"){
  const messages:Array<{role:string;content:unknown[]}>=[];
  for(const turn of request.conversation){if(turn.role==="tool"){const content={type:"tool_result",tool_use_id:turn.callId,content:turn.text,...(turn.denied?{is_error:true}:{})};if(messages.at(-1)?.role==="user")messages.at(-1)!.content.push(content);else messages.push({role:"user",content:[content]})}else if(turn.role==="user")messages.push({role:"user",content:[{type:"text",text:turn.text}]});else messages.push({role:"assistant",content:[...(turn.text?[{type:"text",text:turn.text}]:[]),...turn.calls.map(call=>({type:"tool_use",id:call.id,name:call.name,input:call.arguments}))]})}
  const response=await providerPost("https://api.anthropic.com/v1/messages",{authorization:`Bearer ${credential}`,"anthropic-version":"2023-06-01","content-type":"application/json",...(request.configuration?.workspaceId?{"anthropic-workspace-id":request.configuration.workspaceId}:{})},{model:request.model,system:request.instructions,messages,max_tokens:request.options.maxOutputTokens??4096,...(request.tools.length?{tools:request.tools.map(t=>({name:t.name,description:t.description,input_schema:t.schema}))}:{})},request.timeoutMs,200,{...dependencies,uncertainBodyFailure:true,classifyRejection:anthropicMessagesRejection});
  if(!record(response)||response.type!=="message"||!Array.isArray(response.content)||!["end_turn","tool_use"].includes(String(response.stop_reason)))throw invalid();let text="";const calls=[];for(const block of response.content){if(!record(block))throw invalid();if(block.type==="text"&&typeof block.text==="string")text+=block.text;else if(block.type==="tool_use")calls.push({id:block.id,name:block.name,arguments:block.input});else throw invalid()}if((response.stop_reason==="tool_use")!==Boolean(calls.length))throw invalid();result={version:1,text,calls,...(record(response.usage)?{usage:{inputTokens:response.usage.input_tokens,outputTokens:response.usage.output_tokens}}:{})};
 }else{
  const config=approvedOllamaConfiguration(parseOllamaConfiguration(request.configuration),allowed),headers={"content-type":"application/json",...(config.authMode==="bearer"?{authorization:`Bearer ${credential}`}:{})};
  const deadline=performance.now()+request.timeoutMs;
  if(hasTools&&await ollamaToolCapability(config.baseUrl,headers,request.model,Math.min(request.timeoutMs,15_000),dependencies)==="unsupported")
   throw new RuntimeFailure("tool_proposals_unsupported","Ollama reports that this model does not support tools. Select a tool-capable model or remove tool grants for this block.");
  const remainingMs=Math.floor(deadline-performance.now());
  if(remainingMs<=0)throw new RuntimeFailure("provider_timeout","The model deadline expired during Ollama capability discovery. Increase the Agent’s execution timeout.");
  const messages=request.conversation.map(turn=>turn.role==="tool"?{role:"tool",tool_name:turn.name,content:turn.text}:turn.role==="user"?{role:"user",content:turn.text}:{role:"assistant",content:turn.text,...(turn.calls.length?{tool_calls:turn.calls.map((call,index)=>({type:"function",function:{index,name:call.name,arguments:call.arguments}}))}:{})});
  const response=await providerPost(config.baseUrl+"/api/chat",headers,{model:request.model,messages:[{role:"system",content:request.instructions},...messages],stream:false,options:{num_predict:request.options.maxOutputTokens??4096},...(request.tools.length?{tools:request.tools.map(t=>({type:"function",function:{name:t.name,description:t.description,parameters:t.schema}}))}:{})},remainingMs,200,{...dependencies,uncertainBodyFailure:true,classifyRejection:ollamaChatRejection});
  if(!record(response)||!record(response.message)||typeof response.message.content!=="string"||response.done!==true)throw invalid();const proposed=response.message.tool_calls??[];if(!Array.isArray(proposed)||proposed.length>16)throw invalid();const calls=proposed.map((call,index)=>{if(!record(call)||!record(call.function))throw invalid();return{id:`ollama-${request.turn}-${index}`,name:call.function.name,arguments:call.function.arguments}});result={version:1,text:response.message.content,calls,...(typeof response.prompt_eval_count==="number"&&typeof response.eval_count==="number"?{usage:{inputTokens:response.prompt_eval_count,outputTokens:response.eval_count}}:{})};
 }
 const parsed=modelProgressResultSchema.parse(result);if(parsed.calls.some(call=>!request.tools.some(tool=>tool.name===call.name)))throw new RuntimeFailure("permission_denied","The model proposed an ungranted tool.");return parsed;
}
