const rootAppBuildFiles = new Set([
  'package.json',
  'package-lock.json',
  'wrangler.jsonc',
  'tsconfig.json',
  'cloudflare-worker.ts',
  '.nvmrc',
  '.npmrc',
  'postcss.config.mjs',
  'postcss.config.js',
  'tailwind.config.js',
  'tailwind.config.ts',
  'tailwind.config.mjs',
]);

const sharedAppRunnerFiles = new Set(['codex-runner/release.json']);

const runtimeImageFiles = new Set([
  'adt-runtime/Dockerfile',
  'adt-runtime/package.json',
  'adt-runtime/package-lock.json',
  'adt-runtime/tsconfig.json',
]);

const runnerImageFiles = new Set([
  'codex-runner/Dockerfile',
  'codex-runner/package.json',
  'codex-runner/package-lock.json',
  'codex-runner/tsconfig.json',
  'codex-runner/release.json',
  'codex-runner/gai.conf',
  'codex-runner/git-askpass.sh',
]);

function normalize(path) {
  return String(path ?? '').replace(/^\.\//, '');
}

export function isAppBuildPath(path) {
  const p = normalize(path);
  return p.startsWith('app/')
    || p.startsWith('components/')
    || p.startsWith('lib/')
    || p.startsWith('public/')
    || rootAppBuildFiles.has(p)
    || sharedAppRunnerFiles.has(p)
    || /^next\.config\..+$/.test(p)
    || /^open-next\.config\..+$/.test(p)
    || /^postcss\.config\..+$/.test(p)
    || /^tailwind\.config\..+$/.test(p);
}

export function isRuntimeImagePath(path) {
  const p = normalize(path);
  return p.startsWith('adt-runtime/src/') || runtimeImageFiles.has(p);
}

export function isRunnerImagePath(path) {
  const p = normalize(path);
  return p.startsWith('codex-runner/src/') || runnerImageFiles.has(p);
}

export function deploymentComponentImpact(paths) {
  const values = [...new Set((paths ?? []).map(normalize).filter(Boolean))];
  return {
    worker: values.some(isAppBuildPath),
    runtime: values.some(isRuntimeImagePath),
    runner: values.some(isRunnerImagePath),
  };
}
