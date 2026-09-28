import type {Model,ModelProvider,ModelRequest,ModelResponse,ModelRetryAdviceRequest} from "@openai/agents";

export type ModelTurnInstrumentation={modelTurnStarted(input:{turnId:string;model:string;request:ModelRequest}):Promise<void>;modelTurnCompleted(input:{turnId:string;model:string;response:ModelResponse}):Promise<void>;modelTurnFailed?(input:{turnId:string;model:string;error:unknown}):Promise<void>};

class InstrumentedModel implements Model{
 private turn=0;
 constructor(private readonly model:string,private readonly delegate:Model,private readonly executionId:string,private readonly instrumentation:ModelTurnInstrumentation){}
 async getResponse(request:ModelRequest){
  const turnId=`${this.executionId}:turn:${++this.turn}`;await this.instrumentation.modelTurnStarted({turnId,model:this.model,request});
  try{const response=await this.delegate.getResponse(request);await this.instrumentation.modelTurnCompleted({turnId,model:this.model,response});return response}catch(error){await this.instrumentation.modelTurnFailed?.({turnId,model:this.model,error});throw error}
 }
 getStreamedResponse(request:ModelRequest){return this.delegate.getStreamedResponse(request)}
 getRetryAdvice(request:ModelRetryAdviceRequest){return this.delegate.getRetryAdvice?.(request)}
}

/** Public ModelProvider decorator; it does not intercept or replace provider transport. */
export class InstrumentedModelProvider implements ModelProvider{
 constructor(private readonly delegate:ModelProvider,private readonly executionId:string,private readonly instrumentation:ModelTurnInstrumentation){}
 async getModel(modelName?:string){const model=await this.delegate.getModel(modelName);return new InstrumentedModel(modelName??"unknown",model,this.executionId,this.instrumentation)}
}
