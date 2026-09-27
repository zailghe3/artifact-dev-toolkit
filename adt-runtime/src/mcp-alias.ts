import {createHash} from "node:crypto";
const safe=(value:string)=>value.replace(/[^A-Za-z0-9_-]/g,"_").replace(/^[^A-Za-z_]/,"_").slice(0,30)||"tool";
/** mcp_<remote prefix>_<22-char identity hash>; authority remains server ID + remote name. */
export function mcpToolAlias(serverId:string,remoteName:string){const hash=createHash("sha256").update(`${serverId}\0${remoteName}`).digest("base64url").slice(0,22);return `mcp_${safe(remoteName)}_${hash}`}
