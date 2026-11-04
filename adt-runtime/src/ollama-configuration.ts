/** Shared, dependency-free trust-target validation for the Worker and Runtime. */
export type OllamaConfiguration={baseUrl:string;authMode:"none"|"bearer"};
export function normalizeOllamaBaseUrl(value:unknown):string{
 if(typeof value!=="string"||!value||value.length>2048||value!==value.trim()||/[\s\\?#@]/.test(value))throw new Error("ollama_configuration_invalid");
 let url:URL;try{url=new URL(value)}catch{throw new Error("ollama_configuration_invalid")}
 // Validate the supplied path too: URL parsing must not erase dot segments.
 if(!/^https?:\/\/[^/]+\/?$/i.test(value)||!["http:","https:"].includes(url.protocol)||url.username||url.password||!url.hostname||url.pathname!=="/"||url.search||url.hash)throw new Error("ollama_configuration_invalid");
 return url.origin;
}
export function parseOllamaConfiguration(value:unknown):OllamaConfiguration{
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("ollama_configuration_invalid");
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(key=>key!=="baseUrl"&&key!=="authMode")||(v.authMode!=="none"&&v.authMode!=="bearer"))throw new Error("ollama_configuration_invalid");
 return{baseUrl:normalizeOllamaBaseUrl(v.baseUrl),authMode:v.authMode};
}
export function parseOllamaAllowedBaseUrls(value:string|undefined):ReadonlySet<string>{
 if(value===undefined||value==="")return new Set();
 if(value.length>32*2049)throw new Error("ollama_allowlist_invalid");
 const entries=value.split(",");if(entries.length>32)throw new Error("ollama_allowlist_invalid");
 try{return new Set(entries.map(entry=>normalizeOllamaBaseUrl(entry.trim())))}catch{throw new Error("ollama_allowlist_invalid")}
}
export function assertOllamaEndpoint(configuration:OllamaConfiguration,allowed:ReadonlySet<string>){
 const safe=parseOllamaConfiguration(configuration);
 if(!allowed.has(safe.baseUrl))throw new Error("ollama_endpoint_not_allowed");
 return safe;
}
