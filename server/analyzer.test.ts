import assert from "node:assert/strict";
import test from "node:test";
import { createAnalysis } from "./analyzer.js";
import type { CcuSnapshot, CollectorPayload, SnifferSnapshot } from "./types.js";

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

test("ordnet erhöhten Duty Cycle auch ohne Sniffer verständlich ein", () => {
  const checks = createAnalysis(
    { ccuHost: "192.168.1.22", ccuUser: "Admin", ccuPassword: "secret" },
    undefined,
    {
      ...failedSnapshot({}),
      reachable: true,
      dutyCycle: 62,
      counters: {
        devices: 1,
        lowBattery: 0,
        unreachable: 0,
        configPending: 0,
        serviceMessages: 0,
        alarmMessages: 0
      }
    }
  );
  const dutyCycle = checks.find((check) => check.id === "duty-cycle");

  assert.equal(dutyCycle?.status, "improvement");
  assert.match(dutyCycle?.recommendation ?? "", /CCU-Wert beobachten/);
  assert.doesNotMatch(dutyCycle?.recommendation ?? "", /DC-Analyzer/);
});

test("verweist bei aktiviertem Sniffer auf die Verursacheranalyse", () => {
  const checks = createAnalysis(
    { ccuHost: "192.168.1.22", ccuUser: "Admin", ccuPassword: "secret", snifferEnabled: true, snifferPort: "/dev/ttyUSB0" },
    undefined,
    {
      ...failedSnapshot({}),
      reachable: true,
      dutyCycle: 62,
      counters: {
        devices: 1,
        lowBattery: 0,
        unreachable: 0,
        configPending: 0,
        serviceMessages: 0,
        alarmMessages: 0
      }
    }
  );

  assert.match(checks.find((check) => check.id === "duty-cycle")?.recommendation ?? "", /DC-Analyzer/);
});

test("bewertet ein einzelnes schwaches Sniffer-Telegramm noch nicht als belastbaren Beleg", () => {
  const sniffer: SnifferSnapshot = {
    checkedAt: "2026-06-13T10:00:00.000Z",
    port: "/dev/ttyUSB0",
    configured: true,
    connected: true,
    readerActive: true,
    source: "test",
    summary: {
      rawLines: 1,
      validLines: 1,
      invalidLines: 0,
      protocolCompatible: true,
      telegrams: 1,
      rssiSamples: 0,
      devices: 1,
      dutyCycle: 0
    },
    devices: [
      {
        address: "ABC123",
        name: "Testgerät",
        telegrams: 1,
        dutyCycle: 0,
        dutyShare: 100,
        sendTimeMs: 10,
        avgRssi: -100,
        lastSeen: "2026-06-13T10:00:00.000Z"
      }
    ],
    events: [],
    rssiNoise: [],
    diagnostics: []
  };

  const signalQuality = createAnalysis(
    { snifferPort: "/dev/ttyUSB0" },
    undefined,
    undefined,
    undefined,
    undefined,
    sniffer
  ).find((check) => check.id === "signal-strength");

  assert.equal(signalQuality?.status, "improvement");
  assert.match(signalQuality?.summary ?? "", /mindestens 3/);
  assert.match(signalQuality?.recommendation ?? "", /30 bis 60 Minuten/);
});

test("bewertet Wochen alte Collector-Logs nicht als aktuellen Zustand", () => {
  const staleCollector: CollectorPayload = {
    host: "Homematic-raspi",
    collectedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    logs: ["Jun 1 10:00:00 error: alter Fehler"],
    network: {
      connections: ["192.168.1.10:1234 192.168.1.22:8181 ESTABLISHED"]
    }
  };

  const checks = createAnalysis(
    { ccuHost: "192.168.1.22", sshUser: "root" },
    staleCollector
  );
  const logs = checks.find((check) => check.id === "logs");
  const externalAccess = checks.find((check) => check.id === "external-access");

  assert.equal(logs?.status, "unavailable");
  assert.match(logs?.summary ?? "", /früher erkannt/);
  assert.match(logs?.recommendation ?? "", /bereits eingerichtet/);
  assert.equal(externalAccess?.status, "unavailable");
});

test("blendet die HmIP-Routing-Prüfung nur bei aktivierter Funktion ein", () => {
  const disabledChecks = createAnalysis({});
  const enabledChecks = createAnalysis({ hmipRoutingEnabled: true });

  assert.equal(disabledChecks.some((check) => check.id === "routing-topology"), false);
  assert.equal(enabledChecks.some((check) => check.id === "routing-topology"), true);
});
