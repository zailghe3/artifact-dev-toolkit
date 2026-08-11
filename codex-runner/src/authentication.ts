import {AppServerRequestError,type AccountSnapshot,type AppServerClient,type DeviceCeremony} from "./app-server-client.js";
import {SafeError} from "./errors.js";
const string=(v:unknown)=>typeof v==="string"?v:undefined;
export class AuthenticationService{
  constructor(private readonly client:AppServerClient){}
  async status():Promise<AccountSnapshot>{try{const raw=await this.client.status() as Record<string,unknown>;const account=(raw?.account??{}) as Record<string,unknown>;const connected=Boolean(raw?.account&&(account?.authMode??account?.type));const result:AccountSnapshot={connected,runtime:"app-server-ready"};const authMode=string(account?.authMode??account?.type),planType=string(account?.planType);if(authMode)result.authMode=authMode;if(planType)result.planType=planType;return result;}catch{throw new SafeError("codex_auth_unavailable",503)}}
  async startDevice():Promise<DeviceCeremony>{try{const raw=await this.client.startDeviceLogin() as Record<string,unknown>;const result={loginId:string(raw.loginId??raw.id),verificationUrl:string(raw.verificationUrl??raw.verificationUri),userCode:string(raw.userCode)};if(!result.loginId||!result.verificationUrl||!result.userCode)throw new Error();return result as DeviceCeremony;}catch(error){throw new SafeError("device_auth_start_failed",503,error instanceof AppServerRequestError?{deviceAuthReason:error.reason,jsonRpcCode:error.jsonRpcCode,...(error.upstreamHttpStatus?{upstreamHttpStatus:error.upstreamHttpStatus}:{})}:{deviceAuthReason:"device_auth_unknown"})}}
  async logout(){try{await this.client.logout();return{connected:false};}catch{throw new SafeError("codex_logout_failed",503)}}
}
