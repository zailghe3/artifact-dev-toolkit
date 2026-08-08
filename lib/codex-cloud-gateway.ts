import type {FailureCategory} from "./workflow-adapter.ts";

export type CodexTaskStart={environmentId:string;prompt:string;idempotencyKey:string};
export type CodexTaskStatus={state:"pending";pollAfterMs?:number;taskUrl?:string}|{state:"completed";outputText:string;taskUrl?:string;pullRequest?:{url:string;number?:number}}|{state:"failed";category:FailureCategory;retryable:boolean;safeMessage:string};
export type CodexPublishStatus={state:"pending";pollAfterMs?:number}|{state:"completed";pullRequestUrl:string;pullRequestNumber?:number};
export interface CodexCloudGateway{start(input:CodexTaskStart):Promise<{taskId:string;taskUrl?:string}>;check(taskId:string):Promise<CodexTaskStatus>;publishPullRequest?(taskId:string,idempotencyKey:string):Promise<CodexPublishStatus>;cancel?(taskId:string):Promise<"cancelled"|"already_terminal"|"unsupported">}

/** Production deliberately fails closed until OpenAI documents a server-to-server Cloud task lifecycle. */
export class UnavailableCodexCloudGateway implements CodexCloudGateway{
 async start(_input:CodexTaskStart):Promise<never>{throw Object.assign(new Error("Codex Cloud transport unavailable."),{category:"connection_unavailable"});}
 async check(_taskId:string):Promise<never>{throw Object.assign(new Error("Codex Cloud transport unavailable."),{category:"connection_unavailable"});}
}

export type MockCodexFixture={checks?:CodexTaskStatus[];publications?:Array<CodexPublishStatus|Error>;startError?:Error;cancellation?:"cancelled"|"already_terminal"|"unsupported"};
export class DeterministicMockCodexCloudGateway implements CodexCloudGateway{
 starts:CodexTaskStart[]=[];checks=0;publications=0;cancels=0;
 private fixture:MockCodexFixture;
 constructor(fixture:MockCodexFixture={}){this.fixture=fixture;}
 async start(input:CodexTaskStart){this.starts.push(structuredClone(input));if(this.fixture.startError)throw this.fixture.startError;return{taskId:`codex-${input.idempotencyKey}`,taskUrl:"https://chatgpt.com/codex/tasks/mock"};}
 async check(_taskId:string){const index=this.checks++;return this.fixture.checks?.[Math.min(index,this.fixture.checks.length-1)]??{state:"completed",outputText:"Coding complete.",taskUrl:"https://chatgpt.com/codex/tasks/mock"};}
 async publishPullRequest(_taskId:string,_key:string){const index=this.publications++;const value=this.fixture.publications?.[Math.min(index,this.fixture.publications.length-1)]??{state:"completed",pullRequestUrl:"https://github.com/example/project/pull/1",pullRequestNumber:1};if(value instanceof Error)throw value;return value;}
 async cancel(_taskId:string){this.cancels++;return this.fixture.cancellation??"cancelled";}
}
