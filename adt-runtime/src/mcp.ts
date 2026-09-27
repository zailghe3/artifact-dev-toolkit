import {lookup as dnsLookup,type LookupAddress,type LookupAllOptions,type LookupOneOptions} from "node:dns";
import {promisify} from "node:util";
import {BlockList,isIP} from "node:net";
import {Agent,fetch as undiciFetch,type Dispatcher} from "undici";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const MCP_DISCOVERY_CAPABILITY="mcp:streamable-http:discover",MCP_CALL_CAPABILITY="mcp:streamable-http:call";
export const MCP_LIMITS={tools:64,nameBytes:128,descriptionBytes:2048,schemaBytes:32_768,argumentsBytes:65_536,resultBytes:128_000,durationMs:10_000,redirects:2} as const;
export type McpServerConfig={url:string;transport:"streamable-http";allowLocalhost?:boolean};
export type McpTool={name:string;description?:string;inputSchema:Record<string,unknown>};
export class McpFailure extends Error{readonly retryable=false;constructor(readonly category:string,readonly safeMessage:string,readonly ambiguous=false){super(category)}}

type Resolver=(hostname:string)=>Promise<LookupAddress[]>;
export type NetworkFetch=(input:string|URL,init:RequestInit&{dispatcher?:Dispatcher})=>Promise<Response>;
export type McpNetworkDependencies={resolve?:Resolver;fetch?:NetworkFetch};
const resolveAll:Resolver=async hostname=>promisify(dnsLookup)(hostname,{all:true,verbatim:true});
const defaultFetch:NetworkFetch=(input,init)=>undiciFetch(input,init as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
const bytes=(value:string)=>Buffer.byteLength(value,"utf8");
const forbidden=new BlockList();
for(const [network,prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]] as const)forbidden.addSubnet(network,prefix,"ipv4");
for(const [network,prefix] of [["::",128],["::1",128],["64:ff9b:1::",48],["100::",64],["2001:2::",48],["2001:10::",28],["2001:db8::",32],["fc00::",7],["fe80::",10],["ff00::",8]] as const)forbidden.addSubnet(network,prefix,"ipv6");

export function isForbiddenMcpAddress(address:string){const mapped=/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);if(mapped)return isForbiddenMcpAddress(mapped[1]);const family=isIP(address);return family===0||forbidden.check(address,family===4?"ipv4":"ipv6")}
function localhost(url:URL){return url.hostname==="localhost"||url.hostname==="127.0.0.1"||url.hostname==="[::1]"}
async function destination(value:string|URL,allowLocalhost:boolean,resolver:Resolver){
 let url:URL;try{url=value instanceof URL?value:new URL(value)}catch{throw new McpFailure("configuration_invalid","MCP server configuration is invalid.")}
 if(url.username||url.password||url.hash)throw new McpFailure("configuration_invalid","MCP server destination is not permitted.");
 if(allowLocalhost&&url.protocol==="http:"&&localhost(url))return{url,addresses:[{address:url.hostname==="[::1]"?"::1":"127.0.0.1",family:url.hostname==="[::1]"?6:4}]};
 if(url.protocol!=="https:")throw new McpFailure("configuration_invalid","MCP server destination is not permitted.");
 let addresses:LookupAddress[];try{addresses=await resolver(url.hostname)}catch{throw new McpFailure("connection_unavailable","MCP server is unavailable.")}
 if(!addresses.length||addresses.some(item=>isForbiddenMcpAddress(item.address)))throw new McpFailure("configuration_invalid","MCP server destination is not permitted.");
 return{url,addresses};
}
export async function validateMcpUrl(value:string,allowLocalhost=false,resolver:Resolver=resolveAll){return (await destination(value,allowLocalhost,resolver)).url}

export function createPinnedLookup(hostname:string,addresses:LookupAddress[]){
 return (requested:string,options:LookupOneOptions|LookupAllOptions,callback:(error:NodeJS.ErrnoException|null,address:string|LookupAddress[],family?:number)=>void)=>{
  if(requested!==hostname)return callback(Object.assign(new Error("destination_changed"),{code:"EPERM"}),"",0);
  const family=typeof options==="object"&&typeof options.family==="number"?options.family:0,eligible=family?addresses.filter(item=>item.family===family):addresses;
  if(!eligible.length)return callback(Object.assign(new Error("address_family_unavailable"),{code:"ENOTFOUND"}),"",0);
  if(typeof options==="object"&&options.all)return callback(null,eligible);
  callback(null,eligible[0].address,eligible[0].family);
 };
}
function pinnedDispatcher(hostname:string,addresses:LookupAddress[]){
 return new Agent({connect:{lookup:createPinnedLookup(hostname,addresses)}});
}

