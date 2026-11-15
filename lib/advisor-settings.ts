import {advisorSettingsSchema,type AdvisorSettings} from "./advisor-policy.ts";
import type {WorkflowD1Database} from "./workflow-d1-storage.ts";

/** Authoritative repository-scoped settings; revision checks prevent lost concurrent changes. */
export class AdvisorSettingsStore {
  private db:WorkflowD1Database;
  constructor(db:WorkflowD1Database){this.db=db}
  async get(repositoryId:number):Promise<{settings:AdvisorSettings;revision:number}>{
    const row=await this.db.prepare("SELECT settings_json,revision FROM advisor_settings WHERE repository_id=?").bind(repositoryId).first<{settings_json:string;revision:number}>();
    return row?{settings:advisorSettingsSchema.parse(JSON.parse(row.settings_json)),revision:row.revision}:{settings:{workflowId:null,override:null},revision:0};
  }
  async save(repositoryId:number,settings:AdvisorSettings,revision:number){
    const value=JSON.stringify(advisorSettingsSchema.parse(settings));
    const result=revision===0?await this.db.prepare("INSERT INTO advisor_settings (repository_id,settings_json,revision) VALUES (?,?,1) ON CONFLICT(repository_id) DO NOTHING").bind(repositoryId,value).run():await this.db.prepare("UPDATE advisor_settings SET settings_json=?,revision=revision+1 WHERE repository_id=? AND revision=?").bind(value,repositoryId,revision).run();
    if(result.meta?.changes!==1)throw new Error("advisor_settings_conflict");
    return {settings:advisorSettingsSchema.parse(settings),revision:revision+1};
  }
}
