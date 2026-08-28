"use client";

import {useCallback,useState} from "react";
import {Background,Controls,ReactFlow,applyNodeChanges,type Node,type NodeChange,type Viewport} from "@xyflow/react";
import type {WorkflowDefinitionV1} from "@/lib/workflow-definitions";
import {normalizeWorkflowLayout,projectSequentialWorkflow,type WorkflowLayoutV1} from "@/lib/workflow-layout";

type SavedLayout={definition:WorkflowLayoutV1;fileSha:string};

export function WorkflowLayoutEditor({workflow,agents,initialLayout}:{workflow:WorkflowDefinitionV1;agents:Record<string,string>;initialLayout?:SavedLayout}){
 const projected=projectSequentialWorkflow(workflow,initialLayout?.definition);
 const [nodes,setNodes]=useState<Node[]>(()=>projected.nodes.map(node=>({...node,data:{label:<><strong>Step {node.data.stepNumber}: {node.data.label}</strong><span className="block text-xs">Agent: {agents[node.data.agentId]??node.data.agentId}</span></>}})));
 const [viewport,setViewport]=useState<Viewport>(projected.viewport),[fileSha,setFileSha]=useState(initialLayout?.fileSha),[status,setStatus]=useState("");
 const onNodesChange=useCallback((changes:NodeChange<Node>[])=>setNodes(current=>applyNodeChanges(changes,current)),[]);
 async function save(){setStatus("Saving layout…");const positions=Object.fromEntries(nodes.map(node=>[node.id,node.position])),layout=normalizeWorkflowLayout(workflow,positions,viewport);try{const response=await fetch(`/api/workflow-definitions/${workflow.id}/layout`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({layout,...(fileSha?{fileSha}:{})})}),body=await response.json() as {fileSha?:string;error?:string};if(!response.ok||!body.fileSha){setStatus(body.error??"Layout could not be saved.");return;}setFileSha(body.fileSha);setStatus("Layout saved.");}catch{setStatus("Layout could not be saved. Refresh before trying again.");}}
 return <section className="mt-6" aria-labelledby="workflow-layout-heading">
  <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="workflow-layout-heading" className="text-xl font-bold">Visual layout</h2><p className="text-sm text-slate-600 dark:text-slate-300">Drag steps to arrange this view. Lines always show the ordered execution below; moving nodes never changes what runs.</p></div><button type="button" onClick={save} className="rounded bg-sky-700 px-4 py-2 font-bold text-white">Save layout</button></div>
  <div className="mt-3 h-[28rem] min-h-80 w-full overflow-hidden rounded-lg border bg-slate-50 touch-none dark:bg-slate-950" data-workflow-visual-editor>
   <ReactFlow nodes={nodes} edges={projected.edges} onNodesChange={onNodesChange} onMoveEnd={(_,next)=>setViewport(next)} defaultViewport={projected.viewport} fitView={!initialLayout} fitViewOptions={{padding:0.2}} nodesConnectable={false} elementsSelectable zoomOnPinch panOnScroll minZoom={0.2} maxZoom={2}><Background/><Controls showInteractive={false}/></ReactFlow>
  </div>
  <p className="mt-2 min-h-6 text-sm" role="status">{status}</p>
 </section>;
}
