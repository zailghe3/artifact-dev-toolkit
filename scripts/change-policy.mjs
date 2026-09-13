const canonicalFeatureRe = /^requests\/features\/[^/]+\.json$/;
const staticAssetRe = /\.(?:avif|gif|ico|jpe?g|png|webp|woff2?|ttf|otf)$/i;

export function normalizePath(path) {
  return String(path ?? '').replace(/^\.\//, '');
}

export function isCanonicalFeaturePath(path) {
  return canonicalFeatureRe.test(normalizePath(path));
}

export function isGovernancePath(path) {
  const p = normalizePath(path);
  return /(^|\/)AGENTS\.md$/.test(p) || p.startsWith('.agents/');
}

export function isWorkflowAutomationPath(path) {
  const p = normalizePath(path);
  return p.startsWith('.github/workflows/') || p.startsWith('.github/actions/');
}

export function isDocumentationOrRequestPath(path) {
  const p = normalizePath(path);
  return isGovernancePath(p)
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

export function isCiCdGuardrailTestPath(path) {
  const p = normalizePath(path);
  return new Set([
    'test/auto-merge-eligibility.test.mjs',
    'test/auto-merge-orchestration.test.mjs',
    'test/change-classification.test.mjs',
    'test/deployment-freshness.test.mjs',
    'test/deployment-workflow.test.mjs',
    'test/adt-runtime-publication.test.mjs',
    'test/codex-runner-publish-workflow.test.mjs',
    'test/integration/workflow-runtime-integration.test.mjs',
  ]).has(p);
}

function isOrdinaryDocumentationOrRequestPath(path) {
  const p = normalizePath(path);
  if (isGovernancePath(p)) return false;
  return p.startsWith('docs/')
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

function isStaticAssetPath(path) {
  const p = normalizePath(path);
  return p.startsWith('public/') && staticAssetRe.test(p);
}

function isStyleOnlyPath(path) {
  const p = normalizePath(path);
  return (p.startsWith('app/') || p.startsWith('components/') || p.startsWith('styles/'))
    && /\.css$/i.test(p);
}

export function isLowSensitivityAutoMergePath(path) {
  const p = normalizePath(path);
  return isOrdinaryDocumentationOrRequestPath(p)
    || isStaticAssetPath(p)
    || isStyleOnlyPath(p);
}

export function requiresManualReviewPath(path) {
  return !isLowSensitivityAutoMergePath(path);
}
