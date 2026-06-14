import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import type { NotificationSettings } from "./types.js";
import type { SetupDefaults } from "./localDatabase.js";

export type ConfigurationBackup = {
  format: "homematic-analyzer-config";
  version: 1;
  createdAt: string;
  salt: string;
  iv: string;
  tag: string;
  data: string;
};

type ConfigurationPayload = {
  setupDefaults?: SetupDefaults;
  notificationSettings?: NotificationSettings;
};

function deriveKey(passphrase: string, salt: Buffer) {
  return pbkdf2Sync(passphrase, salt, 210000, 32, "sha256");
}

export function createConfigurationBackup(payload: ConfigurationPayload, passphrase: string): ConfigurationBackup {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final()
  ]);

  return {
    format: "homematic-analyzer-config",
    version: 1,
    createdAt: new Date().toISOString(),
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64")
  };
}

export function restoreConfigurationBackup(backup: ConfigurationBackup, passphrase: string): ConfigurationPayload {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(passphrase, Buffer.from(backup.salt, "base64")),
    Buffer.from(backup.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(backup.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(backup.data, "base64")),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString("utf8")) as ConfigurationPayload;
}
