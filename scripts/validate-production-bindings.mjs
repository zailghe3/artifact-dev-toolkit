import { readFile } from 'node:fs/promises';

export async function validateProductionBindings(configPath = 'wrangler.jsonc') {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const matches = (config.kv_namespaces ?? []).filter(binding => binding?.binding === 'ARTIFACT_CATALOGUE_CACHE');
  if (matches.length !== 1) throw new Error('Production requires exactly one ARTIFACT_CATALOGUE_CACHE KV binding.');
  if (typeof matches[0].id !== 'string' || !matches[0].id.trim()) throw new Error('ARTIFACT_CATALOGUE_CACHE requires a manually provisioned production namespace id; refusing automatic provisioning.');
  return matches[0].id;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  validateProductionBindings(process.argv[2]).then(id => console.log(`Production KV binding validated: ${id}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
