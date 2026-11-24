import { createHmac, createPrivateKey, generateKeyPair, hkdfSync, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, isAbsolute, join } from "node:path";

const KEY_BYTES = 32;
const FILE_VERSION = 1;

export class RuntimeKeyError extends Error {
  constructor(readonly code: "root_key_missing" | "root_key_invalid" | "root_key_storage_unavailable" | "root_key_mismatch") {
    super(code);
  }
}

export class RuntimeRootKey {
  constructor(private readonly bytes: Buffer) {}

  fingerprint() {
    return createHmac("sha256", this.bytes).update("adt-runtime:installation-fingerprint:v1").digest("hex");
  }

  vaultKey(repositoryId: number, version: number) {
    if (!Number.isSafeInteger(repositoryId) || repositoryId < 1 || !Number.isSafeInteger(version) || version < 1) {
      throw new RuntimeKeyError("root_key_invalid");
    }
    return Buffer.from(hkdfSync("sha256", this.bytes, "adt-runtime:v1", `vault:${repositoryId}:${version}`, KEY_BYTES))
      .toString("base64");
  }
}

async function readProtectedFile(path: string, maxBytes: number) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new RuntimeKeyError("root_key_invalid");
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600 || stat.uid !== process.getuid?.() || stat.size > maxBytes) {
      throw new RuntimeKeyError("root_key_invalid");
    }
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
}

async function protectedFile(path:string,maxBytes:number,create?:()=>Promise<string>) {
  if (!isAbsolute(path)) throw new RuntimeKeyError("root_key_storage_unavailable");
  const directory = dirname(path);
  try {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || (stat.mode & 0o7777) !== 0o700 || stat.uid !== process.getuid?.()) throw new Error();
  } catch {
    throw new RuntimeKeyError("root_key_storage_unavailable");
  }
  const existing = await readProtectedFile(path,maxBytes);
  if (existing !== undefined) return existing;
  if (!create) throw new RuntimeKeyError("root_key_missing");
  const temporary = `${path}.${randomBytes(16).toString("hex")}.tmp`;
  try {
    const data=await create();
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(data); await file.sync(); }
    finally { await file.close(); }
    try { await link(temporary, path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    await unlink(temporary);
    const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
    try { await parent.sync(); }
    finally { await parent.close(); }
  } catch {
    await unlink(temporary).catch(() => undefined);
    throw new RuntimeKeyError("root_key_storage_unavailable");
  }
  const stored = await readProtectedFile(path,maxBytes);
  if (stored === undefined) throw new RuntimeKeyError("root_key_missing");
  return stored;
}

export async function loadRuntimeRootKey(path:string,allowCreation:boolean) {
  const stored=await protectedFile(path,128,allowCreation?async()=>JSON.stringify({
    version:FILE_VERSION,key:randomBytes(KEY_BYTES).toString("base64"),
  }):undefined);
  try {
    const value=JSON.parse(stored) as {version?:unknown;key?:unknown};
    if(value.version!==FILE_VERSION||typeof value.key!=="string")throw new Error();
    const bytes=Buffer.from(value.key,"base64");
    if(bytes.length!==KEY_BYTES||bytes.toString("base64")!==value.key)throw new Error();
    return new RuntimeRootKey(bytes);
  } catch { throw new RuntimeKeyError("root_key_invalid"); }
}

export async function generateRuntimeWrappingPrivateKey(){
  const result=await promisify(generateKeyPair)("rsa",{modulusLength:3072,privateKeyEncoding:{type:"pkcs8",format:"pem"},
    publicKeyEncoding:{type:"spki",format:"pem"}});
  return result.privateKey;
}

// A replacement wrapping key affects in-flight transport only. The database still requires its original root key.
export async function loadRuntimeWrappingPrivateKey(rootPath:string){
  const pem=await protectedFile(join(dirname(rootPath),"wrapping.pem"),16_384,generateRuntimeWrappingPrivateKey);
  if(createPrivateKey(pem).asymmetricKeyType!=="rsa")throw new Error("private_key_invalid");
  return pem;
}
