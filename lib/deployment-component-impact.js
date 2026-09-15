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

const rootVerificationExtras = new Set([
  '.node-version',
  'cloudflare-env.d.ts',
  'next-env.d.ts',
  'eslint.config.mjs',
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

function isDocumentationOrRequestPath(path) {
  const p = normalize(path);
  return /(^|\/)AGENTS\.md$/.test(p)
    || p.startsWith('.agents/')
    || p.startsWith('docs/')
    || p.startsWith('specs/')
    || p.startsWith('prompts/')
    || p.startsWith('requests/')
    || p === 'README.md'
    || /^[^/]+\.md$/.test(p)
    || p === 'adt-runtime/README.md'
    || p.startsWith('adt-runtime/docs/')
    || p === 'codex-runner/README.md'
    || p.startsWith('codex-runner/docs/');
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

export function isKnownDeploymentClassificationPath(path) {
  const p = normalize(path);
  return isDocumentationOrRequestPath(p)
    || p === '.gitignore'
    || p === '.gitkeep'
    || rootVerificationExtras.has(p)
    || isAppBuildPath(p)
    || p.startsWith('migrations/')
    || p.startsWith('.github/')
    || p.startsWith('scripts/')
    || p.startsWith('test/')
    || p.startsWith('test-fixtures/')
    || p.startsWith('adt-runtime/')
    || p.startsWith('codex-runner/');
}

export function hasUnclassifiedDeploymentChanges(paths) {
  return (paths ?? []).map(normalize).filter(Boolean).some((path) => !isKnownDeploymentClassificationPath(path));
}

export function deploymentComponentImpact(paths) {
  const values = [...new Set((paths ?? []).map(normalize).filter(Boolean))];
  return {
    worker: values.some(isAppBuildPath),
    runtime: values.some(isRuntimeImagePath),
    runner: values.some(isRunnerImagePath),
  };
}
