import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';

// Run the real repository and shared write helper inside workerd, including Request
// construction, headers, redirects, base64 encoding and response consumption.
test('Worker creates artifacts and variations after validating 17 blobs with a write credential', async t => {
  const bundled = await build({stdin: {resolveDir: process.cwd(), contents: `
    import {GitHubArtifactRepository} from './lib/artifact-repository.ts';
    export default {async fetch(request, env) {
      const repository = new GitHubArtifactRepository({owner:'owner', repo:'repo',
        fetch:(url, init) => env.GITHUB.fetch(url, init),
        credentialProvider: async capability => ({token: capability+'-credential', permissions:{contents:capability}}),
        logger:{info(){},error(){}}});
      const metadata={id:'new-prompt',title:'New Prompt',description:'',type:'prompt',tags:[],aliases:[]};
      try {return Response.json(new URL(request.url).pathname === '/variation'
        ? await repository.createVariation({source:{...metadata,id:'existing-0',path:'prompts/0.md',body:'Source'},body:'Variation body',actorLogin:'octocat'})
        : await repository.create({metadata,body:'New body',actorLogin:'octocat'}));
      } catch(error) {return Response.json({error:error.constructor.name}, {status:503})}
    }};`}, banner:{js:"import {createRequire} from 'node:module'; const require = createRequire('/worker.js');"}, bundle:true, write:false, format:'esm', platform:'node', target:'es2022'});
  const calls = [];
  const mf = new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,
    compatibilityDate:'2026-07-09',compatibilityFlags:['nodejs_compat'],
    serviceBindings:{GITHUB: async request => {
      const url = new URL(request.url); calls.push({method:request.method,path:url.pathname,token:request.headers.get('authorization')});
      assert.equal(request.headers.get('authorization'), 'Bearer write-credential');
      if (url.pathname.includes('/git/trees/')) return Response.json({tree:Array.from({length:17},(_,i)=>({path:`prompts/${i}.md`,type:'blob',sha:`blob-${i}`}))});
      if (url.pathname.includes('/git/blobs/')) {const i=url.pathname.split('-').at(-1);return Response.json({encoding:'base64',content:Buffer.from(`---\nid: existing-${i}\ntitle: Existing ${i}\ntype: prompt\ntags: []\naliases: []\n---\n\nBody`).toString('base64')})}
      assert.equal(request.method, 'PUT');
      const body = await request.json(); assert.equal(body.branch,'main');assert.ok(Buffer.from(body.content,'base64').toString().includes('body'));
      return Response.json({content:{path:decodeURIComponent(url.pathname.split('/contents/')[1]),sha:'written-blob'},commit:{sha:'commit',html_url:'https://github.com/owner/repo/commit/commit'}},{status:201});
    }}}));
  t.after(()=>mf.dispose());
  for (const path of ['/create','/variation']) {
    calls.length = 0;
    const response = await mf.dispatchFetch(`http://control${path}`), value = await response.json();
    assert.equal(response.status,200,JSON.stringify(value));
    assert.equal(value.commitSha,'commit');
    assert.equal(calls.filter(c=>c.path.includes('/git/blobs/')).length,17);
    assert.equal(calls.filter(c=>c.method==='PUT').length,1);
  }
});
