import type {RunStatus} from "./workflow-storage.ts";

export type WorkflowRunTableRow={id:string;workflowName:string;status:RunStatus;createdAt:string;startedAt?:string;completedAt?:string;currentStepId?:string};
export type WorkflowRunSortKey="workflowName"|"status"|"startedAt"|"completedAt"|"currentStepId";
export type WorkflowRunSort={key:WorkflowRunSortKey;direction:"ascending"|"descending"};

export const workflowRunColumns:readonly {key:WorkflowRunSortKey;label:string}[]=[
  {key:"workflowName",label:"Workflow"},
  {key:"status",label:"Status"},
  {key:"startedAt",label:"Started"},
  {key:"completedAt",label:"Completed"},
  {key:"currentStepId",label:"Current step"},
];
export const defaultWorkflowRunSort:WorkflowRunSort={key:"startedAt",direction:"descending"};

const text=(value:string|undefined)=>value??"";
export function sortWorkflowRunRows(runs:readonly WorkflowRunTableRow[],sort:WorkflowRunSort){return runs.map((run,index)=>({run,index})).sort((a,b)=>{const value=(item:WorkflowRunTableRow)=>sort.key==="startedAt"?Date.parse(item.startedAt??item.createdAt):sort.key==="completedAt"?(item.completedAt?Date.parse(item.completedAt):-Infinity):text(item[sort.key]).toLocaleLowerCase();const av=value(a.run),bv=value(b.run),comparison=typeof av==="number"&&typeof bv==="number"?av-bv:String(av).localeCompare(String(bv));return (sort.direction==="ascending"?comparison:-comparison)||(a.index-b.index);}).map(({run})=>run);}
export function nextWorkflowRunSort(current:WorkflowRunSort,key:WorkflowRunSortKey):WorkflowRunSort{return {key,direction:current.key===key&&current.direction==="ascending"?"descending":"ascending"};}
