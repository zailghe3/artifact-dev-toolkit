import {readBoundedJson} from "./bounded-json.ts";
export const RUNTIME_GATEWAY_REQUEST_LIMITS={checkpoint:1_000_000,"graph-node":270_000,"artifact-search":2_048} as const;
export type RuntimeGatewayRequestKind=keyof typeof RUNTIME_GATEWAY_REQUEST_LIMITS;
export function readRuntimeGatewayRequest(request:Request,kind:RuntimeGatewayRequestKind){return readBoundedJson(request,RUNTIME_GATEWAY_REQUEST_LIMITS[kind])}
