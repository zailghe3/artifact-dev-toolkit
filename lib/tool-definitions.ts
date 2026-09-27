import {z} from "zod";
import {DEFINITION_ID} from "./workflow-definitions.ts";

const id=z.string().regex(DEFINITION_ID).max(80);
const jsonSchema=z.record(z.string(),z.unknown());
export const mcpCatalogueToolSchema=z.object({name:z.string().trim().min(1).max(128),description:z.string().max(2048).optional(),inputSchema:jsonSchema}).strict();
export const mcpServerDefinitionSchema=z.object({schemaVersion:z.literal(1),id,name:z.string().trim().min(1).max(120),type:z.literal("mcp"),transport:z.literal("streamable-http"),endpointUrl:z.string().url().max(2048).refine(value=>new URL(value).protocol==="https:","MCP endpoints must use HTTPS."),authentication:z.discriminatedUnion("mode",[z.object({mode:z.literal("none")}).strict(),z.object({mode:z.literal("bearer"),credentialSecretRef:z.string().regex(/^sec_[A-Za-z0-9_-]{43}$/)}).strict()]),catalogue:z.object({tools:z.array(mcpCatalogueToolSchema).max(128),refreshedAt:z.string().datetime()}).strict().optional()}).strict();
export type McpServerDefinition=z.infer<typeof mcpServerDefinitionSchema>;
export type SafeMcpServer=Omit<McpServerDefinition,"authentication">&{authentication:{mode:"none"|"bearer";credentialConfigured:boolean}};
export const safeMcpServer=(server:McpServerDefinition):SafeMcpServer=>({...server,authentication:{mode:server.authentication.mode,credentialConfigured:server.authentication.mode==="bearer"}});
export const MCP_SERVER_ROOT="tools",MCP_SERVER_SUFFIX=".mcp.json";
export function mcpServerPath(idValue:string){const value=id.parse(idValue);return `${MCP_SERVER_ROOT}/${value}${MCP_SERVER_SUFFIX}`}
