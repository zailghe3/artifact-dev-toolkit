export class SafeError extends Error { constructor(public readonly code:string,public readonly status:number){super(code)} }
export function safeError(error:unknown){return error instanceof SafeError?error:new SafeError("runner_internal_error",500)}
