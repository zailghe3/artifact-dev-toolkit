export const mcpEndpointMessage = "Use an HTTPS endpoint without URL credentials, query parameters, or fragments. Configure authentication in the credential vault.";

export function parseMcpEndpoint(value: string | URL, allowLocalhost = false): URL | undefined {
  const input = typeof value === "string" ? value : value.href;
  if (input.length > 2048 || /[?#\\\s\p{Cc}]/u.test(input)) return;
  const authority = /^https?:\/\/([^/]+)/i.exec(input)?.[1];
  if (!authority || authority.includes("@")) return;
  const url = URL.parse(input);
  if (!url || url.username || url.password) return;
  if (url.protocol === "https:" || (allowLocalhost && url.protocol === "http:" && isMcpLocalhost(url))) return url;
}

export function isMcpLocalhost(url: URL) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
