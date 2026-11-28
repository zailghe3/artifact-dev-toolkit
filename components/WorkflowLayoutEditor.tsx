"use client";
import {buttonStyles} from "@/components/Ui";
import {useCallback,useState} from "react";
import {Background,Controls,Handle,Position,ReactFlow,type Node,type OnNodesChange,type Viewport} from "@xyflow/react";
import {workflowBlockRegistry} from "@/lib/workflow-block-registry";
import type {WorkflowDefinition} from "@/lib/workflow-definitions";
import {normalizeWorkflowLayout,projectSequentialWorkflow,type WorkflowLayoutV1} from "@/lib/workflow-layout";
import {PendingButtonContent} from "@/components/PendingButtonContent";
import {workflowGraphNodeClass,type WorkflowGraphNodeKind} from "@/components/WorkflowGraphNodeStyles";
import {WorkflowWaypointEdge} from "@/components/WorkflowWaypointEdge";
import {ActionFeedback,type ActionFeedbackKind} from "@/components/ActionFeedback";
type SavedLayout={definition:WorkflowLayoutV1;fileSha:string};
function GraphNode({data}:{data:{label:string;detail?:string;kind:WorkflowGraphNodeKind;input:string;outputs:string[];missing?:boolean}}) {
 return <div className={workflowGraphNodeClass(data.kind,data.missing)}>
  <Handle id={data.input} type="target" position={Position.Left}/><strong>{data.label}</strong>
  {data.detail&&<span className="block break-words text-xs">{data.detail}</span>}
  {data.outputs.map((port,index)=>data.outputs.length===1?<Handle key={port} id={port} type="source" position={Position.Right}/>
   :<span key={port} className="block text-right text-xs"><Handle id={port} type="source" position={Position.Right}
     style={{top:((index+1)*100/(data.outputs.length+1))+"%"}}/>{port}</span>)}
 </div>;
}
const nodeTypes={graph:GraphNode},edgeTypes={waypoint:WorkflowWaypointEdge};
export function WorkflowLayoutEditor({workflow,workflowFileSha,agents,initialLayout}:{workflow:WorkflowDefinition;workflowFileSha:string;agents:Record<string,string>;initialLayout?:SavedLayout}){
 const projected=projectSequentialWorkflow(workflow,initialLayout?.definition);
 const semanticById=new Map(workflow.nodes.map(node=>[node.id,node]));
 const [nodes,setNodes]=useState<Node[]>(()=>projected.nodes.map(node=>{
  const semantic=semanticById.get(node.id)!;
  const { blockType, blockVersion }=semantic;
  const block=workflowBlockRegistry.resolve(blockType,blockVersion);
  const config=semantic.config as Record<string,unknown>;
  const input=workflowBlockRegistry.port(blockType,blockVersion,"inputs",undefined,config);
  const outputs=workflowBlockRegistry.ports(blockType,blockVersion,"outputs",config).map(port=>port.id);
  const agentId=String(config.agentId??"");
  const label=blockType==="agent"?agents[agentId]??agentId:block.ui.label;
  const detail=typeof config.question==="string"?config.question:typeof config.message==="string"?config.message
   :typeof config.label==="string"?config.label:typeof config.workflowId==="string"?config.workflowId:undefined;
  return {...node,type:"graph",data:{kind:blockType,label,detail,input,outputs}};
 }));
 const [edgeWaypoints,setEdgeWaypoints]=useState<Record<string,{x:number;y:number}[]>>(projected.edgeWaypoints);
 const edges=workflow.edges.map(edge=>{
  const source=semanticById.get(edge.source)!,target=semanticById.get(edge.target)!;
  const sourceHandle=workflowBlockRegistry.port(source.blockType,source.blockVersion,"outputs",edge.sourcePort,source.config);
  const targetHandle=workflowBlockRegistry.port(target.blockType,target.blockVersion,"inputs",edge.targetPort,target.config);
  return {...edge,type:"waypoint",data:{waypoints:edgeWaypoints[edge.id],onChange:(points:{x:number;y:number}[])=>setEdgeWaypoints(old=>({...old,[edge.id]:points}))},
   sourceHandle,targetHandle,label:sourceHandle==="out"||sourceHandle==="pull-request"?undefined:sourceHandle};
 });
 const [viewport,setViewport]=useState<Viewport>(projected.viewport),[fileSha,setFileSha]=useState(initialLayout?.fileSha),[status,setStatus]=useState("") ,[feedbackKind,setFeedbackKind]=useState<ActionFeedbackKind>("info"),[saving,setSaving]=useState(false);
 const onNodesChange=useCallback<OnNodesChange>(changes=>setNodes(current=>changes.applyTo(current)),[]);
 async function save(){if(saving)return;setSaving(true);setFeedbackKind("info");setStatus("Saving layout…");const positions=Object.fromEntries(nodes.map(node=>[node.id,node.position])),layout=normalizeWorkflowLayout(workflow,positions,viewport,edgeWaypoints);try{const response=await fetch(`/api/workflow-definitions/${workflow.id}/layout`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({layout,workflowFileSha,...(fileSha?{fileSha}:{})})}),body=await response.json() as {fileSha?:string;error?:string};if(!response.ok||!body.fileSha){setFeedbackKind("error");setStatus(body.error??"Layout could not be saved.");return;}setFileSha(body.fileSha);setFeedbackKind("success");setStatus("Layout saved.");}catch{setFeedbackKind("error");setStatus("Layout could not be saved. Refresh before trying again.");}finally{setSaving(false)}}
 return <section className="mt-6" aria-labelledby="workflow-layout-heading"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="workflow-layout-heading" className="text-xl font-bold">{"Workflow graph"}</h2><p className="text-sm text-slate-600 dark:text-slate-300">Drag nodes or move the viewport to arrange this view. Semantic edges determine {"routing"}; layout changes never change what runs.</p></div><div aria-label="Layout save action" className="grid gap-2"><button type="button" onClick={save} disabled={saving} aria-busy={saving} aria-describedby="layout-save-feedback" className={buttonStyles.primary}><PendingButtonContent pending={saving}>{saving?"Saving…":"Save layout"}</PendingButtonContent></button><ActionFeedback id="layout-save-feedback" kind={feedbackKind} message={status}/></div></div><div className="workflow-graph-scroll-gutter mt-3"><div className="workflow-graph h-[clamp(21rem,58dvh,48rem)] w-full rounded-lg border border-border bg-card touch-none" data-workflow-visual-editor><ReactFlow nodes={nodes} edges={edges} edgeTypes={edgeTypes} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onMoveEnd={(_,next)=>setViewport(next)} defaultViewport={projected.viewport} fitView={!initialLayout} fitViewOptions={{padding:0.2}} nodesConnectable={false} elementsSelectable zoomOnPinch panOnScroll minZoom={0.2} maxZoom={2}><Background/><Controls showInteractive={false}/></ReactFlow></div></div></section>;
}
