"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {ActionFeedback} from "./ActionFeedback";
import {PendingButtonContent} from "./PendingButtonContent";
import {buttonStyles} from "./Ui";

type TestFailure={error?:string;stage?:string;httpStatus?:number};
type Feedback={message:string;detail?:string};
const stageLabels:Record<string,string>={transport:"WSS transport",upgrade:"WSS upgrade",login:"Adrian login",policy:"Adrian policy",sdk:"Adrian SDK",runtime:"ADT Runtime"};

export function securityTestFailureFeedback(value:TestFailure):Feedback{
 const stage=typeof value.stage==="string"?stageLabels[value.stage]:undefined,status=Number.isInteger(value.httpStatus)&&value.httpStatus!>=100&&value.httpStatus!<=599?`HTTP ${value.httpStatus}`:undefined;
 return{message:typeof value.error==="string"&&value.error?value.error:"test failed.",...((stage||status)?{detail:[stage,status].filter(Boolean).join(": ")}:{})};
}

export function SecurityProfileActions({id,fileSha}:{id:string;fileSha:string}){
 const router=useRouter(),[pending,setPending]=useState(""),[feedback,setFeedback]=useState<Feedback>({message:""});
 async function action(kind:"test"|"delete"){
  setPending(kind);setFeedback({message:""});
  const response=await fetch(`/api/security-profiles/${id}${kind==="test"?"/test":""}`,{method:"POST",...(kind==="delete"?{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({fileSha})}:{})}).catch(()=>undefined);
  if(!response?.ok){const value=await response?.json().catch(()=>({})) as TestFailure|undefined;setFeedback(kind==="test"?securityTestFailureFeedback(value??{}):{message:value?.error??`${kind} failed.`});setPending("");return}
  if(kind==="delete"){router.push("/security");router.refresh();return}
  setFeedback({message:"Adrian security is ready. SaaS authentication succeeded and Block policy is active."});setPending("");
 }
 const success=feedback.message.includes("ready");
 return <div className="mt-5 flex flex-wrap gap-3"><button className={buttonStyles.secondary} disabled={Boolean(pending)} onClick={()=>void action("test")}>{pending==="test"?<PendingButtonContent pending>Testing…</PendingButtonContent>:"Test"}</button><button className={buttonStyles.danger} disabled={Boolean(pending)} onClick={()=>void action("delete")}>{pending==="delete"?<PendingButtonContent pending>Deleting…</PendingButtonContent>:"Delete"}</button>{feedback.detail?<p className="w-full text-sm font-semibold">{feedback.detail}</p>:null}<ActionFeedback id="security-action-feedback" kind={success?"success":"error"} message={feedback.message}/></div>;
}
