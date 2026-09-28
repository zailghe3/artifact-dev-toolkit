import test from "node:test";
import assert from "node:assert/strict";
import {canonicalAdrianEndpoint,securityProfileDefinitionSchema,securityProfilePath} from "../lib/security-profile-definitions.ts";
import {InMemorySecurityProfileDefinitionRepository} from "../lib/security-profile-definition-repository.ts";
import {getProviderConnectionType} from "../lib/provider-connection-types.ts";

const profile={schemaVersion:1,id:"production",name:"Production",description:"",provider:"adrian",endpointUrl:"wss://SECURITY.example:443/events#ignored",decisionTimeoutMs:1500};
test("security profiles canonicalise secure trust targets and reject insecure endpoints",()=>{assert.equal(canonicalAdrianEndpoint(profile.endpointUrl),"wss://security.example/events");assert.throws(()=>securityProfileDefinitionSchema.parse({...profile,endpointUrl:"ws://remote.example"}));assert.equal(securityProfilePath("production"),"security-profiles/production.json")});
test("security profile repository enforces revisions and returns defensive values",async()=>{const repository=new InMemorySecurityProfileDefinitionRepository(),created=await repository.create(profile);assert.equal(created.definition.endpointUrl,"wss://security.example/events");created.definition.name="mutated";assert.equal((await repository.get("production")).definition.name,"Production");await assert.rejects(repository.update({...profile,name:"Updated"},"stale"));const updated=await repository.update({...profile,name:"Updated"},created.fileSha);assert.equal(updated.definition.name,"Updated");await repository.delete("production",updated.fileSha);assert.equal(await repository.get("production"),undefined)});
test("runtime security is an explicit provider capability",()=>{assert.equal(getProviderConnectionType("openai-agents").capabilities.runtimeSecurity,true);for(const adapter of ["openai-responses","anthropic-messages","work-iq-rest"])assert.notEqual(getProviderConnectionType(adapter).capabilities.runtimeSecurity,true)});
