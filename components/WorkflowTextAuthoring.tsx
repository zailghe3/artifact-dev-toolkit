"use client";
import {useState} from "react";
import {Panel,buttonStyles} from "@/components/Ui";

export function WorkflowTextAuthoring({context,onLoad,onTextChange,error,disabled}:{context:string;onLoad:(text:string)=>void;onTextChange:()=>void;error:string;disabled:boolean}){
 const [text,setText]=useState(""),[feedback,setFeedback]=useState("");
 async function copy(){
  try{await navigator.clipboard.writeText(context);setFeedback("Authoring context copied.")}
  catch{setFeedback("Clipboard access is unavailable. Expand the authoring context below and select and copy the text manually.")}
 }
 return <Panel aria-labelledby="text-authoring-heading">
  <h2 id="text-authoring-heading" className="text-lg font-bold">Text / AI authoring</h2>
  <p className="my-2 text-sm">Copy safe authoring context to use with an external authoring tool. ADT sends nothing to an AI service. Paste its Workflow Transfer JSON below to load an unsaved draft, then review and create normally.</p>
  <button type="button" className={buttonStyles.secondary} onClick={copy} disabled={!context}>Copy authoring context</button>
  {feedback&&<p role="status">{feedback}</p>}
  <details className="my-3"><summary>View authoring context / manual copy</summary><textarea aria-label="Workflow Authoring Context" readOnly value={context} className="adt-field min-h-48 font-mono"/></details>
  <label>ADT Workflow Transfer JSON<textarea value={text} onChange={event=>{setText(event.target.value);onTextChange()}} disabled={disabled} spellCheck={false} className="adt-field min-h-48 font-mono"/></label>
  <button type="button" disabled={disabled||!text.trim()} className={buttonStyles.secondary} onClick={()=>onLoad(text)}>Load into editor</button>
  {error&&<p role="alert">{error}</p>}
 </Panel>;
}
