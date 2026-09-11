export type WorkflowEditorAgent={id:string;name:string;publishEligible?:boolean};
export type WorkflowEditorNode={id:string;type?:string;position:{x:number;y:number};data:Record<string,unknown>};

export type PublishAvailability=
 | {available:true;sourceNodeId:string;eligibleSourceNodeIds:string[];reason:null}
 | {available:false;sourceNodeId:null;eligibleSourceNodeIds:[];reason:"no-eligible-agent"|"eligible-agent-not-added"|"graph-agent-ineligible"};

export function publishAvailability(nodes:WorkflowEditorNode[],agents:WorkflowEditorAgent[]):PublishAvailability{
 const eligibleAgentIds=new Set(agents.filter(agent=>agent.publishEligible===true).map(agent=>agent.id));
 const graphAgents=nodes.filter(node=>node.type==="agent");
 const eligibleSourceNodeIds=graphAgents.filter(node=>eligibleAgentIds.has(String(node.data.agentId))).map(node=>node.id).sort();
 if(eligibleSourceNodeIds.length)return{available:true,sourceNodeId:eligibleSourceNodeIds[0]!,eligibleSourceNodeIds,reason:null};
 if(eligibleAgentIds.size)return{available:false,sourceNodeId:null,eligibleSourceNodeIds:[],reason:"eligible-agent-not-added"};
 if(graphAgents.length)return{available:false,sourceNodeId:null,eligibleSourceNodeIds:[],reason:"graph-agent-ineligible"};
 return{available:false,sourceNodeId:null,eligibleSourceNodeIds:[],reason:"no-eligible-agent"};
}

export function createPublishNode(nodes:WorkflowEditorNode[],agents:WorkflowEditorAgent[],id:string,position:{x:number;y:number}){
 const availability=publishAvailability(nodes,agents);
 if(!availability.available)return{availability,node:null};
 return{availability,node:{id,type:"publish-github-pr",position,data:{sourceNodeId:availability.sourceNodeId,title:"ADT managed change",body:"Published by ADT.",draft:true}} satisfies WorkflowEditorNode};
}

export function publishUnavailableMessage(reason:Exclude<PublishAvailability,{available:true}>["reason"]){
 if(reason==="eligible-agent-not-added")return "A publish-eligible managed Agent exists in ADT. Add that Agent to this Workflow before adding a Publish block.";
 if(reason==="graph-agent-ineligible")return "The Agent blocks in this Workflow are not configured for managed publication. Re-save a Codex Runner Agent with managed Git enabled and an environment identity.";
 return "No publish-authoring-eligible managed Agent exists in ADT. Create or re-save a Codex Runner Agent with managed Git enabled and an environment identity.";
}
