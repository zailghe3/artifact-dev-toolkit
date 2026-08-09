import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Workflow submenu identifies exact and nested active sections accessibly', async () => {
  const nav=await source('components/WorkflowSubnav.tsx');
  assert.match(nav,/usePathname/);
  assert.match(nav,/aria-current=\{active\?"page":undefined\}/);
  assert.match(nav,/path==="\/workflows"/);
  for(const route of ['runs','definitions','agents','connections']) assert.match(nav,new RegExp(`startsWith\\(\\"/workflows/${route}/`));
  assert.doesNotMatch(nav,/Overview[\s\S]*startsWith\("\/workflows"\)/);
});

test('catalogues use the shared header, creation wording, and broad entity links', async () => {
  const cases=[['definitions','New workflow'],['agents','New agent'],['connections','New connection']];
  for(const [name,label] of cases){const page=await source(`app/workflows/${name}/page.tsx`);assert.match(page,/WorkflowSectionHeader/);assert.match(page,new RegExp(label));}
  for(const name of ['definitions','agents']){const page=await source(`app/workflows/${name}/page.tsx`);assert.match(page,/EntityCard/);assert.match(page,/label=\{`Open /);}
  const card=await source('components/WorkflowUi.tsx');
  assert.match(card,/data-entity-card-link/);
  assert.match(card,/data-entity-card-actions/);
  assert.ok(card.indexOf('</Link>') < card.indexOf('data-entity-card-actions'));
});

test('connection destructive action is a separate danger footer action', async () => {
  const page=await source('components/ConnectionCatalogue.tsx');
  assert.match(page,/workflowButton\.danger/);
  assert.match(page,/ml-auto/);
  assert.match(page,/aria-label=\{`Delete connection/);
});

test('provider diagnostics are a native disclosure closed by default', async () => {
  const page=await source('app/workflows/runs/[runId]/page.tsx');
  assert.match(page,/<details[^>]*><summary[^>]*>Provider diagnostics<\/summary>/);
  assert.doesNotMatch(page,/<details[^>]*open[^>]*><summary[^>]*>Provider diagnostics/);
  for(const label of ['Client request ID','Transport outcome','Transport reason','Request duration','Provider request ID','HTTP status','Provider processing']) assert.match(page,new RegExp(label));
});
