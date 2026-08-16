import {codexRunnerOptionsSchema} from "./workflow-adapter.ts";
import type {CodexRunnerSnapshot} from "./workflow-services.ts";

export function validateCodexRunnerOptionsAgainstSnapshot(options:unknown,catalog:CodexRunnerSnapshot){
 const parsed=codexRunnerOptionsSchema.parse(options);
 if(!catalog.configured||!catalog.reachable||!catalog.codexAvailable)throw new Error("connection_unavailable");
 if(!catalog.jobExecution)throw new Error("codex_job_execution_unavailable");
 if(!catalog.environmentCatalogAvailable)throw new Error("codex_environment_catalog_unavailable");
 const environment=catalog.environments.find(item=>item.key===parsed.environmentKey);
 if(!environment?.enabled||!environment.ready)throw new Error("codex_environment_unavailable");
 if(!catalog.authenticated)throw new Error("codex_authentication_unavailable");
 if(!catalog.modelCatalogAvailable)throw new Error("codex_model_catalog_unavailable");
 const model=parsed.model?catalog.models.find(item=>item.id===parsed.model):catalog.models.find(item=>item.isDefault);
 if(parsed.model&&!model)throw new Error("codex_model_unavailable");
 if(parsed.reasoningEffort&&(!model||!model.supportedReasoningEfforts.some(item=>item.reasoningEffort===parsed.reasoningEffort)))throw new Error("codex_reasoning_effort_unavailable");
 return parsed;
}
