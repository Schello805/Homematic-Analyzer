import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureLocalDatabaseEncryption, readLocalDatabase, updateLocalDatabase } from "./localDatabase.js";

test("speichert sensible Konfigurationswerte verschlüsselt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "homematic-analyzer-db-"));
  const databaseFile = join(directory, "database.json");
  await updateLocalDatabase(databaseFile, (database) => ({
    ...database,
    setupDefaults: {
      ccuPassword: "ccu-secret",
      xmlApiToken: "xml-secret",
      sshPassword: "ssh-secret"
    },
    notificationSettings: {
      telegram: { botToken: "telegram-secret" },
      email: { password: "smtp-secret" },
      ai: { openaiApiKey: "openai-secret", geminiApiKey: "gemini-secret" }
    }
  }));

  const raw = await readFile(databaseFile, "utf8");
  assert.doesNotMatch(raw, /ccu-secret|xml-secret|ssh-secret|telegram-secret|smtp-secret|openai-secret|gemini-secret/);
  assert.match(raw, /enc:v1:/);

  const database = await readLocalDatabase(databaseFile);
  assert.equal(database.setupDefaults?.ccuPassword, "ccu-secret");
  assert.equal(database.notificationSettings?.ai?.openaiApiKey, "openai-secret");
});

test("migriert bestehende Klartext-Secrets beim Start", async () => {
  const directory = await mkdtemp(join(tmpdir(), "homematic-analyzer-migration-"));
  const databaseFile = join(directory, "database.json");
  await writeFile(databaseFile, JSON.stringify({
    version: 1,
    setupDefaults: { xmlApiToken: "legacy-token" }
  }));

  assert.equal(await ensureLocalDatabaseEncryption(databaseFile), true);
  assert.doesNotMatch(await readFile(databaseFile, "utf8"), /legacy-token/);
  assert.equal((await readLocalDatabase(databaseFile)).setupDefaults?.xmlApiToken, "legacy-token");
});
