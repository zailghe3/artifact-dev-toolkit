import {execFile} from "node:child_process";
import {mkdtemp,readdir,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";

const execute=promisify(execFile);
const required=["chatgptDeviceCode","loginId","verificationUrl","userCode"] as const;

export function validateDeviceAuthSchemas(documents:unknown[]){
 const serialized=documents.map(value=>JSON.stringify(value));
 for(const token of required)if(!serialized.some(document=>document.includes(`\"${token}\"`)))throw new Error(`device_auth_schema_missing_${token}`);
 // The request method and variant must occur in one generated document, rather than
 // merely existing in unrelated definitions.
 if(!serialized.some(document=>document.includes("account/login/start")&&document.includes("chatgptDeviceCode")))throw new Error("device_auth_schema_missing_request_contract");
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
