import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";

const result = await build({
  entryPoints: ["../lib/runtime-application.ts"],
  outfile: "dist/workflow-application.js",
  tsconfig: "../tsconfig.json",
  bundle: true, platform: "node", format: "esm", packages: "external", metafile: true,
  plugins: [{
    name: "runtime-server-only",
    setup(plugin) {
      // Next's marker protects the Worker bundle. This entrypoint only runs in a Node server.
      plugin.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "runtime-marker" }));
      plugin.onLoad({ filter: /.*/, namespace: "runtime-marker" }, () => ({ contents: "" }));
    },
  }],
});
const inputs = Object.keys(result.metafile.inputs)
  .filter(path => path.startsWith("../")).map(path => path.slice(3)).sort();
const manifest = JSON.stringify(inputs, null, 2) + "\n";
const path = "application-inputs.json";
if (process.argv.includes("--update-inputs")) await writeFile(path, manifest);
else if (await readFile(path,"utf8") !== manifest) throw new Error("Update Runtime application inputs with npm run bundle:inputs");
