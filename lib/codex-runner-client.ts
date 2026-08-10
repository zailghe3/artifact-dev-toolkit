import "server-only";

export type RunnerErrorCategory="configuration_missing"|"runner_unavailable"|"access_denied"|"runner_unauthorized"|"runner_update_required"|"invalid_response";
export type RunnerTransportReason="timeout"|"fetch_error";
export class CodexRunnerError extends Error{constructor(public readonly category:RunnerErrorCategory,public readonly transport?:RunnerTransportReason){super(category)}}
export interface CodexRunnerConfiguration{baseUrl:string;accessClientId:string;accessClientSecret:string;sharedSecret:string;production:boolean;timeoutMs?:number}
export interface RunnerCapabilities{protocolVersion:number;runnerVersion:string;codexAvailable:boolean;deviceAuth:boolean;jobExecution:boolean}
export interface RunnerAuthStatus{connected:boolean;authMode?:string;planType?:string}
export interface RunnerDeviceCeremony{loginId:string;verificationUrl:string;userCode:string}
const MAX_RESPONSE_BYTES=32_768;

export function readCodexRunnerConfiguration(environment:Record<string,string|undefined>=process.env):CodexRunnerConfiguration{
 const values=[environment.CODEX_RUNNER_BASE_URL,environment.CODEX_RUNNER_ACCESS_CLIENT_ID,environment.CODEX_RUNNER_ACCESS_CLIENT_SECRET,environment.CODEX_RUNNER_SHARED_SECRET];
 if(values.every(v=>!v))throw new CodexRunnerError("configuration_missing");if(values.some(v=>!v))throw new CodexRunnerError("configuration_missing");
 return{baseUrl:values[0]!,accessClientId:values[1]!,accessClientSecret:values[2]!,sharedSecret:values[3]!,production:environment.NODE_ENV==="production"};
}
function requiredString(value:unknown){return typeof value==="string"&&value.length>0?value:undefined}
export class CodexRunnerClient{
 private readonly baseUrl:URL;
 constructor(private readonly configuration:CodexRunnerConfiguration,private readonly fetcher:typeof fetch=fetch){this.baseUrl=new URL(configuration.baseUrl);if(configuration.production&&this.baseUrl.protocol!=="https:")throw new CodexRunnerError("configuration_missing");}
 private async request(path:string,method="GET"){const controller=new AbortController();let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort()},this.configuration.timeoutMs??8_000);let response:Response;try{response=await this.fetcher(new URL(path,this.baseUrl),{method,headers:{accept:"application/json","content-type":"application/json","CF-Access-Client-Id":this.configuration.accessClientId,"CF-Access-Client-Secret":this.configuration.accessClientSecret,"X-Codex-Runner-Secret":this.configuration.sharedSecret},signal:controller.signal,redirect:"manual"});}catch{throw new CodexRunnerError("runner_unavailable",timedOut?"timeout":"fetch_error")}finally{clearTimeout(timer)}
  const accessMetadata=response.headers.has("cf-ray")||response.headers.has("cf-access-domain");if(response.status>=300&&response.status<400)throw new CodexRunnerError(accessMetadata?"access_denied":"invalid_response");if(response.status===401||response.status===403)throw new CodexRunnerError(accessMetadata?"access_denied":"runner_unauthorized");if(!response.ok)throw new CodexRunnerError("runner_unavailable");const length=Number(response.headers.get("content-length")??0);if(length>MAX_RESPONSE_BYTES)throw new CodexRunnerError("invalid_response");const text=await response.text();if(Buffer.byteLength(text)>MAX_RESPONSE_BYTES)throw new CodexRunnerError("invalid_response");try{return JSON.parse(text) as unknown}catch{throw new CodexRunnerError("invalid_response")}}
 async capabilities():Promise<RunnerCapabilities>{const value=await this.request("/v1/capabilities") as Partial<RunnerCapabilities>;if(value.protocolVersion!==1)throw new CodexRunnerError("runner_update_required");if(!requiredString(value.runnerVersion)||typeof value.codexAvailable!=="boolean"||typeof value.deviceAuth!=="boolean"||typeof value.jobExecution!=="boolean")throw new CodexRunnerError("invalid_response");return value as RunnerCapabilities}
 async authStatus():Promise<RunnerAuthStatus>{const value=await this.request("/v1/auth/status") as Partial<RunnerAuthStatus>;if(typeof value.connected!=="boolean")throw new CodexRunnerError("invalid_response");return{connected:value.connected,...(requiredString(value.authMode)?{authMode:value.authMode}:{}),...(requiredString(value.planType)?{planType:value.planType}:{})}}
 async startDeviceAuth():Promise<RunnerDeviceCeremony>{const value=await this.request("/v1/auth/device/start","POST") as Partial<RunnerDeviceCeremony>;if(!requiredString(value.loginId)||!requiredString(value.verificationUrl)||!requiredString(value.userCode))throw new CodexRunnerError("invalid_response");return value as RunnerDeviceCeremony}
 async logout(){await this.request("/v1/auth/logout","POST");return{connected:false as const}}
}
export function getCodexRunnerClient(environment:Record<string,string|undefined>=process.env){return new CodexRunnerClient(readCodexRunnerConfiguration(environment))}
