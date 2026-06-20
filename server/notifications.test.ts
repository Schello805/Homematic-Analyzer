import assert from "node:assert/strict";
import test from "node:test";
import { buildTelegramMessage } from "./notifications.js";
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
