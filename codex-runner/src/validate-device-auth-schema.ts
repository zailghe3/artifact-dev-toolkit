import {execFile} from "node:child_process";
import {mkdtemp,readdir,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";

const execute=promisify(execFile);
export function validateDeviceAuthSchemas(documents:unknown[]){
 const serialized=documents.map(value=>JSON.stringify(value));
 const related=(method:string,tokens:string[])=>serialized.some(document=>document.includes(`\"${method}\"`)&&tokens.every(token=>document.includes(`\"${token}\"`)));
 // Codex emits bundled protocol documents. Requiring each method and its request /
 // response vocabulary in the same bundle prevents unrelated token-only fixtures
 // from passing while remaining independent of generated definition names.
 if(!related("initialize",["clientInfo","name","title","version"]))throw new Error("device_auth_schema_missing_initialize_contract");
 if(!related("account/read",["refreshToken"]))throw new Error("device_auth_schema_missing_account_read_contract");
 if(!related("account/logout",[]))throw new Error("device_auth_schema_missing_account_logout_contract");
 const login=serialized.find(document=>document.includes('"account/login/start"')&&document.includes('"chatgptDeviceCode"'));
 if(!login)throw new Error("device_auth_schema_missing_request_contract");
 for(const field of ["loginId","verificationUrl","userCode"] as const)if(!login.includes(`\"${field}\"`))throw new Error(`device_auth_schema_missing_${field}`);
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
