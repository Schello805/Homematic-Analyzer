import assert from "node:assert/strict";
import test from "node:test";
import { selectNewNotificationChecks } from "./notificationMonitor.js";
import type { AnalysisCheck, NotificationSettings } from "./types.js";

const settings: NotificationSettings = {
  events: { critical: true, serviceOverheat: true }
};

function overheatCheck(): AnalysisCheck {
  return {
    id: "service-messages",
    title: "Servicemeldungen",
    category: "Geräte",
    status: "critical",
    summary: "Überhitzung gemeldet.",
    recommendation: "Prüfen.",
    access: ["ccu"],
    evidence: [{ source: "CCU", detail: "Windrad Osten:0: ERROR_OVERHEAT" }],
    details: []
  };
}

test("benachrichtigt erst bei neuem Ereignis nach stiller Basisprüfung", () => {
  const firstRun = selectNewNotificationChecks([overheatCheck()], settings);
  assert.equal(firstRun.newChecks.length, 0);
  assert.equal(firstRun.state.initialized, true);

  const unchangedRun = selectNewNotificationChecks([overheatCheck()], settings, firstRun.state);
  assert.equal(unchangedRun.newChecks.length, 0);

  const resolvedRun = selectNewNotificationChecks([], settings, unchangedRun.state);
  const repeatedRun = selectNewNotificationChecks([overheatCheck()], settings, resolvedRun.state);
  assert.equal(repeatedRun.newChecks.length, 1);
});

test("benachrichtigt ein zusätzliches Ereignis, aber nicht den bestehenden Fehler erneut", () => {
  const existing = overheatCheck();
  const firstRun = selectNewNotificationChecks([existing], settings);
  const sabotage: AnalysisCheck = {
    ...existing,
    evidence: [{ source: "CCU", detail: "Fenster Keller:0: SABOTAGE" }]
  };

  const nextRun = selectNewNotificationChecks([existing, sabotage], {
    events: { critical: true, serviceOverheat: true, serviceSecurity: true }
  }, firstRun.state);
  assert.equal(nextRun.newChecks.length, 1);
  assert.match(nextRun.newChecks[0]?.evidence[0]?.detail ?? "", /SABOTAGE/);
});
