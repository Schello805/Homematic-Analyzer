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

function dutyCycleCheck(value: number, status: AnalysisCheck["status"] = "warning"): AnalysisCheck {
  return {
    id: "duty-cycle",
    title: "Duty Cycle",
    category: "Funk",
    status,
    summary: `Die CCU meldet einen belegten Duty-Cycle-Wert von ${value}%.`,
    recommendation: "Beobachten.",
    access: ["ccu"],
    evidence: [{ source: "CCU XML-API Duty Cycle", detail: `Zentrale meldet Duty Cycle: ${value}%.` }],
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

test("sendet Duty-Cycle-Änderungen innerhalb derselben Statusstufe nicht minütlich erneut", () => {
  const dutySettings: NotificationSettings = {
    events: { warning: true, critical: true, dutyCycle: true }
  };
  const firstRun = selectNewNotificationChecks([dutyCycleCheck(76)], dutySettings);
  const changedButSameStatus = selectNewNotificationChecks([dutyCycleCheck(80)], dutySettings, firstRun.state);
  assert.equal(changedButSameStatus.newChecks.length, 0);

  const escalated = selectNewNotificationChecks([dutyCycleCheck(92, "critical")], dutySettings, changedButSameStatus.state);
  assert.equal(escalated.newChecks.length, 1);
  assert.match(escalated.newChecks[0]?.summary ?? "", /92%/);
});

test("benachrichtigt über Add-on-Updates wenn releases aktiviert ist", () => {
  const releaseSettings: NotificationSettings = {
    events: { releases: true }
  };
  const addonCheck: AnalysisCheck = {
    id: "addon-release-cuxd",
    title: "CUxD Update",
    category: "Wartung",
    status: "warning",
    summary: "Neues CUxD-Update verfügbar: Version 2.11.0.",
    recommendation: "Update installieren.",
    access: ["ccu"],
    evidence: [{ source: "GitHub Add-on Release", detail: "Installiert: 2.10.1. Verfügbar: 2.11.0." }],
    details: []
  };

  const firstRun = selectNewNotificationChecks([addonCheck], releaseSettings);
  assert.equal(firstRun.newChecks.length, 1);
  assert.equal(firstRun.newChecks[0]?.id, "addon-release-cuxd");

  const repeatedRun = selectNewNotificationChecks([addonCheck], releaseSettings, firstRun.state);
  assert.equal(repeatedRun.newChecks.length, 0);
});

test("meldet Release-Hinweise beim ersten Lauf, aber keine bestehende Fehlerflut", () => {
  const releaseSettings: NotificationSettings = {
    events: { releases: true, critical: true, serviceOverheat: true }
  };
  const addonCheck: AnalysisCheck = {
    id: "addon-release-cuxd",
    title: "CUxD Update",
    category: "Wartung",
    status: "warning",
    summary: "Neues CUxD-Update verfügbar: Version 2.10.1.",
    recommendation: "Update installieren.",
    access: ["ccu"],
    evidence: [{ source: "GitHub Add-on Release", detail: "Installiert: 2.10.0. Verfügbar: 2.10.1." }],
    details: []
  };

  const firstRun = selectNewNotificationChecks([overheatCheck(), addonCheck], releaseSettings);
  assert.deepEqual(firstRun.newChecks.map((check) => check.id), ["addon-release-cuxd"]);
});
