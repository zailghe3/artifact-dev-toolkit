import type {DeviceAuthFailureReason} from "./app-server-client.js";
export interface SafeErrorDetails{deviceAuthReason?:DeviceAuthFailureReason;upstreamHttpStatus?:number;jsonRpcCode?:number}
export class SafeError extends Error { constructor(public readonly code:string,public readonly status:number,public readonly details:SafeErrorDetails={}){super(code)} }
export function safeError(error:unknown){return error instanceof SafeError?error:new SafeError("runner_internal_error",500)}
