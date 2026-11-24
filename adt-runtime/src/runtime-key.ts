import { createHmac, hkdfSync, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, unlink } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

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

async function readKeyFile(path: string) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new RuntimeKeyError("root_key_invalid");
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600 || stat.uid !== process.getuid?.() || stat.size > 128) {
      throw new RuntimeKeyError("root_key_invalid");
    }
    const value = JSON.parse(await file.readFile("utf8")) as { version?: unknown; key?: unknown };
    if (value.version !== FILE_VERSION || typeof value.key !== "string") throw new RuntimeKeyError("root_key_invalid");
    const bytes = Buffer.from(value.key, "base64");
    if (bytes.byteLength !== KEY_BYTES || bytes.toString("base64") !== value.key) {
      throw new RuntimeKeyError("root_key_invalid");
    }
    return new RuntimeRootKey(bytes);
  } catch {
    throw new RuntimeKeyError("root_key_invalid");
  } finally {
    await file.close();
  }
}

export async function loadRuntimeRootKey(path: string, allowCreation: boolean) {
  if (!isAbsolute(path)) throw new RuntimeKeyError("root_key_storage_unavailable");
  const directory = dirname(path);
  try {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || (stat.mode & 0o7777) !== 0o700 || stat.uid !== process.getuid?.()) {
      throw new RuntimeKeyError("root_key_storage_unavailable");
    }
  } catch {
    throw new RuntimeKeyError("root_key_storage_unavailable");
  }

  const existing = await readKeyFile(path);
  if (existing) return existing;
  if (!allowCreation) throw new RuntimeKeyError("root_key_missing");

  const temporary = `${path}.${randomBytes(16).toString("hex")}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify({ version: FILE_VERSION, key: randomBytes(KEY_BYTES).toString("base64") }));
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      // Publish a fully written key without replacing a key another process created.
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await unlink(temporary);
    const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  } catch {
    await unlink(temporary).catch(() => undefined);
    throw new RuntimeKeyError("root_key_storage_unavailable");
  }
  const stored = await readKeyFile(path);
  if (!stored) throw new RuntimeKeyError("root_key_missing");
  return stored;
}
