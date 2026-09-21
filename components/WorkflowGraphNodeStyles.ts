export type WorkflowGraphNodeKind="agent"|"condition"|"approval"|"publish-github-pr"|"join"|"subworkflow";

const semanticStyles:Record<WorkflowGraphNodeKind,string>={
  agent:"border-sky-600 bg-white text-slate-950 dark:border-sky-400 dark:bg-slate-900 dark:text-slate-100",
  condition:"border-amber-600 bg-amber-50 text-amber-950 dark:border-amber-400 dark:bg-amber-950 dark:text-amber-100",
  approval:"border-orange-600 bg-orange-50 text-orange-950 dark:border-orange-400 dark:bg-orange-950 dark:text-orange-100",
  "publish-github-pr":"border-emerald-600 bg-emerald-50 text-emerald-950 dark:border-emerald-400 dark:bg-emerald-950 dark:text-emerald-100",
  join:"border-violet-600 bg-violet-50 text-violet-950 dark:border-violet-400 dark:bg-violet-950 dark:text-violet-100",
  subworkflow:"border-teal-600 bg-teal-50 text-teal-950 dark:border-teal-400 dark:bg-teal-950 dark:text-teal-100",
};

export function workflowGraphNodeClass(kind:WorkflowGraphNodeKind,missing=false){
  return `min-w-44 rounded-lg border-2 p-3 ${missing?"border-red-600 bg-red-50 text-red-950 dark:border-red-400 dark:bg-red-950 dark:text-red-100":semanticStyles[kind]}`;
}
