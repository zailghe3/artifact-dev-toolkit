import {mkdir,writeFile,access,unlink} from "node:fs/promises";
import {resolve,join} from "node:path";
import {defaultAdvisorDefinitions} from "../lib/advisor-default.ts";
import {persistedAgentDefinition} from "../lib/workflow-definitions.ts";
export async function createAdvisorDefinitions(directory,connectionKey){
  const {agent,workflow}=defaultAdvisorDefinitions(connectionKey),root=resolve(directory),agentPath=join(root,"agents/advisor.agent.json"),workflowPath=join(root,"workflows/advisor.workflow.json");
  for(const path of [agentPath,workflowPath]){try{await access(path)}catch(error){if(error.code==="ENOENT")continue;throw error}throw new Error(`Refusing to overwrite ${path}`)}
  await mkdir(join(root,"agents"),{recursive:true});await mkdir(join(root,"workflows"),{recursive:true});
  await writeFile(agentPath,JSON.stringify(persistedAgentDefinition(agent),null,2)+"\n",{flag:"wx"});
  try{await writeFile(workflowPath,JSON.stringify(workflow,null,2)+"\n",{flag:"wx"})}catch(error){await unlink(agentPath);throw error}
  return {agentPath,workflowPath};
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){
  const [directory,connectionKey,...extra]=process.argv.slice(2);
  if(!directory||!connectionKey||extra.length){console.error("Usage: npm run advisor:definitions -- <artifact-repository-directory> <openai-agents-connection-id>");process.exitCode=1}
  else createAdvisorDefinitions(directory,connectionKey).then(paths=>console.log(JSON.stringify(paths))).catch(error=>{console.error(error.message);process.exitCode=1});
}
