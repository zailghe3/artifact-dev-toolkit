import {z} from "zod";
export const codexEnvironmentInputSchema=z.object({key:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),name:z.string().trim().min(1).max(120),externalEnvironmentId:z.string().trim().min(1).max(255),enabled:z.boolean()}).strict();
export type CodexEnvironmentDescriptor=z.infer<typeof codexEnvironmentInputSchema>;
type DB={prepare(sql:string):{bind(...values:unknown[]):ReturnType<DB["prepare"]>;first<T>():Promise<T|null>;all<T>():Promise<{results:T[]}>;run():Promise<unknown>}};
type Row={environment_key:string;display_name:string;external_environment_id:string;enabled:number};
const descriptor=(row:Row):CodexEnvironmentDescriptor=>({key:row.environment_key,name:row.display_name,externalEnvironmentId:row.external_environment_id,enabled:Boolean(row.enabled)});
export class D1WorkflowCodexEnvironmentStore{
 private db:DB;
 constructor(db:DB){this.db=db;}
 async list(){return(await this.db.prepare("SELECT environment_key,display_name,external_environment_id,enabled FROM workflow_codex_environments ORDER BY display_name").all<Row>()).results.map(descriptor);}
 async get(key:string){const row=await this.db.prepare("SELECT environment_key,display_name,external_environment_id,enabled FROM workflow_codex_environments WHERE environment_key=?").bind(key).first<Row>();return row?descriptor(row):undefined;}
 async upsert(value:CodexEnvironmentDescriptor){const input=codexEnvironmentInputSchema.parse(value),now=new Date().toISOString();await this.db.prepare("INSERT INTO workflow_codex_environments(environment_key,display_name,external_environment_id,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(environment_key) DO UPDATE SET display_name=excluded.display_name,external_environment_id=excluded.external_environment_id,enabled=excluded.enabled,updated_at=excluded.updated_at").bind(input.key,input.name,input.externalEnvironmentId,input.enabled?1:0,now,now).run();return input;}
 async remove(key:string){codexEnvironmentInputSchema.shape.key.parse(key);await this.db.prepare("DELETE FROM workflow_codex_environments WHERE environment_key=?").bind(key).run();}
}
