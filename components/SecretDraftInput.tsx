"use client";
import {useState} from "react";

export function SecretDraftInput({name,required,defaultValue}:{name:string;required:boolean;defaultValue?:string}) {
  const [revealed,setRevealed]=useState(false);
  return <span className="flex items-center gap-2">
    <input name={name} type={revealed?"text":"password"} required={required} defaultValue={defaultValue} autoComplete="new-password" className="adt-field"/>
    <button type="button" aria-label={revealed?"Hide API key":"Show API key"} aria-pressed={revealed} className="rounded p-2" onClick={()=>setRevealed(value=>!value)}>
      {revealed
        ? <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="m3 3 18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c5.5 0 9 5 9 5a16 16 0 0 1-2.1 2.7M6.6 6.6C4.4 8 3 10 3 10s3.5 5 9 5c.7 0 1.4-.1 2-.2"/></svg>
        : <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 10s3.5-5 9-5 9 5 9 5-3.5 5-9 5-9-5-9-5Z"/><circle cx="12" cy="10" r="2"/></svg>}
    </button>
  </span>;
}
