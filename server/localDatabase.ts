import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CcuMasterdataPayload, CollectorPayload, NotificationSettings } from "./types.js";

export type SetupDefaults = {
  ccuHost?: string;
  ccuUser?: string;
  xmlApiToken?: string;
  snifferPort?: string;
};

export type LocalDatabase = {
  version: 1;
  updatedAt?: string;
  notificationSettings?: NotificationSettings;
  ccuMasterdata?: CcuMasterdataPayload;
  latestCollector?: CollectorPayload;
  setupDefaults?: SetupDefaults;
};

const emptyDatabase: LocalDatabase = {
  version: 1
};

let writeQueue: Promise<LocalDatabase> = Promise.resolve(emptyDatabase);

export async function readLocalDatabase(filePath: string): Promise<LocalDatabase> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<LocalDatabase>;
    return {
      ...emptyDatabase,
      ...parsed,
      version: 1
    };
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

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(tempFilePath, JSON.stringify(finalDatabase, null, 2));
    await rename(tempFilePath, filePath);

    return finalDatabase;
  });

  return writeQueue;
}
