import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {GitHubKnowledgeRepository} from '../../lib/advisor-knowledge-repository.ts';
import {knowledgeDocumentSchema,serializeKnowledge} from '../../lib/advisor-knowledge.ts';
import {context} from './advisor-fixtures.mjs';
export const document=(id='retry-policy',extra={})=>knowledgeDocumentSchema.parse({metadata:{id,title:'Retry policy',type:'decision',status:'active',tags:['recovery'],workflowIds:['review'],agentIds:['analyst'],...extra},body:'Accepted choice: inspect ambiguous operations before retrying. Implementation and outcome are not yet verified.'});
const digest=v=>createHash('sha1').update(v).digest('hex');
export function knowledgeFixture({files={},writeStatus,writeBody,writeThrow=false,readPermission=true,writePermission=true,listOverride}={}){
 const contents=new Map(Object.entries(files)),writes=[],requests=[],capabilities=[];let revision=digest('revision');
 const fetchImpl=async(url,init={})=>{
  requests.push({url,init});const u=new URL(url),base='/repos/acme/private';assert.equal(u.origin,'https://api.github.com');assert.ok(u.pathname.startsWith(base));assert.equal(init.redirect,init.method==='PUT'?'manual':'error');
  const path=u.pathname.slice(base.length);
  if(path==='/git/ref/heads/main')return Response.json({object:{sha:revision}});
  if(path.startsWith('/git/trees/')){
   const key=path.slice('/git/trees/'.length);
   if(key===revision)return Response.json({tree:[{path:'advisor',mode:'040000',type:'tree',sha:digest('advisor')}]});
   if(key===digest('advisor'))return Response.json({tree:[{path:'knowledge',mode:'040000',type:'tree',sha:digest('knowledge')}]});
   assert.equal(key,digest('knowledge'));
   return Response.json({tree:listOverride??[...contents.entries()].filter(([path])=>path.startsWith('advisor/knowledge/')).map(([path,raw])=>({path:path.slice('advisor/knowledge/'.length),mode:'100644',type:'blob',sha:digest(raw),size:Buffer.byteLength(raw)}))});
  }
  if(path.startsWith('/git/blobs/')){
   const sha=path.slice('/git/blobs/'.length),markdown=[...contents.values()].find(raw=>digest(raw)===sha);if(markdown===undefined)return Response.json({},{status:404});return Response.json({sha,encoding:'base64',size:Buffer.byteLength(markdown),content:Buffer.from(markdown).toString('base64')});
  }
  assert.ok(path.startsWith('/contents/'));const target=decodeURIComponent(path.slice('/contents/'.length));
  if(init.method==='PUT'){
   const payload=JSON.parse(init.body);writes.push({target,payload});assert.equal(payload.branch,'main');
   if(writeThrow)throw Error('SENSITIVE_TRANSPORT');if(writeStatus)return Response.json({secret:'SENSITIVE_UPSTREAM'},{status:writeStatus});
   const existing=contents.get(target);if((existing?digest(existing):undefined)!==payload.sha)return Response.json({},{status:409});
   contents.set(target,Buffer.from(payload.content,'base64').toString());revision=digest(`${revision}:${payload.content}`);
   return Response.json(writeBody??{content:{path:target,sha:digest(contents.get(target))},commit:{sha:revision,html_url:`https://github.com/acme/private/commit/${revision}`}});
  }
  assert.fail('Contents reads must never follow symlinks');
 };
 const repository=new GitHubKnowledgeRepository(context,async capability=>{capabilities.push(capability);return{token:'SENSITIVE_CREDENTIAL',permissions:{contents:capability==='read'&&readPermission?'read':capability==='write'&&writePermission?'write':'none'},expiresAt:new Date().toISOString()}},fetchImpl);
 return{repository,contents,writes,requests,capabilities,add(doc){contents.set(`advisor/knowledge/${doc.metadata.id}.md`,serializeKnowledge(doc))}};
}
