import {z} from "zod";
import {modelProgressSchema,conversationSchema,toolProposalSchema} from "./agent-contract.js";
import {envelopeSchema,PROTOCOL_VERSION} from "./protocol.js";
const base={protocolVersion:z.literal(PROTOCOL_VERSION),requestId:z.string().uuid(),capability:z.literal("agent:progress-v1")};
export const progressWireSchema=z.object({...base,request:modelProgressSchema,credential:envelopeSchema.optional()}).strict();
export const exactToolWireSchema=z.object({...base,admissionId:z.string().uuid(),invocationId:z.string().min(1).max(256),fingerprint:z.string().min(1).max(100),server:z.object({url:z.string().url().max(2048),transport:z.literal("streamable-http")}).strict(),tool:z.object({name:z.string().min(1).max(128),description:z.string().max(2048).optional(),inputSchema:z.record(z.string(),z.unknown())}).strict(),arguments:z.record(z.string(),z.unknown()),credential:envelopeSchema.optional()}).strict();
export const securityWireSchema=z.object({...base,profile:z.object({profileId:z.string().max(80),endpointUrl:z.string().url().refine(v=>new URL(v).protocol==="wss:"),decisionTimeoutMs:z.number().int().min(250).max(30000)}).strict(),credential:envelopeSchema,context:z.object({id:z.string().max(256),model:z.string().max(120),instructions:z.string().max(262144),conversation:conversationSchema,call:toolProposalSchema}).strict()}).strict();
