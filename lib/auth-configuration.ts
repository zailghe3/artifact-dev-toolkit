export type AuthenticationConfigurationErrorCode =
  | "missing_configuration"
  | "invalid_session_secret"
  | "invalid_encryption_key_format"
  | "invalid_encryption_key_length"
  | "invalid_private_key";

/** A deliberately value-free configuration failure safe for structured logs. */
export class AuthenticationConfigurationError extends Error {
  readonly code: AuthenticationConfigurationErrorCode;
  readonly missingNames?: string[];

  constructor(code: AuthenticationConfigurationErrorCode, missingNames?: string[]) {
    super(code);
    this.name = "AuthenticationConfigurationError";
    this.code = code;
    this.missingNames = missingNames?.slice().sort();
  }
}

export function requireAuthenticationValues<const T extends readonly string[]>(names: T): Record<T[number], string> {
  const missingNames = names.filter((name) => !process.env[name]?.trim());
  if (missingNames.length) throw new AuthenticationConfigurationError("missing_configuration", missingNames);
  return Object.fromEntries(names.map((name) => [name, process.env[name]!.trim()])) as Record<T[number], string>;
}

export function getOAuthStartConfig() {
  const values = requireAuthenticationValues(["GITHUB_APP_CLIENT_ID"] as const);
  return { clientId: values.GITHUB_APP_CLIENT_ID };
}

export function getOAuthExchangeConfig() {
  const values = requireAuthenticationValues(["GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET"] as const);
  return { clientId: values.GITHUB_APP_CLIENT_ID, clientSecret: values.GITHUB_APP_CLIENT_SECRET };
}

export function validateTokenEncryptionKey(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.startsWith('"') || normalized.endsWith('"') || normalized.startsWith("'") || normalized.endsWith("'")) {
    throw new AuthenticationConfigurationError("invalid_encryption_key_format");
  }
  // Deliberately accept canonical base64 only; base64url must not be silently reinterpreted.
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    throw new AuthenticationConfigurationError("invalid_encryption_key_format");
  }
  let bytes: Uint8Array;
  try {
    const binary = atob(normalized);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new AuthenticationConfigurationError("invalid_encryption_key_format");
  }
  if (bytes.byteLength !== 32) throw new AuthenticationConfigurationError("invalid_encryption_key_length");
  return bytes;
}

export function getSessionSecurityConfig() {
  const values = requireAuthenticationValues(["SESSION_SECRET", "GITHUB_TOKEN_ENCRYPTION_KEY"] as const);
  if (values.SESSION_SECRET.length < 32) throw new AuthenticationConfigurationError("invalid_session_secret");
  validateTokenEncryptionKey(values.GITHUB_TOKEN_ENCRYPTION_KEY);
  return { sessionSecret: values.SESSION_SECRET, tokenEncryptionKey: values.GITHUB_TOKEN_ENCRYPTION_KEY };
}

export async function validateProductionAuthReadiness() {
  const values = requireAuthenticationValues(["ARTIFACT_REPOSITORY", "GITHUB_APP_ID", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "GITHUB_TOKEN_ENCRYPTION_KEY", "GITHUB_ARTIFACT_REPOSITORY_OWNER", "GITHUB_ARTIFACT_REPOSITORY_NAME", "SESSION_SECRET"] as const);
  if (values.ARTIFACT_REPOSITORY !== "github") throw new AuthenticationConfigurationError("missing_configuration", ["ARTIFACT_REPOSITORY"]);
  getOAuthExchangeConfig();
  getSessionSecurityConfig();
  const { validateGitHubAppPrivateKey } = await import("./github-app.ts");
  await validateGitHubAppPrivateKey(values.GITHUB_APP_PRIVATE_KEY);
  return getOAuthStartConfig();
}
