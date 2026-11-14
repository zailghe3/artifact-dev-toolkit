import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocketServer} from 'ws';
import protobuf from 'protobufjs';
import {adrian,protoSource} from '@secureagentics/adrian';
import {authorizeJournaledTool} from '../dist/adrian.js';
import {withAdrianLocalLog} from '../dist/adrian-local-log.js';
for(const decision of ['allow','deny'])test(`real Adrian SDK reconstructs a persisted call in a fresh security session: ${decision}`,async t=>{
 const root=protobuf.parse(protoSource,{keepCase:true}).root,Client=root.lookupType('adrian.core_api.v1.ClientFrame'),Server=root.lookupType('adrian.core_api.v1.ServerFrame'),server=new WebSocketServer({host:'127.0.0.1',port:0});
 await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>{for(const socket of server.clients)socket.terminate();server.close(resolve)}));const observed=[];
 server.on('connection',socket=>socket.on('error',()=>{}).on('message',raw=>{const frame=Client.toObject(Client.decode(raw),{defaults:true});if(frame.login){socket.send(Server.encode(Server.create({login_ack:{policy:{mode:3,policy_m0:true,policy_m2:true,policy_m3:true,policy_m4:true}}})).finish());return}for(const event of frame.paired_batch?.events??[]){if(!event.llm?.tool_calls?.length)continue;observed.push(event);socket.send(Server.encode(Server.create({verdict:{event_id:event.event_id,session_id:event.session_id,mad_code:decision==='deny'?'M3.1':'M1.0',policy:{mode:3,policy_m0:true,policy_m2:true,policy_m3:true,policy_m4:true}}})).finish())}}));
 const work=withAdrianLocalLog(adrian,{apiKey:'fixture',wsUrl:`ws://127.0.0.1:${server.address().port}`,sessionId:`fresh-${crypto.randomUUID()}`,blockTimeout:2},async()=>{const client=adrian.getWebSocketClient();assert.ok(await client.waitForPolicyReady(5));return authorizeJournaledTool(adrian.getHandler(),client,{id:'exact-invocation',model:'provider-neutral',instructions:'frozen instructions',conversation:[{role:'user',text:'frozen input'},{role:'assistant',text:'',calls:[{id:'exact-native-id',name:'change',arguments:{repo:'safe'}}]}],call:{id:'exact-native-id',name:'change',arguments:{repo:'safe'}}},2000)});
 if(decision==='allow')assert.deepEqual(await work,{outcome:'allow'});else await assert.rejects(work,{category:'security_denied'});assert.equal(observed.length,1);assert.equal(observed[0].llm.tool_calls[0].id,'exact-native-id');
});
