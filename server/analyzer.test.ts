import assert from "node:assert/strict";
import test from "node:test";
import { createAnalysis } from "./analyzer.js";
import type { CcuSnapshot } from "./types.js";

function failedSnapshot(overrides: Partial<CcuSnapshot>): CcuSnapshot {
  return {
    reachable: false,
    xmlApiInstalled: true,
    source: "xml-api",
    collectedAt: "2026-06-12T17:00:00.000Z",
    devices: [],
    serviceMessages: [],
    alarmMessages: [],
    counters: {
      devices: 0,
      lowBattery: 0,
      unreachable: 0,
      configPending: 0,
      serviceMessages: 0,
      alarmMessages: 0
    },
    ...overrides
  };
}

test("bewertet erreichbare WebUI mit gescheiterter XML-API als Hinweis statt Totalausfall", () => {
  const checks = createAnalysis(
    { ccuHost: "192.168.1.22", ccuUser: "Admin", ccuPassword: "secret" },
    undefined,
    failedSnapshot({
      webUiReachable: true,
      xmlApiReachable: true,
      authentication: "failed",
      errorCode: "authentication",
      diagnostics: [
        { step: "Netzwerk / WebUI", status: "ok", detail: "HTTP 200" },
        { step: "XML-API Geräteliste", status: "failed", detail: "Token abgelehnt" }
      ]
    })
  );
  const connection = checks.find((check) => check.id === "ccu-connection");

  assert.equal(connection?.status, "warning");
  assert.match(connection?.summary ?? "", /WebUI antwortet/);
  assert.equal(connection?.evidence.length, 2);
});

test("erklärt, dass Browser und Analyzer unterschiedliche Netzwerkwege nutzen", () => {
  const checks = createAnalysis(
    { ccuHost: "192.168.1.22", ccuUser: "Admin", ccuPassword: "secret" },
    undefined,
    failedSnapshot({
      webUiReachable: false,
      errorCode: "network"
    })
  );
  const connection = checks.find((check) => check.id === "ccu-connection");

  assert.equal(connection?.status, "critical");
  assert.match(connection?.summary ?? "", /Browser unterscheiden/);
  assert.match(connection?.details.join(" ") ?? "", /nicht von deinem PC/);
});

test("erklärt bei erreichbarer WebUI einen XML-API-Timeout statt eines Netzwerkfehlers", () => {
  const checks = createAnalysis(
    { ccuHost: "192.168.1.22", ccuUser: "Admin", ccuPassword: "secret", xmlApiToken: "token12345" },
    undefined,
    failedSnapshot({
      webUiReachable: true,
      xmlApiReachable: false,
      authentication: "not-tested",
      errorCode: "timeout",
      diagnostics: [
        { step: "Netzwerk / WebUI", status: "ok", detail: "HTTP 200" },
        { step: "XML-API Geräteliste", status: "failed", detail: "statelist.cgi antwortete nicht innerhalb von 30 Sekunden." }
      ]
    })
  );
  const xmlApi = checks.find((check) => check.id === "xml-api");

  assert.match(xmlApi?.recommendation ?? "", /XML-API-Geräteliste antwortet zu langsam/);
  assert.doesNotMatch(xmlApi?.recommendation ?? "", /Firewall/);
});
