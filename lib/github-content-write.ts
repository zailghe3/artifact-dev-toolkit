import {z} from "zod";

export class GitContentWriteError extends Error {
 readonly responseInvalid:boolean;readonly status?:number;
 readonly code:"authentication"|"permission"|"conflict"|"uncertain";
 constructor(code:GitContentWriteError["code"],responseInvalid=false,status?:number){super(`git_content_${code}`);this.code=code;this.responseInvalid=responseInvalid;this.status=status}
}
/** Shared single-attempt Contents mutation. Never retries a possibly successful write. */
export async function writeGitHubContents(input:{url:string;token:string;path:string;markdown:string;message:string;branch:string;sha?:string;fetchImpl?:typeof fetch}){
 let response:Response;
 try{response=await (input.fetchImpl??fetch)(input.url,{method:"PUT",redirect:"error",headers:{accept:"application/vnd.github+json",authorization:`Bearer ${input.token}`,"content-type":"application/json","user-agent":"artifact-dev-toolkit","x-github-api-version":"2022-11-28"},body:JSON.stringify({message:input.message,content:Buffer.from(input.markdown).toString("base64"),branch:input.branch,...(input.sha?{sha:input.sha}:{})})})}catch{throw new GitContentWriteError("uncertain")}
 if(!response.ok){await response.body?.cancel().catch(()=>undefined);throw new GitContentWriteError(response.status===401?"authentication":response.status===403?"permission":[404,409,422].includes(response.status)?"conflict":"uncertain",false,response.status)}
 try{
  const value=z.object({content:z.object({path:z.string(),sha:z.string().min(1)}),commit:z.object({sha:z.string().min(1),html_url:z.string().url()})}).parse(await response.json());
  if(value.content.path!==input.path)throw Error();
  return {path:input.path,fileSha:value.content.sha,commitSha:value.commit.sha,commitUrl:value.commit.html_url,repositoryRevision:value.commit.sha};
 }catch{throw new GitContentWriteError("uncertain",true)}
}
