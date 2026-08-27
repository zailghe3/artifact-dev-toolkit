export const PROVIDER_CREDENTIAL_VAULT_ENCRYPTION_VERSION = 1 as const;
export const PROVIDER_CREDENTIAL_VAULT_MASTER_KEY_VERSION = 1 as const;
export const MAX_PROVIDER_CREDENTIAL_LENGTH = 8192;

export type ProviderCredentialVaultEnvelope = {
  ciphertext: string;
  iv: string;
  encryptionVersion: number;
  masterKeyVersion: number;
};

export type ProviderCredentialVaultKeyResolver = (version: number) => string | undefined;
export type ProviderCredentialVaultErrorCode =
  | "vault_credential_empty"
  | "vault_credential_too_large"
  | "vault_encryption_version_unsupported"
  | "vault_master_key_unavailable"
  | "vault_master_key_invalid"
  | "vault_encryption_failed"
  | "vault_decryption_failed";

export class ProviderCredentialVaultError extends Error {
  readonly code: ProviderCredentialVaultErrorCode;
  constructor(code: ProviderCredentialVaultErrorCode) {
    super(code);
    this.code = code;
  }
}

const encoder = new TextEncoder();

function validateCredential(credential: string) {
  if (credential.length === 0) throw new ProviderCredentialVaultError("vault_credential_empty");
  if (credential.length > MAX_PROVIDER_CREDENTIAL_LENGTH) throw new ProviderCredentialVaultError("vault_credential_too_large");
}

function decodeMasterKey(value: string | undefined) {
  if (value === undefined) throw new ProviderCredentialVaultError("vault_master_key_unavailable");
  try {
    const bytes = Uint8Array.from(Buffer.from(value, "base64"));
    if (bytes.length !== 32 || Buffer.from(bytes).toString("base64") !== value) throw new Error();
    return bytes;
  } catch {
    throw new ProviderCredentialVaultError("vault_master_key_invalid");
  }
}

function decodeBase64(value: string) {
  const bytes = Uint8Array.from(Buffer.from(value, "base64"));
  if (Buffer.from(bytes).toString("base64") !== value) throw new Error();
  return bytes;
}

function aad(secretId: string, encryptionVersion: number, masterKeyVersion: number) {
  return encoder.encode(`adt-provider-credential-vault:encryption-v${encryptionVersion}:master-key-v${masterKeyVersion}:secret:${secretId}`);
}

export function providerCredentialVaultV1KeyResolver(root: string | undefined): ProviderCredentialVaultKeyResolver {
  return version => version === PROVIDER_CREDENTIAL_VAULT_MASTER_KEY_VERSION ? root : undefined;
}

export async function encryptVaultCredential(
  credential: string,
  secretId: string,
  resolveKey: ProviderCredentialVaultKeyResolver,
  masterKeyVersion: number = PROVIDER_CREDENTIAL_VAULT_MASTER_KEY_VERSION,
): Promise<ProviderCredentialVaultEnvelope> {
  validateCredential(credential);
  try {
    const key = await crypto.subtle.importKey("raw", decodeMasterKey(resolveKey(masterKeyVersion)), "AES-GCM", false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({
      name: "AES-GCM",
      iv,
      additionalData: aad(secretId, PROVIDER_CREDENTIAL_VAULT_ENCRYPTION_VERSION, masterKeyVersion),
      tagLength: 128,
    }, key, encoder.encode(credential));
    return {
      ciphertext: Buffer.from(ciphertext).toString("base64"),
      iv: Buffer.from(iv).toString("base64"),
      encryptionVersion: PROVIDER_CREDENTIAL_VAULT_ENCRYPTION_VERSION,
      masterKeyVersion,
    };
  } catch (error) {
    if (error instanceof ProviderCredentialVaultError) throw error;
    throw new ProviderCredentialVaultError("vault_encryption_failed");
  }
}

export async function decryptVaultCredential(
  envelope: ProviderCredentialVaultEnvelope,
  secretId: string,
  resolveKey: ProviderCredentialVaultKeyResolver,
) {
  if (envelope.encryptionVersion !== PROVIDER_CREDENTIAL_VAULT_ENCRYPTION_VERSION) {
    throw new ProviderCredentialVaultError("vault_encryption_version_unsupported");
  }
  try {
    const key = await crypto.subtle.importKey("raw", decodeMasterKey(resolveKey(envelope.masterKeyVersion)), "AES-GCM", false, ["decrypt"]);
    const iv = decodeBase64(envelope.iv);
    const ciphertext = decodeBase64(envelope.ciphertext);
    if (iv.length !== 12) throw new Error();
    const cleartext = await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv,
      additionalData: aad(secretId, envelope.encryptionVersion, envelope.masterKeyVersion),
      tagLength: 128,
    }, key, ciphertext);
    return new TextDecoder().decode(cleartext);
  } catch (error) {
    if (error instanceof ProviderCredentialVaultError) throw error;
    throw new ProviderCredentialVaultError("vault_decryption_failed");
  }
}
