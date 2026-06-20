import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AnalysisHistoryEntry, CcuMasterdataPayload, CollectorHistoryPoint, CollectorPayload, NotificationSettings, SnifferHistoryPoint } from "./types.js";
import { decryptSecret, encryptSecret } from "./secretStore.js";

export type SetupDefaults = {
  ccuHost?: string;
  ccuUser?: string;
  ccuPassword?: string;
  xmlApiToken?: string;
  sshUser?: string;
  sshPassword?: string;
  snifferEnabled?: boolean;
  snifferPort?: string;
  hmipRoutingEnabled?: boolean;
  hmipRoutingLogLevelSet?: boolean;
  hmipRoutingRestarted?: boolean;
};

export type LocalDatabase = {
  version: 1;
  updatedAt?: string;
  collectorToken?: string;
  notificationSettings?: NotificationSettings;
  ccuMasterdata?: CcuMasterdataPayload;
  latestCollector?: CollectorPayload;
  collectorHistory?: CollectorHistoryPoint[];
  analysisHistory?: AnalysisHistoryEntry[];
  snifferHistory?: SnifferHistoryPoint[];
  setupDefaults?: SetupDefaults;
};

const emptyDatabase: LocalDatabase = {
  version: 1
};

let writeQueue: Promise<LocalDatabase> = Promise.resolve(emptyDatabase);

async function transformSecrets(databaseFile: string, database: LocalDatabase, mode: "encrypt" | "decrypt"): Promise<LocalDatabase> {
  const transform = mode === "encrypt" ? encryptSecret : decryptSecret;
  const copy = structuredClone(database);
  copy.collectorToken = await transform(databaseFile, copy.collectorToken);
  if (copy.setupDefaults) {
    copy.setupDefaults.ccuPassword = await transform(databaseFile, copy.setupDefaults.ccuPassword);
    copy.setupDefaults.xmlApiToken = await transform(databaseFile, copy.setupDefaults.xmlApiToken);
    copy.setupDefaults.sshPassword = await transform(databaseFile, copy.setupDefaults.sshPassword);
  }
  if (copy.notificationSettings?.telegram) {
    copy.notificationSettings.telegram.botToken = await transform(databaseFile, copy.notificationSettings.telegram.botToken);
  }
  if (copy.notificationSettings?.email) {
    copy.notificationSettings.email.password = await transform(databaseFile, copy.notificationSettings.email.password);
  }
  if (copy.notificationSettings?.ai) {
    copy.notificationSettings.ai.openaiApiKey = await transform(databaseFile, copy.notificationSettings.ai.openaiApiKey);
    copy.notificationSettings.ai.geminiApiKey = await transform(databaseFile, copy.notificationSettings.ai.geminiApiKey);
  }
  return copy;
}

export async function readLocalDatabase(filePath: string): Promise<LocalDatabase> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<LocalDatabase>;
    return transformSecrets(filePath, {
      ...emptyDatabase,
      ...parsed,
      version: 1
    }, "decrypt");
  } catch {
    return emptyDatabase;
  }
}

export async function updateLocalDatabase(filePath: string, update: (database: LocalDatabase) => LocalDatabase | Promise<LocalDatabase>) {
  writeQueue = writeQueue.catch(() => emptyDatabase).then(async () => {
    const currentDatabase = await readLocalDatabase(filePath);
    const nextDatabase = await update(currentDatabase);
    const finalDatabase = {
      ...nextDatabase,
      version: 1 as const,
      updatedAt: new Date().toISOString()
    };
    const tempFilePath = `${filePath}.tmp`;

    const encryptedDatabase = await transformSecrets(filePath, finalDatabase, "encrypt");
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(tempFilePath, JSON.stringify(encryptedDatabase, null, 2), { mode: 0o600 });
    await rename(tempFilePath, filePath);
    await chmod(filePath, 0o600);

    return finalDatabase;
  });

  return writeQueue;
}

export async function ensureLocalDatabaseEncryption(filePath: string): Promise<boolean> {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as LocalDatabase;
    const secrets = [
      raw.collectorToken,
      raw.setupDefaults?.ccuPassword,
      raw.setupDefaults?.xmlApiToken,
      raw.setupDefaults?.sshPassword,
      raw.notificationSettings?.telegram?.botToken,
      raw.notificationSettings?.email?.password,
      raw.notificationSettings?.ai?.openaiApiKey,
      raw.notificationSettings?.ai?.geminiApiKey
    ].filter((value): value is string => Boolean(value));
    if (!secrets.some((value) => !value.startsWith("enc:v1:"))) return false;
    await updateLocalDatabase(filePath, (database) => database);
    return true;
  } catch {
    return false;
  }
}
