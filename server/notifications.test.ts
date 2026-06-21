import assert from "node:assert/strict";
import test from "node:test";
import { buildTelegramMessage, shouldNotifyCheck } from "./notifications.js";
import type { AnalysisCheck, NotificationSettings } from "./types.js";

const settings: NotificationSettings = {
  telegram: { enabled: true },
  events: { critical: true, warning: true, dutyCycle: true }
};

test("erstellt eine verständliche Telegram-Nachricht mit Funklast und Link", () => {
  const checks: AnalysisCheck[] = [{
    id: "duty-cycle",
    title: "Duty Cycle",
    category: "Funk",
    status: "warning",
    summary: "Der belegte Duty-Cycle-Wert liegt bei 62%.",
    recommendation: "Funklast zeitnah prüfen.",
    access: ["ccu"],
    evidence: [],
    details: []
  }];
  const message = buildTelegramMessage(checks, settings, "http://192.168.1.121:3001");
  assert.match(message, /🏠 <b>Homematic Analyzer<\/b>/);
  assert.match(message, /📊 Funklast: <b>62%<\/b> <code>██████░░░░<\/code>/);
  assert.match(message, /Analyzer öffnen und Belege ansehen/);
});

test("maskiert dynamische Telegram-HTML-Inhalte", () => {
  const checks: AnalysisCheck[] = [{
    id: "reachability",
    title: "Gerät <Test>",
    category: "Geräte",
    status: "critical",
    summary: "<unreach>",
    recommendation: "& prüfen",
    access: ["ccu"],
    evidence: [],
    details: []
  }];
  const message = buildTelegramMessage(checks, settings);
  assert.match(message, /Gerät &lt;Test&gt;/);
  assert.match(message, /&amp; prüfen/);
});

test("respektiert die eigene Benachrichtigungseinstellung für ERROR_OVERHEAT", () => {
  const check: AnalysisCheck = {
    id: "service-messages",
    title: "Servicemeldungen",
    category: "Geräte",
    status: "critical",
    summary: "1 kritische Servicemeldung wurde gefunden.",
    recommendation: "Überhitzung prüfen.",
    access: ["ccu"],
    evidence: [{ source: "CCU Servicemeldung", detail: "Windrad Osten:0: ERROR_OVERHEAT" }],
    details: []
  };

  assert.equal(shouldNotifyCheck(check, { events: { critical: true, serviceOverheat: false } }), false);
  assert.equal(shouldNotifyCheck(check, { events: { critical: false, serviceOverheat: true } }), true);
});

test("benachrichtigt weitere Service-Kategorien nur nach eigener Auswahl", () => {
  const securityCheck: AnalysisCheck = {
    id: "service-messages",
    title: "Servicemeldungen",
    category: "Geräte",
    status: "critical",
    summary: "Sabotage erkannt.",
    recommendation: "Prüfen.",
    access: ["ccu"],
    evidence: [{ source: "CCU Servicemeldung", detail: "Fenster Keller:0: SABOTAGE" }],
    details: []
  };
  const valveCheck: AnalysisCheck = {
    ...securityCheck,
    evidence: [{ source: "CCU Servicemeldung", detail: "Heizung:0: VALVE_ERROR_POSITION" }]
  };

  assert.equal(shouldNotifyCheck(securityCheck, { events: { critical: true, serviceSecurity: false } }), false);
  assert.equal(shouldNotifyCheck(securityCheck, { events: { critical: false, serviceSecurity: true } }), true);
  assert.equal(shouldNotifyCheck(valveCheck, { events: { critical: true, serviceTypes: [] } }), false);
  assert.equal(shouldNotifyCheck(valveCheck, { events: { critical: false, serviceTypes: ["VALVE_ERROR_POSITION"] } }), true);
});

test("nennt bei externen CCU-Zugriffen die konkrete Quelle direkt in Telegram", () => {
  const check: AnalysisCheck = {
    id: "external-access",
    title: "Zugriffe anderer Systeme auf die CCU",
    category: "Anbindungen",
    status: "warning",
    summary: "Viele gleichzeitige CCU-Verbindungen: iobroker.fritz.box (192.168.1.78): 12 Verbindungen über HmIP-RPC, XML-API/ReGa.",
    recommendation: "Polling reduzieren.",
    access: ["ssh", "external"],
    evidence: [],
    details: []
  };

  const message = buildTelegramMessage([check], { events: { externalAccess: true } });
  assert.match(message, /iobroker\.fritz\.box \(192\.168\.1\.78\)/);
  assert.match(message, /12 Verbindungen/);
  assert.match(message, /HmIP-RPC, XML-API\/ReGa/);
});
