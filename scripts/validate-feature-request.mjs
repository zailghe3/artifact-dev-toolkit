#!/usr/bin/env node
import { validateFeatureRequestFile } from './feature-request-validation.mjs';

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('Usage: npm run issue:validate-request -- requests/features/<request>.json [...]');
  process.exit(1);
}

let failures = 0;
for (const path of paths) {
  try {
    const rendered = validateFeatureRequestFile(path);
    console.log(`Validated ${path} (${rendered.length} rendered characters).`);
  } catch (error) {
    failures += 1;
    console.error(`${path}: ${error.message}`);
  }
}

if (failures > 0) process.exit(1);
