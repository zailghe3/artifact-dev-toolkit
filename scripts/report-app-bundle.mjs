import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';

const workspace = mkdtempSync(join(tmpdir(), 'adt-bundle-'));
const rows = [];
const verifyStreaming = process.argv.includes('--verify-streaming');
const kib = bytes => (bytes / 1024).toFixed(2);
const staticRoot = resolve('.open-next/assets/_next/static');
const asset = path => join(staticRoot, path.replace(/^static\//, ''));
const sizes = paths => [...new Set(paths)].reduce(([raw, gzip], path) => {
  const content = readFileSync(path);
  return [raw + content.length, gzip + gzipSync(content).length];
}, [0, 0]);
const row = (name, paths) => rows.push([name, ...sizes(paths).map(kib)]);

try {
  const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
  // OpenNext already built the Worker in the preceding verification step.
  delete config.build;
  config.main = resolve(config.main);
  config.assets.directory = resolve(config.assets.directory);
  config.tsconfig = relative(workspace, resolve('tsconfig.json'));
  const configPath = join(workspace, 'wrangler.json');
  writeFileSync(configPath, JSON.stringify(config));
  const result = spawnSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'deploy',
    '--config', configPath, '--dry-run', '--outdir', join(workspace, 'upload')], {
    cwd: workspace, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false',
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' },
  });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Wrangler dry run failed');
  const upload = result.stdout.match(/Total Upload: ([\d.]+) KiB \/ gzip: ([\d.]+) KiB/);
  if (!upload) throw new Error('Wrangler did not report the Worker upload size');
  rows.push(['Worker upload (Wrangler)', upload[1], upload[2]]);
  const allAssets = readdirSync(staticRoot, { recursive: true }).map(path => join(staticRoot, path));
  row('All browser JavaScript', allAssets.filter(path => path.endsWith('.js')));
  row('All browser CSS', allAssets.filter(path => path.endsWith('.css')));
  const routes = JSON.parse(readFileSync('.next/server/app-paths-manifest.json', 'utf8'));
  const build = JSON.parse(readFileSync('.next/build-manifest.json', 'utf8'));
  for (const url of ['/', '/advisor', '/diagnostics', '/workflows/connections', '/workflows/definitions/new', '/sign-in']) {
    const end = url === '/' ? '/page' : `${url}/page`;
    const route = Object.keys(routes).find(path => path.replace(/\/\([^/]+\)/g, '') === end);
    if (!route) throw new Error(`Missing route manifest for ${url}`);
    const context = {};
    runInNewContext(readFileSync(join('.next/server', routes[route].replace(/\.js$/, '_client-reference-manifest.js')), 'utf8'), context);
    const manifest = context.__RSC_MANIFEST[route];
    const js = [...build.rootMainFiles, ...Object.values(manifest.entryJSFiles).flat()];
    const css = Object.values(manifest.entryCSSFiles).flat().filter(file => !file.inlined).map(file => file.path);
    row(`${url} initial JavaScript`, js.map(asset));
    row(`${url} initial CSS`, css.map(asset));
  }

  const report = [
    '## OpenNext bundle sizes',
    '', '| Build output | Raw KiB | Gzip KiB |', '| --- | ---: | ---: |',
    ...rows.map(values => `| ${values.join(' | ')} |`),
    '', 'Browser route estimates use deduplicated build-manifest entry assets before lazy imports.',
  ].join('\n');
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  if (Number(upload[1]) > 64 * 1024) throw new Error('Worker bundle exceeds the Cloudflare 64 MiB limit');
  if (verifyStreaming) {
    const test = spawnSync(process.execPath, [resolve('test/integration/worker-ui-streaming.mjs'),
      join(workspace, 'upload', config.main.split('/').at(-1).replace(/\.ts$/, '.js'))], { stdio: 'inherit', timeout: 45_000 });
    if (test.status !== 0) throw new Error(test.error?.message || 'Local Worker UI streaming test failed');
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
