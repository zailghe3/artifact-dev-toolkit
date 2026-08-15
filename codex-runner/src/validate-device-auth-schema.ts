import {execFile} from "node:child_process";
import {mkdtemp,readdir,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";

const execute=promisify(execFile);
type Schema=Record<string,unknown>;
export interface SchemaDocument {filename:string;schema:unknown}

function object(value:unknown):value is Schema{return typeof value==="object"&&value!==null&&!Array.isArray(value)}
function normalize(documents:unknown[]):SchemaDocument[]{return documents.map((value,index)=>object(value)&&typeof value.filename==="string"&&"schema" in value?{filename:value.filename,schema:value.schema}:{filename:`document-${index}.json`,schema:value})}
function documentWithTitle(documents:SchemaDocument[],title:string){return documents.find(document=>object(document.schema)&&document.schema.title===title)}
function properties(schema:unknown){return object(schema)&&object(schema.properties)?schema.properties:undefined}
function required(schema:unknown,name:string){return object(schema)&&Array.isArray(schema.required)&&schema.required.includes(name)}

export function hasType(schema:unknown,type:string):boolean{
 if(!object(schema))return false;
 if(schema.type===type||(Array.isArray(schema.type)&&schema.type.includes(type)))return true;
 return [schema.anyOf,schema.oneOf].some(variants=>Array.isArray(variants)&&variants.some(variant=>hasType(variant,type)));
}

function pointerSegment(value:string):string|undefined{
 if(/~(?![01])/u.test(value))return undefined;
 return value.replaceAll("~1","/").replaceAll("~0","~");
}
function resolveSchema(document:SchemaDocument,value:unknown):Schema|undefined{
 let current=value;
 const visited=new Set<string>();
 for(let depth=0;depth<16;depth++){
  if(!object(current))return undefined;
  if(typeof current.$ref!=="string")return current;
  const reference=current.$ref;
  if(!reference.startsWith("#/")||visited.has(reference))return undefined;
  visited.add(reference);
  let pointed:unknown=document.schema;
  for(const encoded of reference.slice(2).split("/")){
   const segment=pointerSegment(encoded);
   if(segment===undefined||!object(pointed)||!(segment in pointed))return undefined;
   pointed=pointed[segment];
  }
  current=pointed;
 }
 return undefined;
}
function resolvedVariants(document:SchemaDocument,schema:unknown):Schema[]{
 const resolved=resolveSchema(document,schema);
 if(!resolved)return [];
 const variants=[resolved.oneOf,resolved.anyOf].find(Array.isArray);
 if(!variants)return [resolved];
 return variants.map(variant=>resolveSchema(document,variant)).filter((variant):variant is Schema=>variant!==undefined);
}
function discriminatorVariant(document:SchemaDocument,schema:unknown,key:string,value:string){
 return resolvedVariants(document,schema).find(variant=>{
  const discriminator=properties(variant)?.[key];
  return object(discriminator)&&Array.isArray(discriminator.enum)&&discriminator.enum.includes(value);
 });
}
function requestBranch(document:SchemaDocument,method:string){return discriminatorVariant(document,document.schema,"method",method)}
function branchParams(document:SchemaDocument,branch:Schema){return resolveSchema(document,properties(branch)?.params)}
function supportsProperties(schema:unknown,names:string[]){const values=properties(schema);return values!==undefined&&names.every(name=>name in values)}
function loginRequestVariant(document:SchemaDocument,schema:unknown){return discriminatorVariant(document,schema,"type","chatgptDeviceCode")}

export function validateDeviceAuthSchemas(input:unknown[]){
 const documents=normalize(input);
 const clientRequest=documentWithTitle(documents,"ClientRequest");
 if(!clientRequest)throw new Error("device_auth_schema_missing_initialize_contract");

 const initializeBranch=requestBranch(clientRequest,"initialize");
 const initialize=initializeBranch&&branchParams(clientRequest,initializeBranch);
 const clientInfoReference=properties(initialize)?.clientInfo;
 const clientInfo=resolveSchema(clientRequest,clientInfoReference);
 const clientInfoProperties=properties(clientInfo);
 if(!initialize||!supportsProperties(initialize,["clientInfo"])||!required(initialize,"clientInfo")||!clientInfoProperties||
    !required(clientInfo,"name")||!required(clientInfo,"version")||!hasType(clientInfoProperties.name,"string")||
    !hasType(clientInfoProperties.version,"string")||("title" in clientInfoProperties&&!hasType(clientInfoProperties.title,"string")))
  throw new Error("device_auth_schema_missing_initialize_contract");

 const accountReadBranch=requestBranch(clientRequest,"account/read");
 const accountRead=accountReadBranch&&branchParams(clientRequest,accountReadBranch);
 if(!accountRead||!supportsProperties(accountRead,["refreshToken"])||!hasType(properties(accountRead)?.refreshToken,"boolean"))
  throw new Error("device_auth_schema_missing_account_read_contract");

 const logoutBranch=requestBranch(clientRequest,"account/logout");
 if(!logoutBranch)throw new Error("device_auth_schema_missing_account_logout_contract");
 const logoutProperty=properties(logoutBranch)?.params;
 const logoutParams=resolveSchema(clientRequest,logoutProperty);
 if(logoutProperty===undefined||!logoutParams||!hasType(logoutParams,"null")||required(logoutBranch,"params"))throw new Error("device_auth_schema_missing_account_logout_contract");

 const loginBranch=requestBranch(clientRequest,"account/login/start");
 const loginBranchSchema=loginBranch&&branchParams(clientRequest,loginBranch);
 if(!loginBranchSchema||!loginRequestVariant(clientRequest,loginBranchSchema)||!required(loginRequestVariant(clientRequest,loginBranchSchema),"type"))
  throw new Error("device_auth_schema_missing_request_contract");
 const loginParams=documentWithTitle(documents,"LoginAccountParams");
 const requestVariant=loginParams&&loginRequestVariant(loginParams,loginParams.schema);
 if(!requestVariant||!required(requestVariant,"type"))throw new Error("device_auth_schema_missing_request_contract");

 const loginResponse=documentWithTitle(documents,"LoginAccountResponse");
 const responseVariant=loginResponse&&discriminatorVariant(loginResponse,loginResponse.schema,"type","chatgptDeviceCode");
 if(!responseVariant||!required(responseVariant,"type"))throw new Error("device_auth_schema_missing_response_contract");
 const responseProperties=properties(responseVariant);
 for(const field of ["loginId","verificationUrl","userCode"] as const){
  if(!responseProperties||!hasType(responseProperties[field],"string")||!required(responseVariant,field))throw new Error(`device_auth_schema_missing_${field}`);
 }
 return true;
}

/** Build-time guard for the narrow Codex 0.147 health-turn wire contract. */
export function validateCodexTestSchemas(input:unknown[]){
 const documents=normalize(input),named=(title:string)=>documentWithTitle(documents,title);
 const objectContract=(title:string,fields:string[])=>{const document=named(title);if(!document||!supportsProperties(document.schema,fields))throw new Error(`codex_test_schema_missing_${title}`);return document};
 const thread=objectContract("ThreadStartParams",["cwd","approvalPolicy","sandbox","ephemeral","model"]),turn=objectContract("TurnStartParams",["threadId","input"]),interrupt=objectContract("TurnInterruptParams",["threadId","turnId"]);
 if(!required(turn.schema,"threadId")||!required(turn.schema,"input")||!required(interrupt.schema,"threadId")||!required(interrupt.schema,"turnId"))throw new Error("codex_test_schema_missing_turn_contract");
 const threadText=JSON.stringify(thread.schema),notificationText=JSON.stringify([named("ItemStartedNotification")?.schema,named("ItemCompletedNotification")?.schema,named("TurnCompletedNotification")?.schema]);
 for(const token of ["read-only","never"])if(!threadText.includes(`\"${token}\"`))throw new Error("codex_test_schema_missing_safety_contract");
 for(const token of ["threadId","turnId","item","agentMessage","commandExecution","fileChange","mcpToolCall","status","text"])if(!notificationText.includes(`\"${token}\"`))throw new Error("codex_test_schema_missing_notification_contract");
 return true;
}

async function generateAndValidate(command:string){
 const directory=await mkdtemp(join(tmpdir(),"codex-app-server-schema-"));
 try{
  await execute(command,["app-server","generate-json-schema","--out",directory],{maxBuffer:4*1024*1024,timeout:30_000});
  const files=await readdir(directory,{recursive:true});
  const jsonFiles=files.filter(file=>file.endsWith(".json"));
  if(jsonFiles.length===0)throw new Error("device_auth_schema_not_generated");
  const documents=await Promise.all(jsonFiles.map(async filename=>({filename,schema:JSON.parse(await readFile(join(directory,filename),"utf8")) as unknown})));
  validateDeviceAuthSchemas(documents);
  validateCodexTestSchemas(documents);
 }finally{await rm(directory,{recursive:true,force:true})}
}

if(process.argv[1]===new URL(import.meta.url).pathname)await generateAndValidate(process.argv[2]??"codex");
