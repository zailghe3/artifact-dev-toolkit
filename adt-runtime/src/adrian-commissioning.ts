import WebSocket from "ws";
import type {IncomingMessage} from "node:http";
import {Mode,SCHEMA_VERSION,decodeServerFrame,encodeClientFrame} from "@secureagentics/adrian";

/** Commissioning is deliberately independent of the per-tool security decision timeout. */
export const ADRIAN_TEST_CONNECT_TIMEOUT_MS=5_000,ADRIAN_TEST_LOGIN_TIMEOUT_MS=10_000,ADRIAN_TEST_TOTAL_TIMEOUT_MS=18_000,ADRIAN_TEST_MAX_PAYLOAD_BYTES=4_096;
export type AdrianPolicyMode="alert"|"block"|"hitl"|"unspecified";
export type AdrianTestStage="transport"|"upgrade"|"login"|"policy"|"sdk"|"ready";
export type AdrianTestSafeCode="adrian_ws_unreachable"|"adrian_ws_authentication_failed"|"adrian_ws_access_forbidden"|"adrian_ws_upgrade_rejected"|"adrian_ws_closed_before_login"|"adrian_login_timeout"|"adrian_protocol_invalid"|"adrian_policy_alert_mode"|"adrian_policy_hitl_unsupported"|"adrian_policy_unspecified"|"adrian_sdk_readiness_failed"|"ready";
export type AdrianCommissioningResult={ok:boolean;stage:AdrianTestStage;safeCode:AdrianTestSafeCode;elapsedMs:number;httpStatus?:number;websocketCloseCode?:number;policyMode?:AdrianPolicyMode};
type SocketFactory=(url:string,options:WebSocket.ClientOptions)=>WebSocket;

const policyMode=(mode:Mode):AdrianPolicyMode=>mode===Mode.MODE_BLOCK?"block":mode===Mode.MODE_ALERT?"alert":mode===Mode.MODE_HITL?"hitl":"unspecified";
const boundedStatus=(value:number|undefined)=>Number.isInteger(value)&&value!>=100&&value!<=599?value:undefined;
const boundedClose=(value:number)=>Number.isInteger(value)&&value>=1000&&value<=4999?value:undefined;

export function probeAdrianControlChannel(input:{endpointUrl:string;apiKey:string;sessionId:string;connectTimeoutMs?:number;loginTimeoutMs?:number},socketFactory:SocketFactory=(url,options)=>new WebSocket(url,options)):Promise<AdrianCommissioningResult>{
 const started=Date.now(),connectTimeout=input.connectTimeoutMs??ADRIAN_TEST_CONNECT_TIMEOUT_MS,loginTimeout=input.loginTimeoutMs??ADRIAN_TEST_LOGIN_TIMEOUT_MS;
 return new Promise(resolve=>{
  let opened=false,settled=false,loginTimer:NodeJS.Timeout|undefined;
  const socket=socketFactory(input.endpointUrl,{headers:{Authorization:`Bearer ${input.apiKey}`,"User-Agent":"adrian-typescript-sdk"},handshakeTimeout:connectTimeout,maxPayload:ADRIAN_TEST_MAX_PAYLOAD_BYTES});
  // This listener deliberately remains installed through termination: ws may emit a late error while an aborted handshake unwinds.
  const absorbLateError=()=>{};
  const cleanupListeners=()=>{socket.off("unexpected-response",onUnexpectedResponse);socket.off("open",onOpen);socket.off("message",onMessage);socket.off("close",onClose)};
  const finish=(result:Omit<AdrianCommissioningResult,"elapsedMs">,response?:IncomingMessage)=>{if(settled){response?.resume();response?.destroy();return}settled=true;clearTimeout(connectTimer);clearTimeout(loginTimer);cleanupListeners();if(response){response.resume();response.destroy()}if(socket.readyState===WebSocket.OPEN)socket.close(1000);else if(socket.readyState===WebSocket.CONNECTING)socket.terminate();resolve({...result,elapsedMs:Date.now()-started})};
  const onUnexpectedResponse=(_request:unknown,response:IncomingMessage)=>{const httpStatus=boundedStatus(response.statusCode),safeCode=httpStatus===401?"adrian_ws_authentication_failed":httpStatus===403?"adrian_ws_access_forbidden":"adrian_ws_upgrade_rejected";finish({ok:false,stage:"upgrade",safeCode,...(httpStatus?{httpStatus}:{})},response)};
  const onOpen=()=>{opened=true;clearTimeout(connectTimer);try{socket.send(encodeClientFrame({login:{sessionId:input.sessionId,llmStack:{provider:"adt-diagnostic",model:"none"},schemaVersion:SCHEMA_VERSION}}),{binary:true})}catch{return finish({ok:false,stage:"login",safeCode:"adrian_protocol_invalid"})}loginTimer=setTimeout(()=>finish({ok:false,stage:"login",safeCode:"adrian_login_timeout"}),loginTimeout)};
  const onMessage=(data:WebSocket.RawData)=>{let frame;try{const bytes=data instanceof ArrayBuffer?new Uint8Array(data):Array.isArray(data)?Buffer.concat(data):data;frame=decodeServerFrame(new Uint8Array(bytes))}catch{return finish({ok:false,stage:"login",safeCode:"adrian_protocol_invalid"})}if(!("loginAck" in frame)||!frame.loginAck?.policy)return finish({ok:false,stage:"login",safeCode:"adrian_protocol_invalid"});const mode=policyMode(frame.loginAck.policy.mode);if(mode==="alert")return finish({ok:false,stage:"policy",safeCode:"adrian_policy_alert_mode",policyMode:mode});if(mode==="hitl")return finish({ok:false,stage:"policy",safeCode:"adrian_policy_hitl_unsupported",policyMode:mode});if(mode!=="block")return finish({ok:false,stage:"policy",safeCode:"adrian_policy_unspecified",policyMode:mode});finish({ok:true,stage:"policy",safeCode:"ready",policyMode:mode})};
  const onClose=(code:number)=>finish({ok:false,stage:opened?"login":"transport",safeCode:opened?"adrian_ws_closed_before_login":"adrian_ws_unreachable",...(opened&&boundedClose(code)?{websocketCloseCode:code}:{})});
  const onError=()=>finish({ok:false,stage:opened?"login":"transport",safeCode:opened?"adrian_ws_closed_before_login":"adrian_ws_unreachable"});
  socket.on("error",absorbLateError);socket.once("error",onError);socket.once("unexpected-response",onUnexpectedResponse);socket.once("open",onOpen);socket.once("message",onMessage);socket.once("close",onClose);
  const connectTimer=setTimeout(()=>finish({ok:false,stage:"transport",safeCode:"adrian_ws_unreachable"}),connectTimeout);
 });
}
