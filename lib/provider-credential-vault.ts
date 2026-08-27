import {
  decryptVaultCredential,
  encryptVaultCredential,
  type ProviderCredentialVaultKeyResolver,
} from "./provider-credential-vault-crypto.ts";

const SECRET_ID_PATTERN = /^sec_[A-Za-z0-9_-]{43}$/;

export type ProviderCredentialVaultDatabase = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<{meta?: {changes?: number}}>;
    };
  };
};

type VaultRow = {
  secret_id: string;
  encrypted_credential: string;
  credential_iv: string;
  encryption_version: number;
  master_key_version: number;
  created_at: string;
  updated_at: string;
};

export type ProviderCredentialVaultServiceErrorCode =
  | "vault_secret_id_invalid"
  | "vault_secret_exists"
  | "vault_secret_unavailable"
  | "vault_persistence_failed";

export class ProviderCredentialVaultServiceError extends Error {
  readonly code: ProviderCredentialVaultServiceErrorCode;
  constructor(code: ProviderCredentialVaultServiceErrorCode) {
    super(code);
    this.code = code;
  }
}

export function isProviderCredentialVaultSecretId(value: string) {
  return SECRET_ID_PATTERN.test(value);
}

export function generateProviderCredentialVaultSecretId() {
  return `sec_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
}

function assertSecretId(secretId: string) {
  if (!isProviderCredentialVaultSecretId(secretId)) throw new ProviderCredentialVaultServiceError("vault_secret_id_invalid");
}

function changes(result: {meta?: {changes?: number}}) {
  return result.meta?.changes ?? 0;
}

/** Server-only credential storage. No safe descriptor or browser serialization is exposed here. */
export class D1ProviderCredentialVault {
  private readonly db: ProviderCredentialVaultDatabase;
  private readonly resolveKey: ProviderCredentialVaultKeyResolver;
  private readonly activeMasterKeyVersion: number;
  private readonly generateSecretId: () => string;
  constructor(
    db: ProviderCredentialVaultDatabase,
    resolveKey: ProviderCredentialVaultKeyResolver,
    activeMasterKeyVersion = 1,
    generateSecretId: () => string = generateProviderCredentialVaultSecretId,
  ) {
    this.db = db;
    this.resolveKey = resolveKey;
    this.activeMasterKeyVersion = activeMasterKeyVersion;
    this.generateSecretId = generateSecretId;
  }

  private async row(secretId: string) {
    return this.db.prepare("SELECT * FROM provider_credential_vault WHERE secret_id = ?").bind(secretId).first<VaultRow>();
  }

  private async insert(secretId: string, credential: string) {
    const encrypted = await encryptVaultCredential(credential, secretId, this.resolveKey, this.activeMasterKeyVersion);
    const now = new Date().toISOString();
    try {
      await this.db.prepare("INSERT INTO provider_credential_vault(secret_id,encrypted_credential,credential_iv,encryption_version,master_key_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
        .bind(secretId, encrypted.ciphertext, encrypted.iv, encrypted.encryptionVersion, encrypted.masterKeyVersion, now, now).run();
    } catch {
      if (await this.row(secretId)) throw new ProviderCredentialVaultServiceError("vault_secret_exists");
      throw new ProviderCredentialVaultServiceError("vault_persistence_failed");
    }
  }

  async create(credential: string) {
    const secretId = this.generateSecretId();
    assertSecretId(secretId);
    await this.insert(secretId, credential);
    return secretId;
  }

  async resolve(secretId: string) {
    assertSecretId(secretId);
    const row = await this.row(secretId);
    if (!row) throw new ProviderCredentialVaultServiceError("vault_secret_unavailable");
    return decryptVaultCredential({
      ciphertext: row.encrypted_credential,
      iv: row.credential_iv,
      encryptionVersion: row.encryption_version,
      masterKeyVersion: row.master_key_version,
    }, secretId, this.resolveKey);
  }

  async replace(secretId: string, credential: string) {
    assertSecretId(secretId);
    const encrypted = await encryptVaultCredential(credential, secretId, this.resolveKey, this.activeMasterKeyVersion);
    const result = await this.db.prepare("UPDATE provider_credential_vault SET encrypted_credential = ?, credential_iv = ?, encryption_version = ?, master_key_version = ?, updated_at = ? WHERE secret_id = ?")
      .bind(encrypted.ciphertext, encrypted.iv, encrypted.encryptionVersion, encrypted.masterKeyVersion, new Date().toISOString(), secretId).run();
    if (changes(result) !== 1) throw new ProviderCredentialVaultServiceError("vault_secret_unavailable");
  }

  async delete(secretId: string) {
    assertSecretId(secretId);
    await this.db.prepare("DELETE FROM provider_credential_vault WHERE secret_id = ?").bind(secretId).run();
  }

  async recover(secretId: string, credential: string) {
    assertSecretId(secretId);
    await this.insert(secretId, credential);
  }
}
