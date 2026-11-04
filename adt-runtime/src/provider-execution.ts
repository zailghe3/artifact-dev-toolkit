/** Safe failures shared by all provider executors. Never retain upstream errors. */
export type SafeFailure = {category:string;safeMessage:string;retryable:false};
export class RuntimeFailure extends Error implements SafeFailure {
 readonly retryable=false as const;
 constructor(readonly category:string,readonly safeMessage:string){super(category)}
}
export const MAX_PROVIDER_OUTPUT_BYTES=262_144;
export function boundedProviderOutput(value:string){
 if(Buffer.byteLength(value,"utf8")>MAX_PROVIDER_OUTPUT_BYTES)throw new RuntimeFailure("output_too_large","Provider output exceeded the permitted size.");
 return value;
}
