import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const prefix = "enc:v1:";

async function loadOrCreateKey(databaseFile: string): Promise<Buffer> {
  const keyFile = join(dirname(databaseFile), "secret.key");
  try {
    const key = Buffer.from((await readFile(keyFile, "utf8")).trim(), "base64");
    if (key.length === 32) return key;
  } catch {
  }

  const key = randomBytes(32);
  await mkdir(dirname(keyFile), { recursive: true });
  await writeFile(keyFile, key.toString("base64"), { mode: 0o600 });
  await chmod(keyFile, 0o600);
  return key;
}

export async function encryptSecret(databaseFile: string, value?: string): Promise<string | undefined> {
  if (!value || value.startsWith(prefix)) return value;
  const key = await loadOrCreateKey(databaseFile);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${prefix}${Buffer.concat([iv, tag, encrypted]).toString("base64")}`;
}

export async function decryptSecret(databaseFile: string, value?: string): Promise<string | undefined> {
  if (!value || !value.startsWith(prefix)) return value;
  try {
    const key = await loadOrCreateKey(databaseFile);
    const payload = Buffer.from(value.slice(prefix.length), "base64");
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}
