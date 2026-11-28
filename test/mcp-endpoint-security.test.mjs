import assert from 'node:assert/strict';
import test from 'node:test';
import { mcpServerDefinitionSchema } from '../lib/tool-definitions.ts';
import { mcpServerInputSchema } from '../lib/mcp-tool-service.ts';
import { GitHubToolDefinitionRepository } from '../lib/tool-definition-repository.ts';
import { assertMcpSnapshotEndpoints, frozenMcpRunToolsSchema } from '../lib/mcp-tool-authority.ts';

const valid = 'https://tools.example/mcp';
const fixtureValue = 'synthetic-value';
const invalid = [
  `https://user:${fixtureValue}@tools.example/mcp`,
  'https://@tools.example/mcp',
  `${valid}?key=${fixtureValue}`,
  `${valid}?`,
  `${valid}#${fixtureValue}`,
  `${valid}#`,
  'http://tools.example/mcp',
];
const definition = { schemaVersion: 1, id: 'docs', name: 'Docs', type: 'mcp', transport: 'streamable-http', authentication: { mode: 'none' } };

test('unsafe MCP addresses fail before GitHub persistence and diagnostics omit the input', async () => {
  const repo = new GitHubToolDefinitionRepository(() => assert.fail('GitHub accessed for invalid input'));
  for (const endpointUrl of invalid) {
    assert.equal(mcpServerInputSchema.safeParse({ id: 'docs', name: 'Docs', endpointUrl, authenticationMode: 'none' }).success, false);
    await assert.rejects(repo.create({ ...definition, endpointUrl }), error => !error.message.includes(fixtureValue));
    await assert.rejects(repo.update({ ...definition, endpointUrl }, 'revision'), error => !error.message.includes(fixtureValue));
  }
  assert.equal(mcpServerDefinitionSchema.parse({ ...definition, endpointUrl: valid }).endpointUrl, valid);
});

test('historical MCP configuration and snapshots fail safely without returning embedded values', async () => {
  const path = 'tools/docs.mcp.json';
  const repo = new GitHubToolDefinitionRepository(async request => request === '/contents/tools'
    ? Response.json([{ name: 'docs.mcp.json', path }])
    : Response.json({ sha: 'revision', content: Buffer.from(JSON.stringify({ ...definition, endpointUrl: invalid[0] })).toString('base64') }));
  await assert.rejects(repo.get('docs'), { message: 'mcp_endpoint_invalid' });

  const raw = { agent: [{ alias: 'docs_read', serverId: 'docs', authenticationMode: 'none', server: { url: invalid[0], transport: 'streamable-http' }, tool: { name: 'read', inputSchema: {} } }] };
  assert.throws(() => assertMcpSnapshotEndpoints(raw), { message: 'mcp_endpoint_invalid' });
  const historical = frozenMcpRunToolsSchema.parse(raw);
  assert.equal(historical.agent[0].server.url, '');
  assert.equal(historical.agent[0].tool.name, 'read');
  assert.throws(() => assertMcpSnapshotEndpoints(historical), { message: 'mcp_endpoint_invalid' });
});
