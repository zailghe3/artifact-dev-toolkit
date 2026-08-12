import {execFile} from "node:child_process";
import {mkdtemp,readdir,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";

const execute=promisify(execFile);
type Schema=Record<string,unknown>;

function object(value:unknown):value is Schema{return typeof value==="object"&&value!==null&&!Array.isArray(value)}
function documentWithTitle(documents:unknown[],title:string){return documents.find(document=>object(document)&&document.title===title)}
function properties(schema:unknown){return object(schema)&&object(schema.properties)?schema.properties:undefined}
function required(schema:unknown,name:string){return object(schema)&&Array.isArray(schema.required)&&schema.required.includes(name)}
function hasType(schema:unknown,type:string):boolean{
 if(!object(schema))return false;
 if(schema.type===type)return true;
 return [schema.anyOf,schema.oneOf].some(variants=>Array.isArray(variants)&&variants.some(variant=>hasType(variant,type)));
}
function discriminatorVariant(schema:unknown,value:string){
 if(!object(schema)||!Array.isArray(schema.oneOf))return undefined;
 return schema.oneOf.find(variant=>{
  const discriminator=properties(variant)?.type;
  return object(discriminator)&&Array.isArray(discriminator.enum)&&discriminator.enum.includes(value);
 });
}
function containsMethodBranch(schema:unknown,method:string):boolean{
 if(Array.isArray(schema))return schema.some(value=>containsMethodBranch(value,method));
 if(!object(schema))return false;
 const discriminator=properties(schema)?.method;
 if(object(discriminator)&&Array.isArray(discriminator.enum)&&discriminator.enum.includes(method))return true;
 return Object.values(schema).some(value=>containsMethodBranch(value,method));
}
function supportsProperties(schema:unknown,names:string[]){const values=properties(schema);return values!==undefined&&names.every(name=>name in values)}
function findObject(schema:unknown,predicate:(value:Schema)=>boolean):Schema|undefined{
 if(Array.isArray(schema)){for(const value of schema){const found=findObject(value,predicate);if(found)return found}return undefined}
 if(!object(schema))return undefined;
 if(predicate(schema))return schema;
 for(const value of Object.values(schema)){const found=findObject(value,predicate);if(found)return found}
 return undefined;
}

export function validateDeviceAuthSchemas(documents:unknown[]){
 const clientRequest=documentWithTitle(documents,"ClientRequest");
 if(!clientRequest||!containsMethodBranch(clientRequest,"initialize"))throw new Error("device_auth_schema_missing_initialize_contract");
 const initialize=documentWithTitle(documents,"InitializeParams");
 const clientInfo=documentWithTitle(documents,"ClientInfo")??findObject(initialize,value=>supportsProperties(value,["name","title","version"]));
 const clientInfoProperties=properties(clientInfo);
 if(!initialize||!supportsProperties(initialize,["clientInfo"])||!clientInfoProperties||
    !hasType(clientInfoProperties.name,"string")||!hasType(clientInfoProperties.title,"string")||!hasType(clientInfoProperties.version,"string"))
  throw new Error("device_auth_schema_missing_initialize_contract");

 if(!containsMethodBranch(clientRequest,"account/read"))throw new Error("device_auth_schema_missing_account_read_contract");
 const accountRead=documentWithTitle(documents,"GetAccountParams");
 if(!accountRead||!supportsProperties(accountRead,["refreshToken"])||!hasType(properties(accountRead)?.refreshToken,"boolean"))
  throw new Error("device_auth_schema_missing_account_read_contract");
 if(!containsMethodBranch(clientRequest,"account/logout"))throw new Error("device_auth_schema_missing_account_logout_contract");
 if(!containsMethodBranch(clientRequest,"account/login/start"))throw new Error("device_auth_schema_missing_request_contract");

 const loginParams=documentWithTitle(documents,"LoginAccountParams");
 const requestVariant=discriminatorVariant(loginParams,"chatgptDeviceCode");
 if(!requestVariant||!required(requestVariant,"type"))throw new Error("device_auth_schema_missing_request_contract");

 const loginResponse=documentWithTitle(documents,"LoginAccountResponse");
 const responseVariant=discriminatorVariant(loginResponse,"chatgptDeviceCode");
 if(!responseVariant||!required(responseVariant,"type"))throw new Error("device_auth_schema_missing_response_contract");
 const responseProperties=properties(responseVariant);
 for(const field of ["loginId","verificationUrl","userCode"] as const){
  if(!responseProperties||!hasType(responseProperties[field],"string")||!required(responseVariant,field))
   throw new Error(`device_auth_schema_missing_${field}`);
 }
 return true;
}

async function generateAndValidate(command:string){
 const directory=await mkdtemp(join(tmpdir(),"codex-app-server-schema-"));
 try{
  await execute(command,["app-server","generate-json-schema","--out",directory],{maxBuffer:4*1024*1024,timeout:30_000});
  const files=await readdir(directory,{recursive:true});
  const jsonFiles=files.filter(file=>file.endsWith(".json"));
  if(jsonFiles.length===0)throw new Error("device_auth_schema_not_generated");
  validateDeviceAuthSchemas(await Promise.all(jsonFiles.map(async file=>JSON.parse(await readFile(join(directory,file),"utf8")))));
 }finally{await rm(directory,{recursive:true,force:true})}
}

if(process.argv[1]===new URL(import.meta.url).pathname)await generateAndValidate(process.argv[2]??"codex");
