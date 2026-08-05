import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

export function installTsxHook() {
  const require = createRequire(import.meta.url);
  const Module = require('node:module');
  if (!require.extensions['.tsx']) {
    require.extensions['.tsx'] = (module, filename) => {
      const source = readFileSync(filename, 'utf8');
      const output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
      module._compile(output, filename);
    };
  }
  if (!require.extensions['.ts']) {
    require.extensions['.ts'] = (module, filename) => {
      const source = readFileSync(filename, 'utf8');
      const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
      module._compile(output, filename);
    };
  }
  if (!Module.__artifactAliasPatched) {
    const original = Module._resolveFilename;
    Module._resolveFilename = function(request, parent, isMain, options) {
      if (request.startsWith('@/')) return original.call(this, resolve(process.cwd(), request.slice(2)), parent, isMain, options);
      return original.call(this, request, parent, isMain, options);
    };
    Module.__artifactAliasPatched = true;
  }
  return require;
}
