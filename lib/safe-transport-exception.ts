import type {ProviderRuntimeErrorName,ProviderTransportReason} from "./workflow-adapter.ts";

const names=new Set<ProviderRuntimeErrorName>(["TypeError","AbortError","Error"]);
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);

/** Reduce a platform exception to allowlisted metadata; raw messages never escape. */
export function classifyTransportException(error:unknown):{reason:ProviderTransportReason;runtimeErrorName?:ProviderRuntimeErrorName}{
 const values:unknown[]=[error];if(object(error)&&"cause" in error)values.push(error.cause);
 const messages=values.flatMap(value=>object(value)&&typeof value.message==="string"?[value.message.toLowerCase()]:[]);
 const name=values.flatMap(value=>object(value)&&typeof value.name==="string"?[value.name]:[]).find(value=>names.has(value as ProviderRuntimeErrorName)) as ProviderRuntimeErrorName|undefined;
 const reason:ProviderTransportReason=messages.some(value=>value.includes("cannot perform i/o on behalf of a different request")||value.includes("different request context"))?"cross_request_io":messages.some(value=>value.includes("outside of a request context")||value.includes("outside a valid request context")||value.includes("no request context")||value.includes("invalid request context"))?"invalid_request_context":messages.some(value=>value.includes("network connection lost"))?"network_connection_lost":name==="AbortError"?"aborted":name==="TypeError"?"fetch_type_error":"unknown";
 return{reason,runtimeErrorName:name};
}
export const isLocalRuntimeTransportRejection=(reason:ProviderTransportReason)=>reason==="cross_request_io"||reason==="invalid_request_context";