function safeFetch(config:McpServerConfig,credential:string|undefined,dependencies:McpNetworkDependencies,onCallDispatch:()=>void,dispatchers:Agent[]){
 const resolver=dependencies.resolve??resolveAll,fetcher=dependencies.fetch??defaultFetch;
 return async(input:string|URL|Request,init?:RequestInit)=>{
  let current=await destination(input instanceof Request?input.url:String(input),Boolean(config.allowLocalhost),resolver),redirects=0;
  const initialOrigin=current.url.origin;
  for(;;){
   if(current.url.origin!==initialOrigin)throw new McpFailure("configuration_invalid","MCP server redirect was rejected.");
   const headers=new Headers(init?.headers);if(credential)headers.set("authorization",`Bearer ${credential}`);
   const dispatcher=pinnedDispatcher(current.url.hostname,current.addresses);dispatchers.push(dispatcher);
   let response:Response;
   try{
    const body=typeof init?.body==="string"?init.body:init?.body instanceof Uint8Array?Buffer.from(init.body).toString("utf8"):"";if(body.includes('"method":"tools/call"'))onCallDispatch();
    response=await fetcher(current.url,{...init,headers,redirect:"manual",signal:AbortSignal.timeout(MCP_LIMITS.durationMs),dispatcher});
   }catch(error){if(error instanceof McpFailure)throw error;throw new McpFailure("connection_unavailable","MCP server request failed safely.")}
   if(response.status>=400){const category=response.status===401?"authentication_failed":response.status===403?"permission_denied":"connection_unavailable";throw new McpFailure(category,"MCP server rejected the request.")}
   if(response.status<300)return response;
   const location=response.headers.get("location");if(!location||redirects++>=MCP_LIMITS.redirects)throw new McpFailure("connection_unavailable","MCP server redirect was rejected.");
   const next=new URL(location,current.url);if(next.origin!==current.url.origin)throw new McpFailure("configuration_invalid","MCP server redirect was rejected.");
   current=await destination(next,Boolean(config.allowLocalhost),resolver);
  }
 };
}

async function connected<T>(config:McpServerConfig,credential:string|undefined,operation:(client:Client)=>Promise<T>,dependencies:McpNetworkDependencies={},call=false,operationFailure="connection_unavailable"){
 if(config.transport!=="streamable-http")throw new McpFailure("configuration_invalid","MCP transport is unsupported.");
 const dispatchers:Agent[]=[],client=new Client({name:"adt-runtime",version:"1"});let callDispatched=false;
 const initial=await validateMcpUrl(config.url,config.allowLocalhost,dependencies.resolve??resolveAll);
 const transport=new StreamableHTTPClientTransport(initial,{fetch:safeFetch(config,credential,dependencies,()=>{callDispatched=true},dispatchers),reconnectionOptions:{maxReconnectionDelay:1,initialReconnectionDelay:1,reconnectionDelayGrowFactor:1,maxRetries:0}});
 let initialized=false;
 try{await client.connect(transport,{timeout:MCP_LIMITS.durationMs});initialized=true;return await operation(client)}
 catch(error){
  if(error instanceof McpFailure){if(call&&callDispatched&&error.category==="connection_unavailable")throw new McpFailure("connection_unavailable","MCP tool outcome is unknown.",true);throw error}
  const ambiguous=call&&callDispatched;
  throw new McpFailure(initialized?operationFailure:"connection_unavailable",ambiguous?"MCP tool outcome is unknown.":initialized?"MCP server returned an invalid response.":"MCP server request failed safely.",ambiguous);
 }finally{await transport.close().catch(()=>undefined);await Promise.all(dispatchers.map(dispatcher=>dispatcher.close().catch(()=>undefined)))}
}

function catalogueTool(value:unknown):McpTool{if(!value||typeof value!=="object"||Array.isArray(value))throw new McpFailure("malformed_response","MCP server returned an invalid tool catalogue.");const v=value as Record<string,unknown>,name=v.name,description=v.description,inputSchema=v.inputSchema;if(typeof name!=="string"||!name||bytes(name)>MCP_LIMITS.nameBytes||(description!==undefined&&(typeof description!=="string"||bytes(description)>MCP_LIMITS.descriptionBytes))||!inputSchema||typeof inputSchema!=="object"||Array.isArray(inputSchema)||bytes(JSON.stringify(inputSchema))>MCP_LIMITS.schemaBytes)throw new McpFailure("malformed_response","MCP server returned an invalid tool catalogue.");return{name,...(description?{description}:{}),inputSchema:inputSchema as Record<string,unknown>}}
export async function discoverMcpTools(config:McpServerConfig,credential?:string,dependencies?:McpNetworkDependencies){return connected(config,credential,async client=>{const result=await client.listTools(undefined,{timeout:MCP_LIMITS.durationMs});if(result.tools.length>MCP_LIMITS.tools)throw new McpFailure("response_too_large","MCP tool catalogue exceeds the permitted size.");return result.tools.map(catalogueTool)},dependencies,false,"malformed_response")}
export async function callMcpTool(config:McpServerConfig,tool:McpTool,arguments_:Record<string,unknown>,credential?:string,dependencies?:McpNetworkDependencies){catalogueTool(tool);if(bytes(JSON.stringify(arguments_))>MCP_LIMITS.argumentsBytes)throw new McpFailure("configuration_invalid","MCP tool arguments exceed the permitted size.");return connected(config,credential,async client=>{const result=await client.callTool({name:tool.name,arguments:arguments_},undefined,{timeout:MCP_LIMITS.durationMs});const serialized=JSON.stringify(result);if(bytes(serialized)>MCP_LIMITS.resultBytes)throw new McpFailure("response_too_large","MCP tool result exceeds the permitted size.");return result},dependencies,true)}
