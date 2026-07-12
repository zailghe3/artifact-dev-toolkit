#!/usr/bin/env node
import { validateExternalArtifactRepository } from "../lib/external-artifact-repository.ts";

function parseArgs(argv) {
  const args = { checkoutDir: process.cwd(), artifactRoot: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--root") {
      args.artifactRoot = argv[index + 1];
      index += 1;
    } else if (value === "--help" || value === "-h") {
      args.help = true;
    } else if (!value.startsWith("--")) {
      args.checkoutDir = value;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/validate-artifact-repository.mjs [checkout-dir] [--root artifacts]\n\nValidates a complete external artifact repository checkout against the DATA-001 Markdown contract.`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const result = await validateExternalArtifactRepository(args.checkoutDir, { artifactRoot: args.artifactRoot });
  if (result.valid) {
    console.log(`Artifact repository is valid. ${result.artifactCount} artifact(s) checked.`);
  } else {
    console.error(`Artifact repository is invalid. ${result.errors.length} error(s) found:`);
    for (const error of result.errors) {
      console.error(`- ${error.file}: ${error.reason}`);
    }
    process.exitCode = 1;
  }
} catch (error) {
  console.error((error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
