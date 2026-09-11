export type ActionFeedbackKind="error"|"success"|"info";

/** Accessible local result region for one user-initiated asynchronous action. */
export function ActionFeedback({id,kind,message}:{id?:string;kind:ActionFeedbackKind;message?:string}){
 if(!message)return null;
 return <p id={id} role={kind==="error"?"alert":"status"} className={`rounded border p-3 text-sm ${kind==="error"?"border-red-600 text-red-700":""}`}>{message}</p>;
}
