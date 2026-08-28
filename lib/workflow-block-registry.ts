import {z} from "zod";

export type BlockInterface={input:"text";output:"text"};
export type RegisteredBlock<T=unknown>={type:string;version:number;configSchema:z.ZodType<T>;interface:BlockInterface;ui:{label:string;description:string}};

export class WorkflowBlockRegistry {
 private blocks=new Map<string,RegisteredBlock>();
 register<T>(block:RegisteredBlock<T>){const key=`${block.type}@${block.version}`;if(this.blocks.has(key))throw new Error("duplicate_block_registration");this.blocks.set(key,block as RegisteredBlock);return this;}
 resolve(type:string,version:number){const block=this.blocks.get(`${type}@${version}`);if(!block)throw new Error(this.hasType(type)?`unsupported_block_version:${type}@${version}`:`unknown_block_type:${type}`);return block;}
 validate(type:string,version:number,config:unknown){return this.resolve(type,version).configSchema.parse(config);}
 metadata(){return [...this.blocks.values()].map(({type,version,interface:ports,ui})=>({type,version,interface:ports,ui}));}
 private hasType(type:string){return [...this.blocks.values()].some(block=>block.type===type);}
}

export const agentBlockConfigSchema=z.object({agentId:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80)}).strict();
export const workflowBlockRegistry=new WorkflowBlockRegistry().register({type:"agent",version:1,configSchema:agentBlockConfigSchema,interface:{input:"text",output:"text"},ui:{label:"Agent",description:"Runs an ADT Agent with the previous textual output."}});
