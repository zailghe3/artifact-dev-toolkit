export function addV1Step(steps:readonly string[],agentId:string){return[...steps,agentId];}
export function removeV1Step(steps:readonly string[],index:number){return steps.length===1?[...steps]:steps.filter((_,item)=>item!==index);}
export function moveV1Step(steps:readonly string[],index:number,direction:-1|1){const target=index+direction;if(index<0||index>=steps.length||target<0||target>=steps.length)return[...steps];const next=[...steps],[item]=next.splice(index,1);next.splice(target,0,item);return next;}
export function replaceV1StepAgent(steps:readonly string[],index:number,agentId:string){return steps.map((value,item)=>item===index?agentId:value);}
