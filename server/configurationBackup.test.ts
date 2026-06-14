import assert from "node:assert/strict";
import test from "node:test";
import { createConfigurationBackup, restoreConfigurationBackup } from "./configurationBackup.js";

test("exportiert und importiert Konfiguration passwortverschlüsselt", () => {
  const payload = {
    setupDefaults: {
      ccuHost: "192.168.1.22",
      ccuPassword: "ccu-secret",
      xmlApiToken: "xml-secret"
    },
    notificationSettings: {
      telegram: {
        enabled: true,
        botToken: "telegram-secret",
        chatId: "123"
      }
    }
  };
  const backup = createConfigurationBackup(payload, "sicheres-passwort");
  assert.doesNotMatch(JSON.stringify(backup), /ccu-secret|xml-secret|telegram-secret/);
  assert.deepEqual(restoreConfigurationBackup(backup, "sicheres-passwort"), payload);
  assert.throws(() => restoreConfigurationBackup(backup, "falsches-passwort"));
});
