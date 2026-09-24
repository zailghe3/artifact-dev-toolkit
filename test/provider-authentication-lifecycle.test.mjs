import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCompatibleConnectionTypeChange,createConnectionForAuthentication,resolveAuthenticationForExecution,resolveAuthenticationForReadiness,connectionAuthenticationPayload} from '../lib/provider-authentication-lifecycle.ts';
import {getProviderConnectionType} from '../lib/provider-connection-types.ts';

const responses=getProviderConnectionType('openai-responses'),agents=getProviderConnectionType('openai-agents');
const delegated={...responses,id:'synthetic-delegated',provider:'synthetic',authentication:'delegated-oauth'};

test('API-key creation requires a credential and delegates exactly once when present',async()=>{let calls=0;await assert.rejects(createConnectionForAuthentication(responses,undefined,async()=>{calls++}),/credential_required/);assert.equal(calls,0);assert.equal(await createConnectionForAuthentication(responses,'api-key',async value=>{calls++;assert.equal(value,'api-key');return'created'}),'created');assert.equal(calls,1)});
test('delegated OAuth never falls through API-key creation or accepts a fake credential',async()=>{let calls=0;await assert.rejects(createConnectionForAuthentication(delegated,'arbitrary-vault-value',async()=>{calls++}),/authentication_lifecycle_unsupported/);assert.equal(calls,0);assert.deepEqual(connectionAuthenticationPayload(delegated,'ignored'),{})});
test('unsupported authentication cannot become ready or executable from an arbitrary vault value',async()=>{let calls=0;const resolve=async()=>{calls++;return'arbitrary-vault-value'};await assert.rejects(resolveAuthenticationForReadiness(delegated,resolve),/authentication_lifecycle_unsupported/);await assert.rejects(resolveAuthenticationForExecution(delegated,resolve),/authentication_lifecycle_unsupported/);assert.equal(calls,0)});
test('compatible OpenAI adapter edits are allowed but cross-provider or cross-auth edits fail before validation',()=>{assert.doesNotThrow(()=>assertCompatibleConnectionTypeChange(responses,agents));for(const target of [{...agents,id:'synthetic-provider',provider:'synthetic'},{...agents,id:'synthetic-auth',authentication:'delegated-oauth'}]){let validations=0;assert.throws(()=>{assertCompatibleConnectionTypeChange(responses,target);validations++},/connection_type_change_incompatible/);assert.equal(validations,0)}});
