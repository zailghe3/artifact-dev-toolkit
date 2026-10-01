"use client";
import {useReducer,useState} from "react";
import {useRouter} from "next/navigation";
import {definitionIdDraftReducer,DEFINITION_ID_MAX_LENGTH} from "@/lib/definition-id";
import {ActionFeedback} from "./ActionFeedback";
import {PendingButtonContent} from "./PendingButtonContent";
import {FormActions,buttonStyles} from "./Ui";
import {SecretDraftInput} from "./SecretDraftInput";

type Profile={id:string;name:string;description:string;endpointUrl:string;decisionTimeoutMs:number;credentialConfigured:boolean};
const field="adt-field";
export const ADRIAN_CLOUD_ENDPOINT="wss://adrian.secureagentics.ai/ws";

export function SecurityProfileEditor({initial,fileSha}:{initial?:Profile;fileSha?:string}) {
  const router=useRouter(),[pending,setPending]=useState(""),[message,setMessage]=useState("");
  const [identity,updateIdentity]=useReducer(definitionIdDraftReducer,{name:initial?.name??"",id:initial?.id??"",idOverridden:Boolean(initial)});
  async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setPending("save");setMessage("");const data=new FormData(event.currentTarget),definition={schemaVersion:1,id:String(data.get("id")),name:String(data.get("name")),description:String(data.get("description")),provider:"adrian",endpointUrl:String(data.get("endpointUrl")),decisionTimeoutMs:Number(data.get("decisionTimeoutMs"))},apiKey=String(data.get("apiKey")??"");if(initial&&!initial.credentialConfigured&&definition.endpointUrl!==initial.endpointUrl){setMessage("Recover the credential before changing the endpoint.");setPending("");return}const response=await fetch(initial?`/api/security-profiles/${initial.id}`:"/api/security-profiles",{method:initial?"PUT":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(initial?{definition,fileSha,...(apiKey?{apiKey}:{})}:{...definition,apiKey})}).catch(()=>undefined);if(!response?.ok){setMessage((await response?.json().catch(()=>({})) as {error?:string})?.error??"Save failed.");setPending("");return}router.push(`/security/${definition.id}`);router.refresh()}
  return <form onSubmit={submit} className="mt-6 grid max-w-2xl gap-4">
    <label>Name *<input name="name" required value={identity.name} onChange={event=>updateIdentity({type:"name",value:event.target.value})} className={field}/></label>
    <label>ID *<input name="id" required readOnly={Boolean(initial)} value={identity.id} onChange={event=>updateIdentity({type:"id",value:event.target.value})} maxLength={DEFINITION_ID_MAX_LENGTH} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" aria-describedby="security-profile-id-help" className={field}/></label>
    <p id="security-profile-id-help" className="text-sm">Permanent identifier used by Agents. It cannot be changed after creation.</p>
    <label>Description<textarea name="description" defaultValue={initial?.description} className={field}/></label>
    <label>Adrian WebSocket endpoint *<input name="endpointUrl" type="url" required defaultValue={initial?.endpointUrl??ADRIAN_CLOUD_ENDPOINT} className={field}/>{!initial&&<span className="block text-sm">Adrian Cloud endpoint: <code>{ADRIAN_CLOUD_ENDPOINT}</code>. Custom secure WSS endpoints remain supported.</span>}</label>
    <label>Decision timeout (milliseconds) *<input name="decisionTimeoutMs" type="number" min="250" max="30000" required defaultValue={initial?.decisionTimeoutMs??5000} className={field}/></label>
    <label>{initial?.credentialConfigured?"Replace API key (optional)":"API key *"}<SecretDraftInput name="apiKey" required={!initial||!initial.credentialConfigured}/><span className="block text-sm">{!initial&&<>For Adrian Cloud, use an <code>adr_live_...</code> API key generated for an Adrian agent profile. </>}Write-only. Adrian policy and remit remain managed in Adrian.</span></label>
    <FormActions label="Security Profile save" feedback={<ActionFeedback id="security-profile-feedback" kind="error" message={message}/>}><button disabled={Boolean(pending)} className={buttonStyles.primary}>{pending?<PendingButtonContent pending>Saving…</PendingButtonContent>:initial?"Save changes":"Create profile"}</button></FormActions>
  </form>;
}
