import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {openAIModelDiagnostic,openAIModelDiagnosticMessage} from '../lib/provider-model-diagnostic-contract.ts';

test('saved and unsaved model routes use one bounded OpenAI diagnostic boundary',async()=>{
 for(const path of ['../app/api/workflow-connections/models/route.ts','../app/api/workflow-connections/[connectionKey]/models/route.ts']){const source=await readFile(new URL(path,import.meta.url),'utf8');assert.match(source,/providerModelDiscoveryFailure\(error,started\)/);assert.doesNotMatch(source,/providerMessage|upstream/)}
 const cases=[['authentication_failed',undefined,401,/authentication failed/],['permission_denied',undefined,403,/permission denied/],['provider_request_rejected',400,502,/HTTP 400/],['rate_limited',undefined,429,/rate limited/],['provider_unavailable',undefined,503,/temporarily unavailable/],['provider_timeout',undefined,504,/timed out/],['malformed_response',undefined,502,/malformed provider response/]];
 for(const [code,httpStatus,responseStatus,message] of cases){const saved=openAIModelDiagnostic(code,httpStatus),unsaved=openAIModelDiagnostic(code,httpStatus);assert.equal(saved.status,responseStatus);assert.equal(unsaved.status,responseStatus);for(const body of [saved.body,unsaved.body]){assert.equal(body.source,'openai');assert.equal(body.safeCode,code);assert.equal(body.httpStatus,httpStatus);assert.match(body.error,message);assert.doesNotMatch(JSON.stringify(body),/credential|response body|private/)}}
});

test('OpenAI diagnostic messages are closed over the bounded failure set',()=>{assert.equal(openAIModelDiagnosticMessage('provider_request_rejected',400),'OpenAI model discovery: request rejected (HTTP 400).')});
