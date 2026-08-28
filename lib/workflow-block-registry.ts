import {z} from "zod";

export type BlockPort={id:string;dataType:"text";default?:boolean;multiple?:boolean};
export type BlockInterface={inputs:readonly BlockPort[];outputs:readonly BlockPort[]};
export type RegisteredBlock<T=unknown>={type:string;version:number;configSchema:z.ZodType<T>;interface:BlockInterface;references?:(config:T)=>{agentIds?:string[]};ui:{label:string;description:string}};

export class WorkflowBlockRegistry {
 private blocks=new Map<string,RegisteredBlock>();
 register<T>(block:RegisteredBlock<T>){const key=`${block.type}@${block.version}`;if(this.blocks.has(key))throw new Error("duplicate_block_registration");for(const direction of [block.interface.inputs,block.interface.outputs]){if(!direction.length||new Set(direction.map(port=>port.id)).size!==direction.length||direction.filter(port=>port.default).length!==1)throw new Error("invalid_block_ports");}this.blocks.set(key,block as RegisteredBlock);return this;}
 resolve(type:string,version:number){const block=this.blocks.get(`${type}@${version}`);if(!block)throw new Error(this.hasType(type)?`unsupported_block_version:${type}@${version}`:`unknown_block_type:${type}`);return block;}
 validate(type:string,version:number,config:unknown){return this.resolve(type,version).configSchema.parse(config);}
 references(type:string,version:number,config:unknown){const block=this.resolve(type,version),parsed=block.configSchema.parse(config);return block.references?.(parsed)??{};}
 port(type:string,version:number,direction:"inputs"|"outputs",port?:string){const ports=this.resolve(type,version).interface[direction],resolved=port??ports.find(value=>value.default)?.id;if(!resolved||!ports.some(value=>value.id===resolved))throw new Error(`unknown_${direction==="inputs"?"target":"source"}_port:${port??"default"}`);return resolved;}
 metadata(){return [...this.blocks.values()].map(({type,version,interface:ports,ui})=>({type,version,interface:ports,ui}));}
 private hasType(type:string){return [...this.blocks.values()].some(block=>block.type===type);}
}

export const agentBlockConfigSchema=z.object({agentId:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80)}).strict();
export const conditionBlockConfigSchema=z.object({operator:z.literal("contains"),value:z.string().min(1).max(4096),caseSensitive:z.boolean().default(false)}).strict();
export const workflowBlockRegistry=new WorkflowBlockRegistry()
 .register({type:"agent",version:1,configSchema:agentBlockConfigSchema,interface:{inputs:[{id:"in",dataType:"text",default:true}],outputs:[{id:"out",dataType:"text",default:true}]},references:config=>({agentIds:[config.agentId]}),ui:{label:"Agent",description:"Runs an ADT Agent with incoming text."}})
 .register({type:"condition",version:1,configSchema:conditionBlockConfigSchema,interface:{inputs:[{id:"in",dataType:"text",default:true}],outputs:[{id:"true",dataType:"text",default:true},{id:"false",dataType:"text"}]},ui:{label:"Condition",description:"Routes incoming text through a bounded contains predicate."}});
