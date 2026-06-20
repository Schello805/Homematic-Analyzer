import { shouldNotifyCheck } from "./notifications.js";
import type { AnalysisCheck, NotificationSettings } from "./types.js";

export type NotificationMonitorState = {
  initialized?: boolean;
  activeFingerprints?: string[];
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastNotificationAt?: string;
  lastError?: string;
};

function fingerprint(check: AnalysisCheck) {
  const evidence = check.evidence
    .map((item) => item.detail.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .sort()
    .join(" | ");
  return `${check.id}:${check.status}:${evidence || check.summary.replace(/\s+/g, " ").trim()}`;
}

export function selectNewNotificationChecks(
  checks: AnalysisCheck[],
  settings: NotificationSettings,
  previous: NotificationMonitorState = {}
) {
  const matchingChecks = checks.filter((check) => shouldNotifyCheck(check, settings));
  const activeFingerprints = matchingChecks.map(fingerprint);
  const previousFingerprints = new Set(previous.activeFingerprints ?? []);
  const isFirstSuccessfulRun = !previous.initialized;
  const newChecks = isFirstSuccessfulRun
    ? []
    : matchingChecks.filter((check) => !previousFingerprints.has(fingerprint(check)));

  return {
    newChecks,
    state: {
      ...previous,
      initialized: true,
      activeFingerprints,
      lastRunAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      lastError: undefined
    } satisfies NotificationMonitorState
  };
}
