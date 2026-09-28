import {
  decryptVaultCredential,
  encryptVaultCredential,
  type ProviderCredentialVaultKeyResolver,
} from "./provider-credential-vault-crypto.ts";

const SECRET_ID_PATTERN = /^sec_[A-Za-z0-9_-]{43}$/;
const MCP_BINDING_ID_PATTERN=/^mcpb_[A-Za-z0-9_-]{43}$/;

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
  revision: number;
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
  private readonly generateBindingId:()=>string;
  constructor(
    db: ProviderCredentialVaultDatabase,
    resolveKey: ProviderCredentialVaultKeyResolver,
    activeMasterKeyVersion = 1,
    generateSecretId: () => string = generateProviderCredentialVaultSecretId,
    generateBindingId:()=>string=()=>`mcpb_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`,
  ) {
    this.db = db;
    this.resolveKey = resolveKey;
    this.activeMasterKeyVersion = activeMasterKeyVersion;
    this.generateSecretId = generateSecretId;
    this.generateBindingId=generateBindingId;
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

  private assertMcpIdentity(repositoryId:number,serverId:string,bindingId?:string){
    if(!Number.isSafeInteger(repositoryId)||repositoryId<1)throw new ProviderCredentialVaultServiceError("vault_persistence_failed");
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(serverId))throw new ProviderCredentialVaultServiceError("vault_persistence_failed");
    if(bindingId&&!MCP_BINDING_ID_PATTERN.test(bindingId))throw new ProviderCredentialVaultServiceError("vault_persistence_failed");
  }
  private async mcpBinding(repositoryId:number,serverId:string){return this.db.prepare("SELECT binding_id,secret_id FROM mcp_server_credentials WHERE repository_id=? AND server_id=?").bind(repositoryId,serverId).first<{binding_id:string;secret_id:string}>();}
  async ensureMcpServerCredentialBinding(repositoryId:number,serverId:string,secretId:string){this.assertMcpIdentity(repositoryId,serverId);assertSecretId(secretId);const current=await this.mcpBinding(repositoryId,serverId);if(current){if(current.secret_id!==secretId)throw new ProviderCredentialVaultServiceError("vault_persistence_failed");return current.binding_id}const bindingId=this.generateBindingId();this.assertMcpIdentity(repositoryId,serverId,bindingId);try{await this.db.prepare("INSERT INTO mcp_server_credentials(repository_id,server_id,binding_id,secret_id,updated_at) VALUES(?,?,?,?,?)").bind(repositoryId,serverId,bindingId,secretId,new Date().toISOString()).run()}catch{const raced=await this.mcpBinding(repositoryId,serverId);if(raced?.secret_id===secretId)return raced.binding_id;throw new ProviderCredentialVaultServiceError("vault_persistence_failed")}return bindingId;}
  async rotateMcpServerCredential(repositoryId:number,serverId:string,bindingId:string,secretId:string,expectedSecretId:string){this.assertMcpIdentity(repositoryId,serverId,bindingId);assertSecretId(secretId);assertSecretId(expectedSecretId);const result=await this.db.prepare("UPDATE mcp_server_credentials SET secret_id=?,updated_at=? WHERE repository_id=? AND server_id=? AND binding_id=? AND secret_id=?").bind(secretId,new Date().toISOString(),repositoryId,serverId,bindingId,expectedSecretId).run();if(changes(result)!==1)throw new ProviderCredentialVaultServiceError("vault_persistence_failed");}
  async replaceMcpServerCredentialBinding(repositoryId:number,serverId:string,oldBindingId:string,secretId:string){this.assertMcpIdentity(repositoryId,serverId,oldBindingId);assertSecretId(secretId);const bindingId=this.generateBindingId();this.assertMcpIdentity(repositoryId,serverId,bindingId);const result=await this.db.prepare("UPDATE mcp_server_credentials SET binding_id=?,secret_id=?,updated_at=? WHERE repository_id=? AND server_id=? AND binding_id=?").bind(bindingId,secretId,new Date().toISOString(),repositoryId,serverId,oldBindingId).run();if(changes(result)!==1)throw new ProviderCredentialVaultServiceError("vault_persistence_failed");return bindingId;}
  async restoreMcpServerCredentialBinding(repositoryId:number,serverId:string,bindingId:string,secretId:string){this.assertMcpIdentity(repositoryId,serverId,bindingId);assertSecretId(secretId);const current=await this.mcpBinding(repositoryId,serverId);if(current?.binding_id===bindingId&&current.secret_id===secretId)return;if(current)await this.db.prepare("UPDATE mcp_server_credentials SET binding_id=?,secret_id=?,updated_at=? WHERE repository_id=? AND server_id=?").bind(bindingId,secretId,new Date().toISOString(),repositoryId,serverId).run();else await this.db.prepare("INSERT INTO mcp_server_credentials(repository_id,server_id,binding_id,secret_id,updated_at) VALUES(?,?,?,?,?)").bind(repositoryId,serverId,bindingId,secretId,new Date().toISOString()).run();}
  async resolveMcpServerCredential(repositoryId:number,bindingId:string){
    this.assertMcpIdentity(repositoryId,"binding",bindingId);const row=await this.db.prepare("SELECT secret_id FROM mcp_server_credentials WHERE repository_id=? AND binding_id=?").bind(repositoryId,bindingId).first<{secret_id:string}>();
    if(!row)throw new ProviderCredentialVaultServiceError("vault_secret_unavailable");
    return this.resolve(row.secret_id);
  }

  async revokeMcpServerCredentialBinding(repositoryId:number,serverId:string,bindingId:string){this.assertMcpIdentity(repositoryId,serverId,bindingId);const result=await this.db.prepare("DELETE FROM mcp_server_credentials WHERE repository_id=? AND server_id=? AND binding_id=?").bind(repositoryId,serverId,bindingId).run();if(changes(result)!==1)throw new ProviderCredentialVaultServiceError("vault_persistence_failed");}

  async resolveWithRevision(secretId: string) {
    assertSecretId(secretId);
    const row = await this.row(secretId);
    if (!row) throw new ProviderCredentialVaultServiceError("vault_secret_unavailable");
    const value = await decryptVaultCredential({ ciphertext: row.encrypted_credential, iv: row.credential_iv, encryptionVersion: row.encryption_version, masterKeyVersion: row.master_key_version }, secretId, this.resolveKey);
    return { value, revision: row.revision ?? 1 };
  }

  async replaceIfRevision(secretId: string, expectedRevision: number, credential: string) {
    assertSecretId(secretId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new ProviderCredentialVaultServiceError("vault_persistence_failed");
    const encrypted = await encryptVaultCredential(credential, secretId, this.resolveKey, this.activeMasterKeyVersion);
    const result = await this.db.prepare("UPDATE provider_credential_vault SET encrypted_credential = ?, credential_iv = ?, encryption_version = ?, master_key_version = ?, revision = revision + 1, updated_at = ? WHERE secret_id = ? AND revision = ?")
      .bind(encrypted.ciphertext, encrypted.iv, encrypted.encryptionVersion, encrypted.masterKeyVersion, new Date().toISOString(), secretId, expectedRevision).run();
    return changes(result) === 1;
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
