import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import packageInfo from "../package.json";
import { EvidenceDetail, SourceBadge } from "./components/analysis/EvidenceDetail";
import { SignalQualityDeviceList, type SignalReceiverOption } from "./components/analysis/SignalQualityDeviceList";
import {
  DualRssiAssessment,
  normalizeRadioIdentifier,
  parseCentralRssi,
  parseRssiComparison,
  RssiAssessment,
  rssiClass
} from "./components/radio/RssiAssessment";
import {
  firstLine,
  flagClass,
  formatBackups,
  formatBackupDate,
  formatCpu,
  formatDataAge,
  formatDisk,
  formatMemory,
  formatPercent,
  formatSnifferTime,
  formatTemperature,
  formatUptime,
  historyTimeLabels,
  metricNeedsHelp,
  noiseAssessment,
  parseCpuLoad,
  parseCpuUsagePercent,
  parseDiskInfo,
  parseDiskUsagePercent,
  parseMemoryUsagePercent,
  parseTemperature,
  sparklinePoints
} from "./utils/systemMetrics";

type CheckStatus = "ok" | "improvement" | "warning" | "critical" | "unavailable";

type Evidence = {
  source: string;
  detail: string;
  timestamp?: string;
  url?: string;
};

type AnalysisCheck = {
  id: string;
  title: string;
  category: string;
  status: CheckStatus;
  summary: string;
  recommendation: string;
  evidence: Evidence[];
  details: string[];
};

type AnalysisResponse = {
  generatedAt: string;
  sources?: {
    ccu?: string;
    collector?: string;
    masterdata?: string;
    sniffer?: string;
  };
  checks: AnalysisCheck[];
  systemDashboard?: SystemDashboard;
  notifications?: {
    telegram?: {
      state: "disabled" | "not-configured" | "skipped" | "sent" | "failed";
      message: string;
    };
    email?: {
      state: "disabled" | "not-configured" | "skipped" | "sent" | "failed";
      message: string;
    };
  };
};

type AnalysisSnifferMode = "base" | "with-sniffer";

type DiagnosticSource = {
  id: string;
  label: string;
  status: "ok" | "fresh" | "stale" | "error" | "missing" | "optional";
  detail: string;
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  ageMinutes?: number;
  diagnostics?: Array<{
    step: string;
    status: "ok" | "failed" | "skipped";
    detail: string;
  }>;
};

type DiagnosticsPayload = {
  checkedAt: string;
  sources: DiagnosticSource[];
};

type AnalysisHistoryPayload = {
  entries: Array<{
    generatedAt: string;
    summary: Record<CheckStatus, number>;
    checks: Array<{ id: string; title: string; status: CheckStatus; summary: string }>;
    sources: {
      ccu?: string;
      collector?: string;
      masterdata?: string;
      sniffer?: string;
    };
  }>;
  changes: Array<{
    id: string;
    title: string;
    from: CheckStatus;
    to: CheckStatus;
  }>;
};

type CcuTestResult = {
  checkedAt: string;
  reachable: boolean;
  webUiReachable?: boolean;
  xmlApiReachable?: boolean;
  authentication?: "ok" | "failed" | "not-tested";
  devices: number;
  errorCode?: string;
  error?: string;
  diagnostics: Array<{
    step: string;
    status: "ok" | "failed" | "skipped";
    detail: string;
  }>;
};

type SnifferHistoryPayload = {
  retentionDays: number;
  points: Array<{
    collectedAt: string;
    dutyCycle?: number;
    carrierSense?: number;
    carrierSenseAvg?: number;
    telegrams: number;
    devices: number;
    weakestRssi?: number;
  }>;
};

type SystemDashboard = {
  available: boolean;
  host?: string;
  ccuHost?: string;
  ccuUiUrl?: string;
  collectedAt?: string;
  uptime?: string;
  memory?: string;
  disk?: string;
  temperature?: string;
  cpu?: string;
  backups?: string;
  backupPaths?: string[];
  backupLatestPath?: string;
  backupLatestDirectory?: string;
  backupLatestAt?: string;
  backupDisk?: string;
  backupItems?: BackupItem[];
  logs: number;
  connections: number;
  history?: Array<{
    collectedAt: string;
    cpu?: string;
    memory?: string;
    disk?: string;
    temperature?: string;
  }>;
};

type BackupItem = {
  name: string;
  path: string;
  size: string;
  modifiedAt: string;
};

type UpdateStatus = {
  state: "checking" | "current" | "update" | "unknown";
  label: string;
  detail: string;
  url: string;
};

type UpdateRunStatus = {
  status: "idle" | "running" | "completed" | "failed";
  running: boolean;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  error?: string;
  log?: string;
};

type LogPayload = {
  available: boolean;
  collectorAvailable?: boolean;
  collectorState?: "missing" | "fresh" | "stale";
  collectorAgeMinutes?: number;
  analyzerVersion?: string;
  servedAt?: string;
  collectedAt?: string;
  host?: string;
  logs: string[];
};

type Toast = {
  id: number;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message?: string;
};

type ActionModal = "collector" | "duty" | "signal" | "check" | null;

type MasterdataStatus = {
  available: boolean;
  collectedAt?: string;
  deviceCount: number;
  systemAvailable?: boolean;
  askSinDevListAvailable?: boolean;
  askSinDevListCount?: number;
};

type UsbPort = {
  path: string;
  label: string;
  stable: boolean;
  target?: string;
};

type SnifferSnapshot = {
  checkedAt: string;
  port?: string;
  configured: boolean;
  connected: boolean;
  readerActive: boolean;
  source: string;
  summary: {
    rawLines: number;
    validLines: number;
    invalidLines: number;
    protocolCompatible: boolean;
    telegrams: number;
    rssiSamples: number;
    devices: number;
    dutyCycle?: number;
    carrierSense?: number;
    carrierSenseAvg?: number;
    weakestRssi?: number;
    weakestRssiDevice?: {
      address: string;
      name: string;
      serial?: string;
      type?: string;
      telegrams: number;
      dutyCycle: number;
      dutyShare: number;
      sendTimeMs: number;
      avgRssi?: number;
      lastSeen: string;
    };
    gateways?: Array<{
      address: string;
      name: string;
      serial?: string;
      type?: string;
      telegrams: number;
      dutyCycle: number;
      dutyShare: number;
      sendTimeMs: number;
      avgRssi?: number;
      lastSeen: string;
    }>;
  };
  devices: Array<{
    address: string;
    name: string;
    serial?: string;
    type?: string;
    telegrams: number;
    dutyCycle: number;
    dutyShare: number;
    sendTimeMs: number;
    avgRssi?: number;
    lastSeen: string;
  }>;
  events: Array<{
    tstamp: string;
    raw: string;
    fromAddress: string;
    toAddress: string;
    fromName?: string;
    toName?: string;
    fromSerial?: string;
    toSerial?: string;
    fromType?: string;
    toType?: string;
    rssi: number;
    len: number;
    cnt: number;
    flags: string[];
    type: string;
    dutyCycle: number;
    sendTimeMs: number;
    payload: string;
  }>;
  rssiNoise: Array<{
    tstamp: string;
    raw: string;
    rssi?: number;
  }>;
  timeline?: Array<{
    minute: string;
    telegrams: number;
    dutyCycle: number;
    noiseSamples: number;
    noiseAverage?: number;
    noiseMinimum?: number;
    noiseMaximum?: number;
  }>;
  diagnostics: string[];
};

type SetupDefaults = Partial<Pick<SetupForm, "ccuHost" | "ccuUser" | "ccuPassword" | "xmlApiToken" | "sshUser" | "sshPassword" | "snifferEnabled" | "snifferPort" | "hmipRoutingEnabled" | "hmipRoutingLogLevelSet" | "hmipRoutingRestarted">>;

type CollectorStatus = {
  available: boolean;
  state?: "missing" | "fresh" | "stale";
  ageMinutes?: number;
  collectedAt?: string;
  host?: string;
  logs: number;
  hmipLogs?: number;
  connections: number;
};

type RoutingStatus = {
  enabled: boolean;
  logLevelConfirmed: boolean;
  restartConfirmed: boolean;
  collectorState: "missing" | "fresh" | "stale";
  collectorAgeMinutes?: number;
  collectedAt?: string;
  host?: string;
  hmipLogLines: number;
  hmipLogReceived: boolean;
  sample: string[];
};

type RoutingTopologyNode = {
  id: string;
  name: string;
  serial?: string;
  address?: string;
  type?: string;
  protocol: "central" | "hmip" | "bidcos";
  role: "central" | "gateway" | "router" | "candidate" | "device";
  routerEnabled: boolean;
  routingEnabled: boolean;
  multicastRouting: boolean;
  avgRssi?: number;
  snifferRssi?: number;
  ccuRssi?: number;
  ccuRssiSource?: "RSSI_PEER" | "RSSI_DEVICE";
  ccuPeerRssi?: number;
  rssiTelegrams?: number;
  evidence: string[];
};

type RoutingTopology = {
  generatedAt: string;
  collectedAt?: string;
  sourceHost?: string;
  state: "ready" | "partial" | "missing";
  nodes: RoutingTopologyNode[];
  edges: Array<{
    id: string;
    source: string;
    target: string;
    kind: "confirmed-route";
    evidence: string;
  }>;
  metrics: {
    devices: number;
    hmipDevices: number;
    bidcosDevices: number;
    gateways: number;
    confirmedRouters: number;
    routerCandidates: number;
    routingEnabled: number;
    multicastRouters: number;
    confirmedRoutes: number;
    unknownAssignments: number;
  };
  diagnostics: string[];
  rssiSources: {
    sniffer: number;
    ccu: number;
  };
};

const appVersion = packageInfo.version;
const repositoryUrl = "https://github.com/Schello805/Homematic-Analyzer";
const setupStorageKey = "homematic-analyzer.setup.v1";
const analysisStorageKey = "homematic-analyzer.analysis.v1";

const statusLabel: Record<CheckStatus, string> = {
  ok: "OK",
  improvement: "Optimierung",
  warning: "Hinweis",
  critical: "Kritisch",
  unavailable: "Nicht geprüft"
};

const statusOrder: CheckStatus[] = ["critical", "warning", "improvement", "ok", "unavailable"];

const checkThemes = [
  {
    id: "foundation",
    title: "Verbindung & Datenbasis",
    description: "CCU-Erreichbarkeit, XML-API und vorbereitete Stammdaten",
    checkIds: ["ccu-connection", "xml-api", "ccu-masterdata"]
  },
  {
    id: "system",
    title: "Zentrale & Backups",
    description: "Systemzustand, Speicher, Laufzeit und Datensicherung",
    checkIds: ["system-health"]
  },
  {
    id: "devices",
    title: "Geräte",
    description: "Meldungen, Batterien, Erreichbarkeit und Konfiguration",
    checkIds: ["alarm-messages", "service-messages", "reachability", "config-pending", "batteries"]
  },
  {
    id: "radio",
    title: "Funk & Routing",
    description: "Duty Cycle, Signalqualität und HmIP-Routing",
    checkIds: ["duty-cycle", "signal-strength", "routing-topology"]
  },
  {
    id: "security",
    title: "Sicherheit & Zugriffe",
    description: "Erreichbarkeit von außen und externe Verbindungen",
    checkIds: ["remote-exposure", "external-access"]
  },
  {
    id: "maintenance",
    title: "Wartung & Updates",
    description: "Geräte-Firmware und neue Analyzer-Versionen",
    checkIds: ["firmware-overview", "central-release", "app-release"]
  },
  {
    id: "operations",
    title: "Protokolle & Benachrichtigungen",
    description: "Logs, Fehleranalyse und Meldungswege",
    checkIds: ["logs", "notifications"]
  }
] as const;

const analysisSteps = [
  { label: "Setup lesen", detail: "Host, Token, optionale Quellen" },
  { label: "CCU verbinden", detail: "XML-API und Token prüfen" },
  { label: "Geräte laden", detail: "Namen, Typen und Kanäle" },
  { label: "Servicemeldungen", detail: "Nur aktive Belege zählen" },
  { label: "Batterien & Erreichbarkeit", detail: "Gerätezustände auswerten" },
  { label: "Duty Cycle & Funk", detail: "Nur echte Werte melden" },
  { label: "CCU-Systemwerte", detail: "CPU, RAM, Temperatur, Speicher, Backups" },
  { label: "Logs & Zugriffe", detail: "Optionale Shell-Zusatzdaten" },
  { label: "Ergebnis bauen", detail: "Bewerten, gruppieren, empfehlen" }
];

function evidenceUsesSniffer(evidence: Evidence) {
  const source = evidence.source.toLowerCase();
  const detail = evidence.detail.toLowerCase();
  return source.includes("sniffer")
    || source.includes("asksin")
    || detail.includes("sniffer")
    || detail.includes("asksin");
}

function checkUsesSniffer(check: AnalysisCheck) {
  return check.evidence.some(evidenceUsesSniffer)
    || check.details.some((detail) => evidenceUsesSniffer({ source: "", detail }))
    || /sniffer|asksin/i.test(`${check.summary} ${check.recommendation}`);
}

function stripSnifferText(value: string) {
  return value
    .replace(/\s*Der AskSin-Sniffer[^.]*\./gi, "")
    .replace(/\s*Snifferwerte?[^.]*\./gi, "")
    .replace(/\s*Sniffer-Belege[^.]*\./gi, "")
    .replace(/\s*Snifferdaten[^.]*\./gi, "")
    .replace(/\s*Sniffer-RSSI[^.]*\./gi, "")
    .replace(/\s*Optional einen Sniffer ergänzen[^.]*\./gi, "")
    .replace(/\s*\/ Sniffer\s+–\s*dBm/gi, "")
    .replace(/\s*,\s*Sniffer\s+(?:nicht verfügbar|–|-?\d+)\s*dBm/gi, "")
    .replace(/\s*\(Zentrale\s+(-?\d+|–|nicht verfügbar)\s*\/\s*Sniffer\s+(?:-?\d+|–|nicht verfügbar)\s*dBm\)/gi, " (Zentrale $1 dBm)")
    .replace(/\s+/g, " ")
    .trim();
}

function filterSnifferEvidence(item: Evidence): Evidence | null {
  const rssiComparison = item.source === "RSSI-Vergleich" ? parseRssiComparison(item.detail) : null;
  if (rssiComparison?.ccu !== undefined) {
    return {
      ...item,
      detail: `${rssiComparison.name}: Zentrale ${rssiComparison.ccu} dBm.`
    };
  }
  if (evidenceUsesSniffer(item)) return null;
  return { ...item, detail: stripSnifferText(item.detail) || item.detail };
}

function filterSnifferFromCheck(check: AnalysisCheck, mode: AnalysisSnifferMode): AnalysisCheck | null {
  if (mode === "with-sniffer") return check;
  if (check.id === "signal-strength") {
    const ccuAttentionEntries = check.evidence
      .map((item) => ({ item, comparison: item.source === "RSSI-Vergleich" ? parseRssiComparison(item.detail) : null }))
      .filter((entry) => entry.comparison && ["medium", "weak"].includes(rssiClass(entry.comparison.ccu)));
    const ccuAttention = ccuAttentionEntries.map(({ item, comparison }) => ({ ...item, detail: `${comparison!.name}: Zentrale ${comparison!.ccu} dBm.` }));
    const criticalCcuSignal = ccuAttentionEntries.some(({ comparison }) => (comparison?.ccu ?? 0) <= -95);
    if (ccuAttention.length === 0) {
      return {
        ...check,
        status: "ok",
        summary: "Keine auffällig schwachen RSSI-Werte der Zentrale gefunden.",
        recommendation: "Kein unmittelbarer Handlungsbedarf. Für eine zweite Messposition kannst du optional Snifferwerte einblenden.",
        evidence: [],
        details: ["Diese Basisansicht bewertet ausschließlich RSSI-Werte der Zentrale/XML-API.", "Snifferwerte bleiben ausgeblendet, damit beide Messorte nicht verwechselt werden."]
      };
    }
    return {
      ...check,
      status: criticalCcuSignal ? "warning" : "improvement",
      summary: `${ccuAttention.length} Geräte werden von der Zentrale schwach empfangen: ${ccuAttention.slice(0, 5).map((item) => item.detail.replace(/: Zentrale.*$/, "")).join(", ")}.`,
      recommendation: "Öffne die Signalwerte und prüfe für jedes Gerät passende vorhandene Router oder Gateways. Die App schlägt nur Optionen vor; die räumliche Nähe musst du vor Ort bestätigen.",
      evidence: ccuAttention,
      details: ["Der Wert stammt aus der CCU/XML-API und beschreibt die Funkstrecke aus Sicht der Zentrale.", "Ein schwacher Wert ist kein automatischer Defekt, aber ein Anlass, Empfänger, Router oder Gateway am Standort zu prüfen."]
    };
  }
  const evidence = check.evidence
    .map(filterSnifferEvidence)
    .filter((item): item is Evidence => Boolean(item));
  const details = check.details
    .filter((detail) => !evidenceUsesSniffer({ source: "", detail }))
    .map(stripSnifferText)
    .filter(Boolean);
  const snifferOnly = checkUsesSniffer(check) && evidence.length === 0 && details.length === 0;
  if (snifferOnly && ["signal-strength", "routing-topology"].includes(check.id)) return null;
  return {
    ...check,
    summary: stripSnifferText(check.summary) || check.summary,
    recommendation: stripSnifferText(check.recommendation) || check.recommendation,
    evidence,
    details
  };
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function getStatusIcon(status: CheckStatus, className = "status-icon") {
  switch (status) {
    case "ok":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.8-10.8a1 1 0 00-1.6-1.4L9 9.2 7.8 8a1 1 0 00-1.6 1.4l2 2a1 1 0 001.6 0l4-4z" clipRule="evenodd" />
        </svg>
      );
    case "improvement":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zm-1 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
      );
    case "warning":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      );
    case "critical":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
        </svg>
      );
    case "unavailable":
    default:
      return (
        <svg className={className} viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.707.293l-3 3a1 1 0 001.414 1.414L9 10.414V13a1 1 0 102 0v-2.586l1.293 1.293a1 1 0 001.414-1.414l-3-3A1 1 0 0010 7z" clipRule="evenodd" />
        </svg>
      );
  }
}

function getSecretIcon(isVisible: boolean) {
  return isVisible ? (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2 2 0 002.8 2.8" />
      <path d="M9.9 4.2A10.8 10.8 0 0112 4c6 0 9.5 5.4 10 6.2a1.8 1.8 0 010 1.6 15.1 15.1 0 01-3 3.7" />
      <path d="M6.6 6.6A15.4 15.4 0 002 10.2a1.8 1.8 0 000 1.6C2.5 12.6 6 18 12 18a10.8 10.8 0 004.1-.8" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

const initialForm = {
  ccuHost: "",
  ccuUser: "",
  ccuPassword: "",
  xmlApiToken: "",
  sshUser: "root",
  sshPassword: "",
  snifferEnabled: false,
  snifferPort: "",
  hmipRoutingEnabled: false,
  hmipRoutingLogLevelSet: false,
  hmipRoutingRestarted: false
};

type SetupForm = typeof initialForm;

const initialNotificationSettings = {
  telegram: {
    enabled: false,
    botToken: "",
    chatId: ""
  },
  email: {
    enabled: false,
    host: "",
    port: 587,
    secure: false,
    user: "",
    password: "",
    from: "",
    to: ""
  },
  events: {
    critical: true,
    warning: false,
    dutyCycle: true,
    battery: true,
    unreachable: true,
    configPending: true,
    externalAccess: true,
    sniffer: true,
    releases: true
  },
  ai: {
    enabled: false,
    provider: "openai",
    openaiApiKey: "",
    openaiModel: "gpt-4o-mini",
    geminiApiKey: "",
    geminiModel: "gemini-1.5-flash"
  }
};

type NotificationSettings = typeof initialNotificationSettings;

function loadSavedSetup(): SetupForm {
  if (typeof window === "undefined") return initialForm;

  try {
    const savedSetup = window.localStorage.getItem(setupStorageKey);
    if (!savedSetup) return initialForm;

    const parsedSetup = JSON.parse(savedSetup) as Partial<SetupForm>;
    const loadedSetup = {
      ccuHost: parsedSetup.ccuHost ?? "",
      ccuUser: parsedSetup.ccuUser ?? "",
      ccuPassword: parsedSetup.ccuPassword ?? "",
      xmlApiToken: parsedSetup.xmlApiToken ?? "",
      sshUser: parsedSetup.sshUser ?? "root",
      sshPassword: parsedSetup.sshPassword ?? "",
      snifferEnabled: parsedSetup.snifferEnabled ?? Boolean(parsedSetup.snifferPort),
      snifferPort: parsedSetup.snifferPort ?? "",
      hmipRoutingEnabled: parsedSetup.hmipRoutingEnabled ?? false,
      hmipRoutingLogLevelSet: parsedSetup.hmipRoutingLogLevelSet ?? false,
      hmipRoutingRestarted: parsedSetup.hmipRoutingRestarted ?? false
    };
    window.localStorage.setItem(setupStorageKey, JSON.stringify({
      ...loadedSetup,
      ccuPassword: "",
      xmlApiToken: "",
      sshPassword: ""
    }));
    return loadedSetup;
  } catch {
    return initialForm;
  }
}

function loadSavedAnalysis(): AnalysisResponse | null {
  if (typeof window === "undefined") return null;

  try {
    const savedAnalysis = window.localStorage.getItem(analysisStorageKey);
    if (!savedAnalysis) return null;

    const parsedAnalysis = JSON.parse(savedAnalysis) as AnalysisResponse;
    const generatedAt = new Date(parsedAnalysis.generatedAt).getTime();
    if (!Number.isFinite(generatedAt) || Date.now() - generatedAt > 6 * 60 * 60 * 1000) {
      window.localStorage.removeItem(analysisStorageKey);
      return null;
    }

    return parsedAnalysis;
  } catch {
    return null;
  }
}

function saveAnalysisSnapshot(nextAnalysis: AnalysisResponse) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(analysisStorageKey, JSON.stringify(nextAnalysis));
  } catch {
  }
}

function firstRelevantCheckId(analysis: AnalysisResponse | null) {
  return analysis?.checks.find((check) => check.status !== "ok")?.id ?? analysis?.checks[0]?.id ?? null;
}

function getApiBaseUrl() {
  if (typeof window === "undefined") return "http://127.0.0.1:3001";

  const { protocol, hostname, port, origin } = window.location;
  if (port === "5173") return `${protocol}//${hostname}:3001`;
  return origin;
}

function hasShellSystemData(systemDashboard?: SystemDashboard) {
  if (!systemDashboard?.available) return false;

  return Boolean(
    parseCpuUsagePercent(systemDashboard.cpu) !== undefined
    || parseMemoryUsagePercent(systemDashboard.memory) !== undefined
    || parseTemperature(systemDashboard.temperature) !== undefined
    || parseDiskInfo(systemDashboard.disk)
    || parseDiskInfo(systemDashboard.backupDisk)
    || Number(systemDashboard.backups ?? 0) > 0
  );
}

function getCcuUiUrl(host: string) {
  const trimmed = host.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    return `${url.origin}/`;
  } catch {
    return undefined;
  }
}

function polarPoint(center: number, radius: number, percent: number) {
  const angle = (percent * 3.6 - 90) * Math.PI / 180;
  return {
    x: center + radius * Math.cos(angle),
    y: center + radius * Math.sin(angle)
  };
}

function donutSegmentPath(startPercent: number, endPercent: number, outerRadius = 48, innerRadius = 25) {
  const safeEnd = Math.min(endPercent, startPercent + 99.999);
  const outerStart = polarPoint(50, outerRadius, startPercent);
  const outerEnd = polarPoint(50, outerRadius, safeEnd);
  const innerEnd = polarPoint(50, innerRadius, safeEnd);
  const innerStart = polarPoint(50, innerRadius, startPercent);
  const largeArc = safeEnd - startPercent > 50 ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z"
  ].join(" ");
}

function RoutingTopologyView({
  topology,
  loading,
  selectedNodeId,
  onSelectNode,
  onRefresh
}: {
  topology: RoutingTopology | null;
  loading: boolean;
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
  onRefresh: () => void;
}) {
  const [hoveredNodeId, setHoveredNodeId] = useState("");
  const [includeSnifferRssi, setIncludeSnifferRssi] = useState(false);
  const [topologyScope, setTopologyScope] = useState<"hmip" | "bidcos" | "combined">("hmip");
  const [topologyFilter, setTopologyFilter] = useState<"focus" | "infrastructure" | "all">("focus");

  if (!topology) {
    return (
      <section className="routing-topology-card">
        <div className="routing-topology-empty">
          <strong>{loading ? "Routingdaten werden geladen …" : "Noch keine Topologiedaten geladen"}</strong>
          <button type="button" className="light-button" onClick={onRefresh} disabled={loading}>
            {loading ? "Lädt …" : "Jetzt laden"}
          </button>
        </div>
      </section>
    );
  }

  const central = topology.nodes.find((node) => node.role === "central");
  const visibleNodes = topology.nodes.filter((node) => (
    node.role === "central"
    || topologyScope === "combined"
    || node.protocol === topologyScope
  ));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = topology.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));
  const gateways = visibleNodes.filter((node) => node.role === "gateway");
  const routers = visibleNodes.filter((node) => node.role === "router");
  const candidates = visibleNodes.filter((node) => node.role === "candidate");
  const selectedNode = visibleNodes.find((node) => node.id === selectedNodeId) ?? central;
  const selectedRoute = selectedNode ? visibleEdges.find((edge) => edge.source === selectedNode.id) : undefined;
  const selectedReceiver = selectedRoute ? visibleNodes.find((node) => node.id === selectedRoute.target) : undefined;
  const rssiSource = includeSnifferRssi ? "combined" : "ccu";
  const nodeRssi = (node?: RoutingTopologyNode) => {
    if (!node) return undefined;
    if (!includeSnifferRssi) return node.ccuRssi;
    const values = [node.ccuRssi, node.snifferRssi].filter((value): value is number => value !== undefined);
    return values.length ? Math.min(...values) : undefined;
  };
  const rssiSourceLabel = includeSnifferRssi ? "mit Snifferwerten" : "ohne Snifferwerte";
  const rssiSourceShortLabel = includeSnifferRssi ? "CCU + Sniffer" : "CCU / XML-API";
  const confirmedSourceIds = new Set(visibleEdges.map((edge) => edge.source));
  const nodeClass = (node: RoutingTopologyNode) => {
    if (node.role === "central") return "is-central";
    if (node.role === "gateway") return "is-gateway";
    if (node.role === "router") return "is-router";
    if (node.role === "candidate") return "is-candidate";
    return "is-device";
  };
  const hasRoutingConfig = topology.diagnostics.some((item) => item.includes("direkt aus den HmIP-RF-Geräteparametern"));
  const measuredNodes = visibleNodes
    .filter((node) => node.role !== "central" && nodeRssi(node) !== undefined)
    .sort((left, right) => (nodeRssi(left) ?? 0) - (nodeRssi(right) ?? 0));
  const weakNodes = measuredNodes.filter((node) => rssiClass(nodeRssi(node)) === "weak");
  const observedNodes = measuredNodes.filter((node) => rssiClass(nodeRssi(node)) === "medium");
  const goodNodes = measuredNodes.filter((node) => rssiClass(nodeRssi(node)) === "good");
  const excellentNodes = measuredNodes.filter((node) => rssiClass(nodeRssi(node)) === "excellent");
  const confirmedTargetIds = new Set(visibleEdges.map((edge) => edge.target));
  const focusNodeIds = new Set([
    "central",
    ...gateways.map((node) => node.id),
    ...routers.map((node) => node.id),
    ...candidates.map((node) => node.id),
    ...weakNodes.map((node) => node.id),
    ...observedNodes.map((node) => node.id),
    ...confirmedSourceIds,
    ...confirmedTargetIds
  ]);
  const infrastructureNodeIds = new Set([
    "central",
    ...gateways.map((node) => node.id),
    ...routers.map((node) => node.id),
    ...candidates.map((node) => node.id)
  ]);
  const graphNodes = visibleNodes.filter((node) => (
    topologyFilter === "all"
    || (topologyFilter === "infrastructure" ? infrastructureNodeIds.has(node.id) : focusNodeIds.has(node.id))
  ));
  const graphNodeIds = new Set(graphNodes.map((node) => node.id));
  const graphEdges = visibleEdges.filter((edge) => graphNodeIds.has(edge.source) && graphNodeIds.has(edge.target));
  const graphGateways = graphNodes.filter((node) => node.role === "gateway");
  const graphRouters = graphNodes.filter((node) => node.role === "router");
  const graphCandidates = graphNodes.filter((node) => node.role === "candidate");
  const graphDevices = graphNodes.filter((node) => node.role === "device");
  const hiddenGraphNodes = Math.max(0, visibleNodes.length - graphNodes.length);
  const hoveredNode = graphNodes.find((node) => node.id === hoveredNodeId);
  const center = { x: 450, y: 260 };
  const positions = new Map<string, { x: number; y: number }>();
  positions.set("central", center);

  const signalRadius = (node: RoutingTopologyNode, fallback: number) => {
    const rssi = nodeRssi(node);
    if (rssi === undefined) return fallback;
    if (rssi >= -60) return 145;
    if (rssi >= -72) return 145 + ((-60 - rssi) / 12) * 35;
    if (rssi >= -85) return 180 + ((-72 - rssi) / 13) * 35;
    return Math.min(245, 215 + ((-85 - rssi) / 20) * 30);
  };

  const placeRing = (nodes: RoutingTopologyNode[], fallbackRadius: number, offset = -90) => {
    nodes.forEach((node, index) => {
      const angle = ((offset + (360 / Math.max(nodes.length, 1)) * index) * Math.PI) / 180;
      const radius = signalRadius(node, fallbackRadius);
      positions.set(node.id, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      });
    });
  };

  placeRing(graphGateways, 95, -135);
  placeRing(graphRouters, 130, -45);
  placeRing(graphCandidates, 185, -75);
  placeRing(graphDevices, 232, -88);

  const hoveredPosition = hoveredNode ? positions.get(hoveredNode.id) : undefined;
  const hoverLabelX = hoveredPosition ? Math.max(100, Math.min(800, hoveredPosition.x)) : 0;
  const hoverLabelY = hoveredPosition
    ? hoveredPosition.y < 70 ? hoveredPosition.y + 30 : hoveredPosition.y - 42
    : 0;
  const scopeLabel = topologyScope === "hmip"
    ? "Homematic IP"
    : topologyScope === "bidcos" ? "Klassisches Homematic" : "Gesamte Funkinstallation";
  const visibleDeviceCount = visibleNodes.filter((node) => node.role !== "central" && node.role !== "gateway").length;
  const receiverCount = gateways.length + routers.length;
  const focusCount = Math.max(0, focusNodeIds.size - 1);
  const infrastructureCount = Math.max(0, infrastructureNodeIds.size - 1);
  const allDeviceCount = Math.max(0, visibleNodes.length - 1);
  const mapSummary = topologyFilter === "focus"
    ? "Fokusansicht: Empfänger und Geräte mit Prüfbedarf."
    : topologyFilter === "infrastructure"
      ? "Infrastrukturansicht: Gateways, Router und Kandidaten."
      : "Gesamtansicht: alle bekannten Funkknoten.";
  const hasAttentionNodes = weakNodes.length > 0 || observedNodes.length > 0;
  const quickMapFilterTarget = hasAttentionNodes
    ? topologyFilter === "focus" ? "all" : "focus"
    : topologyFilter === "infrastructure" ? "all" : "infrastructure";
  const quickMapFilterLabel = hasAttentionNodes
    ? topologyFilter === "focus" ? "Alle Geräte zeigen" : "Auffällige zeigen"
    : topologyFilter === "infrastructure" ? "Alle Geräte zeigen" : "Empfänger zeigen";
  const quickMapFilterHint = hasAttentionNodes
    ? topologyFilter === "focus"
      ? "Zeigt zusätzlich alle unauffälligen oder noch nicht bewertbaren Geräte in der Karte."
      : "Reduziert die Karte auf Empfänger, Router sowie schwache oder zu beobachtende Geräte."
    : topologyFilter === "infrastructure"
      ? "Zeigt zusätzlich alle bekannten Geräte in der Karte."
      : "Reduziert die Karte auf Gateways, Router und mögliche Router.";
  const routeSummary = visibleEdges.length > 0
    ? `${visibleEdges.length} belegte Funkwege aus Logs oder Parametern.`
    : "Noch keine belegten Funkwege – gestrichelte Linien sind nur Orientierung.";
  const selectedRssi = nodeRssi(selectedNode);
  const selectedAdvice = (() => {
    if (!selectedNode) return "Wähle einen Knoten in der Karte, um die Bedeutung einzuordnen.";
    if (selectedNode.role === "central") return "Die Zentrale ist der Bezugspunkt. Geräte weiter außen werden schwächer empfangen oder haben noch keinen Messwert.";
    if (selectedNode.role === "gateway") return "Dieses Gerät ist ein eigener Funkempfänger. Es erweitert den Empfang, ist aber kein HmIP-Router.";
    if (selectedNode.role === "router") return "Dieses Gerät ist als HmIP-Router belegt. Es kann anderen HmIP-Geräten als Zwischenstation helfen.";
    const ccuState = rssiClass(selectedNode.ccuRssi);
    const snifferState = rssiClass(selectedNode.snifferRssi);
    if (ccuState === "weak" && snifferState === "weak") return "Beide Quellen sehen das Gerät schwach. Standort, Batterie/Stromversorgung, Entfernung und mögliche Router/Gateways prüfen.";
    if (ccuState === "weak") return "Die Zentrale sieht dieses Gerät schwach. Ein näherer Router/Gateway oder ein anderer Gerätestandort kann helfen.";
    if (snifferState === "weak") return "Nur der Sniffer sieht dieses Gerät schwach. Das kann am Sniffer-Standort liegen und ist nicht automatisch ein CCU-Problem.";
    if (selectedRssi !== undefined) return "Der aktuelle Signalwert ist unauffällig. Kein direkter Handlungsbedarf aus dieser Messquelle.";
    return "Für dieses Gerät liegt noch kein RSSI-Wert vor. Ohne Messwert wird kein Funkproblem behauptet.";
  })();
  const signalSummaryForNode = (node: RoutingTopologyNode) => {
    const parts = [`CCU ${node.ccuRssi ?? "–"} dBm`];
    if (includeSnifferRssi) parts.push(`Sniffer ${node.snifferRssi ?? "–"} dBm`);
    return `${node.name} (${parts.join(" / ")})`;
  };
  const signalDetailForNode = (node?: RoutingTopologyNode) => {
    if (!node) return "Keine Signalwerte";
    const ccuDetail = `Zentrale: ${node.ccuRssi ?? "nicht verfügbar"} dBm${node.ccuRssiSource ? ` (${node.ccuRssiSource})` : ""}`;
    if (!includeSnifferRssi) return ccuDetail;
    return `${ccuDetail} · Sniffer: ${node.snifferRssi ?? "nicht verfügbar"} dBm`;
  };

  return (
    <section className="routing-topology-card">
      <div className="routing-topology-header">
        <div>
          <p className="eyebrow">Routing-Karte</p>
          <h4>{scopeLabel}: Empfänger, Geräte und belegte Wege</h4>
          <p>Gateways sind eigene Funkempfänger, nicht automatisch Router. Durchgezogen = Funkweg belegt. Gestrichelt = reine Darstellungshilfe, der tatsächlich verwendete Empfänger ist noch unbekannt.</p>
        </div>
        <button type="button" className="light-button" onClick={onRefresh} disabled={loading}>
          {loading ? "Aktualisiert …" : "Karte aktualisieren"}
        </button>
      </div>

      <div className="routing-scope-switch" role="group" aria-label="Funktechnologie auswählen">
        <button type="button" className={topologyScope === "hmip" ? "is-active" : ""} onClick={() => setTopologyScope("hmip")}>HmIP</button>
        <button type="button" className={topologyScope === "bidcos" ? "is-active" : ""} onClick={() => setTopologyScope("bidcos")}>Homematic</button>
        <button type="button" className={topologyScope === "combined" ? "is-active" : ""} onClick={() => setTopologyScope("combined")}>Beides</button>
      </div>

      <details className="routing-reading-help">
        <summary>So liest du diese Karte</summary>
        <div>
          <span><b>Abstand zur Mitte:</b> weiter außen = schwächerer gemessener RSSI-Wert der gewählten Quelle.</span>
          <span><b>Durchgezogene Linie:</b> belegter Empfänger oder konfigurierter Router. Gestrichelt ist nur Orientierung, kein Fehler.</span>
          <span><b>Grün/gelb/rot:</b> Signalbewertung. Rot bedeutet zuerst prüfen, nicht automatisch „Gerät defekt“.</span>
          <span><b>G/R:</b> Gateway oder Router. Gateways sind Empfänger, aber nicht automatisch HmIP-Router.</span>
        </div>
      </details>

      <div className="routing-metrics">
        <span><strong>{visibleDeviceCount}</strong> Geräte</span>
        <span><strong>{gateways.length}</strong> Funk-Gateways</span>
        <span><strong>{routers.length}</strong> bestätigte HmIP-Router</span>
        <span><strong>{visibleEdges.length}</strong> belegte Wege</span>
      </div>

      {(topologyScope === "bidcos" || topologyScope === "combined") && gateways.length === 0 ? (
        <div className="routing-truth-note">
          <strong>Keine klassischen LAN-Gateways im aktuellen Snapshot</strong>
          <span>Aktualisiere die App und führe danach den Shell-Collector im Setup einmal erneut auf der CCU aus. Erst der neue Collector liest die Funk-Schnittstellen sicher aus.</span>
        </div>
      ) : null}

      <div className="routing-rssi-source">
        <div>
          <strong><SourceBadge source={includeSnifferRssi ? "Sniffer" : "CCU"} />Signalquelle</strong>
          <span>
            {!includeSnifferRssi
              ? "Von der CCU gemeldete Signalwerte. Für den Empfang an der Zentrale wird RSSI_PEER bevorzugt; RSSI_DEVICE dient nur als Rückfallwert."
              : "Zentralenwerte plus vorhandene Snifferwerte. Für die Position wird der schwächere bekannte Wert verwendet."}
          </span>
        </div>
        <label>
          Signalwerte anzeigen von
          <select value={includeSnifferRssi ? "with-sniffer" : "base"} onChange={(event) => setIncludeSnifferRssi(event.target.value === "with-sniffer")}>
            <option value="base">
              Ohne Snifferwerte ({visibleNodes.filter((node) => node.ccuRssi !== undefined).length} Zentralenwerte)
            </option>
            <option value="with-sniffer">
              Mit Snifferwerten ({visibleNodes.filter((node) => node.snifferRssi !== undefined).length} Snifferwerte)
            </option>
          </select>
        </label>
      </div>

      <div className={`routing-insight ${measuredNodes.length === 0 ? "is-unavailable" : weakNodes.length > 0 ? "has-warning" : "is-good"}`}>
        <div>
          <span className="routing-insight-icon" aria-hidden="true">{measuredNodes.length === 0 ? "?" : weakNodes.length > 0 ? "!" : "✓"}</span>
          <div>
            <strong>
              {measuredNodes.length === 0
                ? "Signalqualität noch nicht bewertbar"
                : weakNodes.length > 0 ? `${weakNodes.length} schwach empfangene Geräte prüfen` : "Keine klaren Signalschwächen erkannt"}
            </strong>
            <p>
              {measuredNodes.length === 0
                ? `Für die Ansicht „${rssiSourceLabel}“ liegen im aktuellen Snapshot keine RSSI-Werte vor. Erkannte Geräte, Gateways und Router werden trotzdem angezeigt – aber nicht als gut oder schlecht bewertet.`
                : weakNodes.length > 0
                ? `${weakNodes.slice(0, 4).map(signalSummaryForNode).join(", ")}${weakNodes.length > 4 ? " …" : ""}`
                : `${measuredNodes.length} Geräte wurden bewertet${observedNodes.length > 0 ? `, ${observedNodes.length} davon sollten beobachtet werden` : ""}.`}
            </p>
          </div>
        </div>
        <small>
          {!includeSnifferRssi
            ? "Weiter außen bedeutet: Die Zentrale sieht dieses Gerät schwächer. Das heißt nicht automatisch „keine Verbindung“, sondern zeigt zuerst Prüfbedarf für Standort, Abstand, Hindernisse oder passenden Empfänger."
            : "Weiter außen bedeutet: Mindestens eine bekannte Messquelle sieht dieses Gerät schwächer. Prüfe danach, ob CCU, Sniffer oder beide Quellen betroffen sind."}
          {" "}Eine gestrichelte Linie bedeutet nicht „offline“: Sie zeigt nur, dass der tatsächlich verwendete nächste Empfänger nicht aus den vorhandenen Daten abgeleitet werden konnte.
        </small>
      </div>

      <div className={`routing-map-summary ${measuredNodes.length === 0 ? "is-muted" : weakNodes.length > 0 ? "has-warning" : "is-good"}`}>
        <div>
          <strong>{mapSummary}</strong>
          <span>{routeSummary} Signalquelle: {rssiSourceShortLabel}.</span>
        </div>
        <button
          type="button"
          className="light-button"
          onClick={() => setTopologyFilter(quickMapFilterTarget)}
          title={quickMapFilterHint}
        >
          {quickMapFilterLabel}
        </button>
      </div>

      {measuredNodes.length > 0 ? (
        <div className="routing-signal-summary" aria-label={`Verteilung der Signalqualität für ${scopeLabel}: ${rssiSourceShortLabel}`}>
          <span className="excellent"><strong>{excellentNodes.length}</strong> sehr gut <small>ab −60 dBm</small></span>
          <span className="good"><strong>{goodNodes.length}</strong> gut <small>−61 bis −72 dBm</small></span>
          <span className="medium"><strong>{observedNodes.length}</strong> beobachten <small>−73 bis −85 dBm</small></span>
          <span className="weak"><strong>{weakNodes.length}</strong> schwach <small>unter −85 dBm</small></span>
        </div>
      ) : (
        <div className="routing-no-rssi">
          <div>
            <strong>{gateways.length + routers.length} bestätigte Funkempfänger und Router</strong>
            <span>{gateways.length} Gateway{gateways.length === 1 ? "" : "s"} · {routers.length} bestätigte HmIP-Router · {candidates.length} mögliche Router-Kandidaten</span>
          </div>
          <p>Die Karte zeigt zunächst nur die Infrastruktur. Alle Geräte kannst du bei Bedarf über „Alle Geräte“ einblenden.</p>
        </div>
      )}

      {measuredNodes.length > 0 && (
        <details className="routing-weak-devices" open={weakNodes.length > 0}>
          <summary>
            <span>
              <strong>Schwächste Geräte · {scopeLabel} · {rssiSourceShortLabel}</strong>
              <small>{includeSnifferRssi ? "Nach dem schwächeren bekannten Wert sortiert · beide Messquellen werden angezeigt" : "Nach Zentralenwert sortiert · Snifferwerte werden ausgeblendet"}</small>
            </span>
            <b>{Math.min(measuredNodes.length, 8)} anzeigen</b>
          </summary>
          <div>
            {measuredNodes.slice(0, 8).map((node) => (
              <button type="button" key={node.id} onClick={() => onSelectNode(node.id)}>
                <span>
                  <strong>{node.name}</strong>
                  <small>
                    {node.type ?? "HmIP-Gerät"}
                    {includeSnifferRssi ? ` · ${node.rssiTelegrams ?? 0} Sniffer-Telegramme` : " · CCU-Livewert"}
                  </small>
                </span>
                {includeSnifferRssi ? (
                  <DualRssiAssessment ccu={node.ccuRssi} sniffer={node.snifferRssi} compact />
                ) : (
                  <span className="single-rssi">
                    <small>Zentrale</small>
                    <RssiAssessment value={node.ccuRssi} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </details>
      )}

      <div className="routing-display-filter">
        <div>
          <strong>In der Grafik anzeigen</strong>
          <span>
            {topologyFilter === "focus"
              ? "Empfänger, Router und auffällige oder beobachtete Geräte"
              : topologyFilter === "infrastructure" ? "Nur Gateways, Router und mögliche Router" : "Alle erkannten Geräte"}
          </span>
        </div>
        <div role="group" aria-label="Umfang der Routing-Grafik">
          <button type="button" className={topologyFilter === "focus" ? "is-active" : ""} onClick={() => setTopologyFilter("focus")}>Fokus <small>{focusCount}</small></button>
          <button type="button" className={topologyFilter === "infrastructure" ? "is-active" : ""} onClick={() => setTopologyFilter("infrastructure")}>Empfänger <small>{infrastructureCount}</small></button>
          <button type="button" className={topologyFilter === "all" ? "is-active" : ""} onClick={() => setTopologyFilter("all")}>Alle <small>{allDeviceCount}</small></button>
        </div>
        {hiddenGraphNodes > 0 && <small>{hiddenGraphNodes} unauffällige oder noch nicht bewertbare Knoten sind ausgeblendet.</small>}
      </div>

      <div className="routing-topology-layout">
        <div className="routing-map-wrap">
          <svg className="routing-map" viewBox="0 0 900 520" role="img" aria-label="Grafische HmIP-Routing-Topologie">
            <defs>
              <marker id="routing-arrow-confirmed" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="strokeWidth">
                <path d="M 0 0 L 8 4 L 0 8 z" fill="#3478f6" />
              </marker>
              <marker id="routing-arrow-receiver" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto" markerUnits="strokeWidth">
                <path d="M 0 0 L 7 3.5 L 0 7 z" fill="#20a878" />
              </marker>
            </defs>
            {measuredNodes.length > 0 && (
              <>
                <circle className="routing-orbit routing-orbit-excellent" cx={center.x} cy={center.y} r="145" />
                <circle className="routing-orbit routing-orbit-good" cx={center.x} cy={center.y} r="180" />
                <circle className="routing-orbit routing-orbit-medium" cx={center.x} cy={center.y} r="215" />
                <circle className="routing-orbit routing-orbit-weak" cx={center.x} cy={center.y} r="245" />
                <text className="routing-zone-label excellent" x="608" y="123">sehr gut</text>
                <text className="routing-zone-label good" x="640" y="96">gut</text>
                <text className="routing-zone-label medium" x="671" y="69">beobachten</text>
                <text className="routing-zone-label weak" x="699" y="42">schwach</text>
              </>
            )}

            {graphNodes.filter((node) => node.role !== "central" && node.role !== "router" && node.role !== "gateway" && !confirmedSourceIds.has(node.id) && nodeRssi(node) !== undefined).map((node) => {
              const position = positions.get(node.id);
              if (!position) return null;
              return <line className="routing-edge is-unknown" key={`unknown-${node.id}`} x1={position.x} y1={position.y} x2={center.x} y2={center.y} />;
            })}

            {graphRouters.map((node) => {
              const position = positions.get(node.id);
              if (!position) return null;
              return <line className="routing-edge is-router-config" key={`router-${node.id}`} x1={position.x} y1={position.y} x2={center.x} y2={center.y} markerEnd="url(#routing-arrow-receiver)" />;
            })}

            {graphGateways.map((node) => {
              const position = positions.get(node.id);
              if (!position) return null;
              return <line className="routing-edge is-gateway" key={`gateway-${node.id}`} x1={position.x} y1={position.y} x2={center.x} y2={center.y} markerEnd="url(#routing-arrow-receiver)" />;
            })}

            {graphEdges.map((edge) => {
              const source = positions.get(edge.source);
              const target = positions.get(edge.target);
              if (!source || !target) return null;
              return (
                <line className="routing-edge is-confirmed" key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} markerEnd="url(#routing-arrow-confirmed)">
                  <title>{edge.evidence}</title>
                </line>
              );
            })}

            {graphNodes.map((node) => {
              const position = positions.get(node.id);
              if (!position) return null;
              const isSelected = selectedNode?.id === node.id;
              const rssi = nodeRssi(node);
              return (
                <g
                  className={`routing-node ${nodeClass(node)} ${isSelected ? "is-selected" : ""}`}
                  key={node.id}
                  transform={`translate(${position.x} ${position.y})`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectNode(node.id)}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId("")}
                  onFocus={() => setHoveredNodeId(node.id)}
                  onBlur={() => setHoveredNodeId("")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") onSelectNode(node.id);
                  }}
                >
                  {rssi !== undefined && (
                    <circle
                      className={`routing-signal-ring ${rssiClass(rssi)}`}
                      r={node.role === "router" ? 23 : 17}
                    />
                  )}
                  <circle r={node.role === "central" ? 31 : node.role === "gateway" ? 20 : node.role === "router" ? 18 : 12} />
                  <title>{`${node.name}${node.type ? ` · ${node.type}` : ""} · ${signalDetailForNode(node)}`}</title>
                  {node.role === "central" && (
                    <text className="routing-central-label" y="47" textAnchor="middle">{node.name}</text>
                  )}
                  {node.role === "gateway" && <text className="routing-node-icon" y="5" textAnchor="middle">G</text>}
                  {node.role === "router" && <text className="routing-node-icon" y="5" textAnchor="middle">R</text>}
                </g>
              );
            })}

            {hoveredNode && hoveredPosition && (
              <g className="routing-hover-label" transform={`translate(${hoverLabelX - 105} ${hoverLabelY})`} pointerEvents="none">
                <rect width="210" height="38" rx="9" />
                <text x="105" y="17" textAnchor="middle">{hoveredNode.name}</text>
                <text className="routing-hover-signal" x="105" y="31" textAnchor="middle">
                  {signalDetailForNode(hoveredNode)}
                </text>
              </g>
            )}

            {selectedNode && selectedNode.role !== "central" && positions.get(selectedNode.id) && (
              <g className="routing-selected-label" transform={`translate(${Math.max(110, Math.min(790, positions.get(selectedNode.id)!.x)) - 110} ${Math.max(18, Math.min(480, positions.get(selectedNode.id)!.y + 24))})`} pointerEvents="none">
                <rect width="220" height="30" rx="9" />
                <text x="110" y="19" textAnchor="middle">{selectedNode.name}</text>
              </g>
            )}
          </svg>

          <div className="routing-legend">
            <span><i className="legend-dot is-central" /> Zentrale</span>
            <span><i className="legend-dot is-gateway" /> Funk-Gateway / Access Point</span>
            <span><i className="legend-dot is-router" /> bestätigter Router</span>
            <span><i className="legend-dot is-candidate" /> möglicher netzversorgter Router</span>
            <span><i className="legend-signal excellent" /> Signal sehr gut</span>
            <span><i className="legend-signal good" /> Signal gut</span>
            <span><i className="legend-signal medium" /> beobachten</span>
            <span><i className="legend-signal weak" /> schwach</span>
            <span><i className="legend-line is-confirmed" /> Datenfluss zum Empfänger</span>
            <span><i className="legend-line is-unknown" /> Darstellungshilfe · Funkweg unbekannt</span>
          </div>
        </div>

        <aside className="routing-node-detail">
          <small>Ausgewählter Knoten</small>
          <h5>{selectedNode?.name ?? "Keine Auswahl"}</h5>
          {selectedNode?.type && <p>{selectedNode.type}</p>}
          {selectedNode?.serial && <p>Seriennummer: {selectedNode.serial}</p>}
          {selectedNode?.role !== "central" && (
            <dl>
              <div><dt>Technologie</dt><dd>{selectedNode?.protocol === "hmip" ? "Homematic IP" : "Klassisches Homematic"}</dd></div>
              <div><dt>Rolle</dt><dd>{selectedNode?.role === "gateway" ? "Funk-Gateway / Access Point" : selectedNode?.role === "router" ? "HmIP-Router" : "Funkgerät"}</dd></div>
              {selectedNode?.protocol === "hmip" && selectedNode?.role !== "gateway" && (
                <>
                  <div><dt>Dient als Router</dt><dd>{selectedNode?.routerEnabled ? "Ja, belegt" : "Nicht belegt"}</dd></div>
                  <div><dt>Routing aktiv</dt><dd>{selectedNode?.routingEnabled ? "Ja" : "Nicht belegt"}</dd></div>
                  <div><dt>Multicast-Routing</dt><dd>{selectedNode?.multicastRouting ? "Ja" : "Nicht belegt"}</dd></div>
                </>
              )}
              <div><dt>Nächster Empfänger</dt><dd>{selectedReceiver?.name ?? "Noch nicht belegt"}</dd></div>
              <div>
                <dt>Signalwerte</dt>
                <dd>
                  {includeSnifferRssi ? (
                    <DualRssiAssessment ccu={selectedNode?.ccuRssi} sniffer={selectedNode?.snifferRssi} />
                  ) : (
                    <span className="single-rssi">
                      <small>Zentrale</small>
                      <RssiAssessment value={selectedNode?.ccuRssi} />
                    </span>
                  )}
                  {includeSnifferRssi && selectedNode?.rssiTelegrams !== undefined && <small>{selectedNode.rssiTelegrams} Sniffer-Telegramme</small>}
                  {selectedNode?.ccuRssiSource && <small>CCU-Wert verwendet: {selectedNode.ccuRssiSource}</small>}
                </dd>
              </div>
            </dl>
          )}
          <div className={`routing-node-advice ${rssiClass(selectedRssi) ?? "unknown"}`}>
            <strong>Einordnung</strong>
            <span>{selectedAdvice}</span>
          </div>
          {selectedNode?.evidence.length ? (
            <ul>{selectedNode.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
          ) : (
            <p className="muted">Für diesen Knoten liegt noch kein spezieller Routing-Beleg im aktuellen Log vor.</p>
          )}
        </aside>
      </div>

      {topology.metrics.confirmedRoutes === 0 && (
        <div className="routing-truth-note">
          <strong>{hasRoutingConfig ? "Router-Schalter gelesen – aktive Wege noch nicht belegt." : "Router noch nicht zuverlässig geprüft."}</strong>
          <span>
            {hasRoutingConfig
              ? "Die Karte erfindet keine Pfade. Betätige HmIP-Geräte und aktualisiere anschließend die Karte, damit passende HmIPServer-Zeilen erfasst werden können."
              : "Orange Punkte sind nur netzversorgte Kandidaten. Führe den aktualisierten Shell-Collector erneut auf der CCU aus; er liest die drei Routing-Schalter jetzt lokal und ausschließlich lesend aus."}
          </span>
        </div>
      )}

      <div className="routing-technology-note">
        <strong>{topologyScope === "hmip" ? "HmIP-Routing" : topologyScope === "bidcos" ? "Klassische Homematic-Funkabdeckung" : "Gemeinsame Übersicht, getrennte Funktechnik"}</strong>
        <span>
          {topologyScope === "hmip"
            ? "HmIP-Geräte können – sofern unterstützt und ausdrücklich konfiguriert – als Router arbeiten. HmIP-Access-Points werden dagegen als Gateways dargestellt."
            : topologyScope === "bidcos"
              ? "Homematic LAN-Gateways erweitern den BidCos-RF-Empfang, sind aber keine HmIP-Router. Solange kein konkreter Empfänger belegt ist, erfindet die Karte keine Gateway-Zuordnung."
              : "Die Gesamtansicht zeigt beide Funkwelten zusammen. HmIP-Routingpfade und klassische Homematic-Gateways bleiben fachlich getrennt."}
        </span>
      </div>
    </section>
  );
}

function App() {
  const [form, setForm] = useState<SetupForm>(loadSavedSetup);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(initialNotificationSettings);
  const [currentPage, setCurrentPage] = useState<"analysis" | "dc" | "logs" | "diagnostics" | "setup" | "settings">("analysis");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const updateReloadStarted = useRef(false);
  const snifferAutoRefreshInFlight = useRef(false);
  const analysisAutoRefreshInFlight = useRef(false);
  const setupDefaultsSyncTimer = useRef<number | undefined>(undefined);
  const aiLogResultRef = useRef<HTMLElement | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(loadSavedAnalysis);
  const [loading, setLoading] = useState(false);
  const [analysisAutoRefreshing, setAnalysisAutoRefreshing] = useState(false);
  const [activeAnalysisStep, setActiveAnalysisStep] = useState(0);
  const [activeCheck, setActiveCheck] = useState<string | null>(() => firstRelevantCheckId(loadSavedAnalysis()));
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<CheckStatus | null>(null);
  const [analysisSnifferMode, setAnalysisSnifferMode] = useState<AnalysisSnifferMode>("base");
  const [showHealthyChecks, setShowHealthyChecks] = useState(false);
  const [expandedCheckThemes, setExpandedCheckThemes] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ccuScriptPreview, setCcuScriptPreview] = useState("");
  const [askSinScriptPreview, setAskSinScriptPreview] = useState("");
  const [collectorCommandPreview, setCollectorCommandPreview] = useState("");
  const [masterdataStatus, setMasterdataStatus] = useState<MasterdataStatus | null>(null);
  const [collectorStatus, setCollectorStatus] = useState<CollectorStatus | null>(null);
  const [routingStatus, setRoutingStatus] = useState<RoutingStatus | null>(null);
  const [routingStatusLoading, setRoutingStatusLoading] = useState(false);
  const [routingTopology, setRoutingTopology] = useState<RoutingTopology | null>(null);
  const [routingTopologyLoading, setRoutingTopologyLoading] = useState(false);
  const [selectedRoutingNodeId, setSelectedRoutingNodeId] = useState("central");
  const [collectorMode, setCollectorMode] = useState<"once" | "install" | "uninstall">("once");
  const [collectorInterval, setCollectorInterval] = useState<"daily" | "hourly" | "minute">("minute");
  const [savingSettings, setSavingSettings] = useState(false);
  const [updatingApp, setUpdatingApp] = useState(false);
  const [showUpdateConfirm, setShowUpdateConfirm] = useState(false);
  const [updateRunStatus, setUpdateRunStatus] = useState<UpdateRunStatus | null>(null);
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});
  const [usbPorts, setUsbPorts] = useState<UsbPort[]>([]);
  const [usbPortsLoading, setUsbPortsLoading] = useState(false);
  const [snifferSnapshot, setSnifferSnapshot] = useState<SnifferSnapshot | null>(null);
  const [snifferHistory, setSnifferHistory] = useState<SnifferHistoryPayload | null>(null);
  const [snifferLoading, setSnifferLoading] = useState(false);
  const [showAllSnifferDevices, setShowAllSnifferDevices] = useState(false);
  const [showAllSnifferEvents, setShowAllSnifferEvents] = useState(false);
  const [activeSnifferMinute, setActiveSnifferMinute] = useState<number | null>(null);
  const [hoveredDutySegmentKey, setHoveredDutySegmentKey] = useState<string | null>(null);
  const [logPayload, setLogPayload] = useState<LogPayload | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [aiLogResult, setAiLogResult] = useState<AnalysisCheck | null>(null);
  const [aiLogLoading, setAiLogLoading] = useState(false);
  const [aiLogMode, setAiLogMode] = useState<"issues" | "full">("issues");
  const [diagnostics, setDiagnostics] = useState<DiagnosticsPayload | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [analysisHistory, setAnalysisHistory] = useState<AnalysisHistoryPayload | null>(null);
  const [ccuTestResult, setCcuTestResult] = useState<CcuTestResult | null>(null);
  const [ccuTestLoading, setCcuTestLoading] = useState(false);
  const [manualSnifferPort, setManualSnifferPort] = useState(false);
  const [dashboardRefreshProgress, setDashboardRefreshProgress] = useState(0);
  const [dashboardRefreshSecondsLeft, setDashboardRefreshSecondsLeft] = useState(60);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [actionModal, setActionModal] = useState<ActionModal>(null);
  const [actionModalCheckId, setActionModalCheckId] = useState<string | null>(null);
  const [signalFocusDeviceName, setSignalFocusDeviceName] = useState("");
  const [signalSourceFilter, setSignalSourceFilter] = useState<"both" | "ccu">("ccu");
  const [backupPage, setBackupPage] = useState(0);
  const [configurationPassphrase, setConfigurationPassphrase] = useState("");
  const [configurationBusy, setConfigurationBusy] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    state: "checking",
    label: "Update wird geprüft",
    detail: "GitHub wird nach der neuesten Version gefragt.",
    url: repositoryUrl
  });
  const [centralUpdateStatus, setCentralUpdateStatus] = useState<UpdateStatus | null>(null);

  const pageLabels = {
    analysis: "Analyse",
    dc: "DC-Analyzer",
    logs: "Logs",
    diagnostics: "Status",
    settings: "Einstellungen",
    setup: "Setup"
  } satisfies Record<typeof currentPage, string>;

  function navigateTo(page: typeof currentPage) {
    setCurrentPage(page);
    setMobileMenuOpen(false);
  }

  function navigateHome() {
    navigateTo("analysis");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const hasAnalysis = Boolean(analysis);
  const displayedChecks = useMemo(() => (
    analysis?.checks
      .map((check) => filterSnifferFromCheck(check, analysisSnifferMode))
      .filter((check): check is AnalysisCheck => Boolean(check)) ?? []
  ), [analysis, analysisSnifferMode]);
  const displayedAnalysis = useMemo(() => (
    analysis ? { ...analysis, checks: displayedChecks } : null
  ), [analysis, displayedChecks]);
  const snifferAffectedChecks = useMemo(() => (
    analysis?.checks.filter(checkUsesSniffer).length ?? 0
  ), [analysis]);
  const isUpdateRunning = updatingApp || updateRunStatus?.status === "running";
  const backupItems = analysis?.systemDashboard?.backupItems ?? [];
  const backupPageSize = 25;
  const backupPageCount = Math.max(1, Math.ceil(backupItems.length / backupPageSize));
  const visibleBackupItems = backupItems.slice(backupPage * backupPageSize, (backupPage + 1) * backupPageSize);
  const weakestRssiDevice = snifferSnapshot?.summary.weakestRssiDevice;
  const topDutyDevice = snifferSnapshot?.devices[0];
  const gatewayDutyCycleCards = snifferSnapshot?.summary.gateways?.slice(0, 3) ?? [];
  const visibleSnifferDevices = showAllSnifferDevices
    ? snifferSnapshot?.devices ?? []
    : snifferSnapshot?.devices.slice(0, 10) ?? [];
  const visibleSnifferEvents = showAllSnifferEvents
    ? snifferSnapshot?.events ?? []
    : snifferSnapshot?.events.slice(0, 10) ?? [];
  const ccuDutyCheck = analysis?.checks.find((check) => check.id === "duty-cycle");
  const ccuDutyEvidence = ccuDutyCheck?.evidence.find((item) => item.source.includes("CCU"));
  const analysisSourceItems = useMemo(() => {
    if (!analysis) return [];
    return [
      {
        id: "ccu",
        label: "CCU Live",
        time: analysis.sources?.ccu,
        required: true,
        purpose: "Geräte, Servicemeldungen, Batterien, Duty Cycle und RSSI der Zentrale.",
        action: "Status öffnen",
        actionType: "diagnostics" as const
      },
      {
        id: "masterdata",
        label: "CCU-Script",
        time: analysis.sources?.masterdata,
        required: false,
        purpose: "Stammdaten, Gerätenamen, AskSin-Namensliste und zusätzliche CCU-Systemvariablen.",
        action: "Script anzeigen",
        actionType: "masterdata" as const
      },
      {
        id: "collector",
        label: "Shell-Collector",
        time: analysis.sources?.collector,
        required: false,
        purpose: "CPU, RAM, Temperatur, Speicher, Backups, Logs und aktive Verbindungen.",
        action: "Collector öffnen",
        actionType: "collector" as const
      },
      {
        id: "sniffer",
        label: "AskSin-Sniffer",
        time: analysis.sources?.sniffer,
        required: false,
        hidden: !form.snifferEnabled || analysisSnifferMode === "base",
        purpose: "Telegramme, Funklast, Rauschpegel und RSSI am Standort des Sniffers.",
        action: "DC öffnen",
        actionType: "dc" as const
      }
    ].filter((item) => !item.hidden);
  }, [analysis, form.snifferEnabled, analysisSnifferMode]);
  const routingNodeByIdentifier = useMemo(() => {
    const map = new Map<string, RoutingTopologyNode>();
    for (const node of routingTopology?.nodes ?? []) {
      for (const identifier of [node.id, node.serial, node.address]) {
        const normalized = normalizeRadioIdentifier(identifier);
        if (normalized) map.set(normalized, node);
      }
    }
    return map;
  }, [routingTopology]);
  const topologyNodeFor = (device: { address?: string; serial?: string }) => (
    routingNodeByIdentifier.get(normalizeRadioIdentifier(device.serial))
    ?? routingNodeByIdentifier.get(normalizeRadioIdentifier(device.address))
  );
  const allSignalQualityDevices = useMemo(() => {
    const map = new Map<string, {
      key: string;
      name: string;
      type?: string;
      serial?: string;
      address?: string;
      ccuRssi?: number;
      snifferRssi?: number;
      telegrams?: number;
    }>();

    const upsert = (key: string, patch: Partial<{
      name: string;
      type?: string;
      serial?: string;
      address?: string;
      ccuRssi?: number;
      snifferRssi?: number;
      telegrams?: number;
    }>) => {
      const existing = map.get(key);
      map.set(key, {
        key,
        name: patch.name ?? existing?.name ?? patch.serial ?? patch.address ?? key,
        type: patch.type ?? existing?.type,
        serial: patch.serial ?? existing?.serial,
        address: patch.address ?? existing?.address,
        ccuRssi: patch.ccuRssi ?? existing?.ccuRssi,
        snifferRssi: patch.snifferRssi ?? existing?.snifferRssi,
        telegrams: patch.telegrams ?? existing?.telegrams
      });
    };

    for (const node of routingTopology?.nodes ?? []) {
      if (node.role === "central" || node.ccuRssi === undefined) continue;
      const key = normalizeRadioIdentifier(node.serial) || normalizeRadioIdentifier(node.address) || node.id;
      upsert(key, {
        name: node.name,
        type: node.type,
        serial: node.serial,
        address: node.address,
        ccuRssi: node.ccuRssi
      });
    }

    for (const device of snifferSnapshot?.devices ?? []) {
      if (device.avgRssi === undefined) continue;
      const key = normalizeRadioIdentifier(device.serial) || normalizeRadioIdentifier(device.address) || device.address;
      const node = topologyNodeFor(device);
      upsert(key, {
        name: node?.name ?? device.name,
        type: node?.type ?? device.type,
        serial: node?.serial ?? device.serial,
        address: node?.address ?? device.address,
        ccuRssi: node?.ccuRssi,
        snifferRssi: device.avgRssi,
        telegrams: device.telegrams
      });
    }

    return Array.from(map.values());
  }, [routingTopology, snifferSnapshot, routingNodeByIdentifier]);
  const signalReceiverOptions = useMemo<SignalReceiverOption[]>(() => (routingTopology?.nodes ?? [])
    .filter((node) => node.role === "gateway" || node.role === "router" || node.role === "candidate")
    .map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      protocol: node.protocol === "hmip" ? "hmip" : "bidcos",
      role: node.role === "gateway" ? "gateway" : node.role === "router" ? "router" : "candidate",
      routerEnabled: node.routerEnabled,
      routingEnabled: node.routingEnabled
    })), [routingTopology]);
  const carrierSenseText = snifferSnapshot?.summary.carrierSense !== undefined
    ? `${snifferSnapshot.summary.carrierSense} dBm`
    : "nicht gemessen";
  const carrierSenseHint = snifferSnapshot?.summary.carrierSenseAvg !== undefined
    ? `Aktueller Rauschpegel, Ø ${snifferSnapshot.summary.carrierSenseAvg} dBm in den letzten 60 Minuten. Kein Prozentwert.`
    : "Rauschpegel-Messwerte des Sniffers (`:xx;`) in dBm, nicht in Prozent.";

  const scriptUrl = useMemo(() => {
    const baseUrl = getApiBaseUrl();
    const params = new URLSearchParams({
      url: baseUrl,
      token: "homematic-analyzer-demo-token",
      mode: collectorMode,
      interval: collectorInterval
    });
    return `${baseUrl}/api/collector/script?${params.toString()}`;
  }, [collectorMode, collectorInterval]);

  const ccuMasterdataScriptUrl = useMemo(() => {
    const baseUrl = getApiBaseUrl();
    const params = new URLSearchParams({
      url: baseUrl,
      token: "homematic-analyzer-demo-token"
    });
    return `${baseUrl}/api/ccu-masterdata/script?${params.toString()}`;
  }, []);

  const askSinDevListScriptUrl = useMemo(() => {
    const baseUrl = getApiBaseUrl();
    const params = new URLSearchParams({
      url: baseUrl,
      token: "homematic-analyzer-demo-token"
    });
    return `${baseUrl}/api/asksin-devlist/script?${params.toString()}`;
  }, []);

  const collectorCommand = useMemo(() => `curl -fsSL "${scriptUrl}" | sh`, [scriptUrl]);
  const recommendedCollectorCommand = useMemo(() => {
    const baseUrl = getApiBaseUrl();
    const params = new URLSearchParams({
      url: baseUrl,
      token: "homematic-analyzer-demo-token",
      mode: "install",
      interval: "minute"
    });
    return `curl -fsSL "${baseUrl}/api/collector/script?${params.toString()}" | sh`;
  }, []);
  const collectorUninstallCommand = useMemo(() => {
    const baseUrl = getApiBaseUrl();
    const params = new URLSearchParams({
      url: baseUrl,
      token: "homematic-analyzer-demo-token",
      mode: "uninstall",
      interval: "minute"
    });
    return `curl -fsSL "${baseUrl}/api/collector/script?${params.toString()}" | sh`;
  }, []);
  const ccuUiUrl = useMemo(() => getCcuUiUrl(form.ccuHost), [form.ccuHost]);

  const usesLocalAnalyzerUrl = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
  }, []);

  const selectedSnifferPortIsKnown = useMemo(
    () => usbPorts.some((usbPort) => usbPort.path === form.snifferPort),
    [form.snifferPort, usbPorts]
  );
  const showManualSnifferPort = manualSnifferPort || (Boolean(form.snifferPort) && !selectedSnifferPortIsKnown);
  const snifferPortSelectValue = form.snifferPort && selectedSnifferPortIsKnown
    ? form.snifferPort
    : showManualSnifferPort
      ? "__manual__"
      : "";
  const setupProgress = useMemo(() => {
    const steps = [
      Boolean(form.ccuHost.trim()),
      Boolean(form.ccuUser.trim() && form.ccuPassword),
      Boolean((form.xmlApiToken ?? "").trim())
    ];
    const completed = steps.filter(Boolean).length;
    return {
      completed,
      total: steps.length,
      percent: Math.round((completed / steps.length) * 100),
      complete: completed === steps.length
    };
  }, [form]);
  const setupGroups = useMemo(() => {
    const basisDone = setupProgress.complete;
    const systemDone = Boolean(
      collectorStatus?.available
      || collectorStatus?.collectedAt
      || masterdataStatus?.available
      || (form.sshUser.trim() && form.sshPassword)
    );
    const snifferDone = !form.snifferEnabled || Boolean(form.snifferPort.trim());
    const notificationDone = notificationSettings.telegram.enabled || notificationSettings.email.enabled;
    return [
      {
        label: "Basis",
        text: "CCU, Login und XML-API Token",
        done: basisDone,
        optional: false,
        hint: basisDone ? "Analyse kann echte CCU-Daten lesen." : "Erst diese Felder ausfüllen."
      },
      {
        label: "System",
        text: "Collector, Logs oder SSH",
        done: systemDone,
        optional: true,
        hint: systemDone ? "Systemdaten können ergänzt werden." : "Optional für Logs, Backups und Systemwerte."
      },
      {
        label: "Sniffer",
        text: "AskSin-Funkdetails",
        done: snifferDone,
        optional: true,
        hint: form.snifferEnabled ? "Port wählen, wenn der Sniffer genutzt wird." : "Ausgeschaltet – Basisanalyse bleibt sauber."
      },
      {
        label: "Benachrichtigung",
        text: "Telegram oder E-Mail",
        done: notificationDone,
        optional: true,
        hint: notificationDone ? "Meldungen können versendet werden." : "Optional, wenn du aktiv erinnert werden willst."
      }
    ];
  }, [collectorStatus, form, masterdataStatus, notificationSettings, setupProgress]);

  function removeToast(id: number) {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== id));
  }

  function showToast(toast: Omit<Toast, "id">) {
    const id = Date.now() + Math.random();
    setToasts((currentToasts) => [{ id, ...toast }, ...currentToasts].slice(0, 4));
    window.setTimeout(() => removeToast(id), toast.type === "error" ? 7000 : 4500);
  }

  function updateForm(nextForm: SetupForm) {
    setForm(nextForm);
    try {
      window.localStorage.setItem(setupStorageKey, JSON.stringify({
        ...nextForm,
        ccuPassword: "",
        xmlApiToken: "",
        sshPassword: ""
      }));
    } catch {
      showToast({
        type: "warning",
        title: "Speichern nicht möglich",
        message: "Der Browser lässt lokale Speicherung gerade nicht zu."
      });
    }

    if (setupDefaultsSyncTimer.current) {
      window.clearTimeout(setupDefaultsSyncTimer.current);
    }
    setupDefaultsSyncTimer.current = window.setTimeout(() => {
      void syncSetupDefaults(nextForm);
    }, 450);
  }

  async function syncSetupDefaults(nextForm: SetupForm) {
    try {
      await fetch("/api/setup/defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ccuHost: nextForm.ccuHost.trim(),
          ccuUser: nextForm.ccuUser.trim(),
          ccuPassword: nextForm.ccuPassword,
          xmlApiToken: (nextForm.xmlApiToken ?? "").trim(),
          sshUser: nextForm.sshUser.trim(),
          sshPassword: nextForm.sshPassword,
          snifferEnabled: nextForm.snifferEnabled,
          snifferPort: nextForm.snifferPort.trim(),
          hmipRoutingEnabled: nextForm.hmipRoutingEnabled,
          hmipRoutingLogLevelSet: nextForm.hmipRoutingLogLevelSet,
          hmipRoutingRestarted: nextForm.hmipRoutingRestarted
        })
      });
    } catch {
    }
  }

  async function exportConfigurationBackup() {
    if (configurationPassphrase.length < 8) {
      showToast({ type: "warning", title: "Backup-Passwort zu kurz", message: "Bitte mindestens 8 Zeichen verwenden." });
      return;
    }
    setConfigurationBusy(true);
    try {
      const response = await fetch("/api/settings/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: configurationPassphrase })
      });
      if (!response.ok) throw new Error("Backup konnte nicht erstellt werden.");
      const backup = await response.json();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `homematic-analyzer-config-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      showToast({ type: "success", title: "Konfiguration gesichert", message: "Die Backup-Datei ist mit deinem Passwort verschlüsselt." });
    } catch (caughtError) {
      showToast({ type: "error", title: "Backup fehlgeschlagen", message: caughtError instanceof Error ? caughtError.message : "Lokale API prüfen." });
    } finally {
      setConfigurationBusy(false);
    }
  }

  async function restoreConfigurationBackup(file: File) {
    if (configurationPassphrase.length < 8) {
      showToast({ type: "warning", title: "Backup-Passwort fehlt", message: "Gib zuerst das Passwort der Backup-Datei ein." });
      return;
    }
    setConfigurationBusy(true);
    try {
      const backup = JSON.parse(await file.text());
      const response = await fetch("/api/settings/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: configurationPassphrase, backup })
      });
      const result = await response.json() as {
        error?: string;
        setupDefaults?: SetupDefaults;
        notificationSettings?: NotificationSettings;
      };
      if (!response.ok) throw new Error(result.error ?? "Backup konnte nicht wiederhergestellt werden.");
      if (result.setupDefaults) {
        setForm((current) => ({ ...current, ...result.setupDefaults }));
      }
      if (result.notificationSettings) {
        setNotificationSettings({
          telegram: { ...initialNotificationSettings.telegram, ...result.notificationSettings.telegram },
          email: { ...initialNotificationSettings.email, ...result.notificationSettings.email },
          events: { ...initialNotificationSettings.events, ...result.notificationSettings.events },
          ai: { ...initialNotificationSettings.ai, ...result.notificationSettings.ai }
        });
      }
      showToast({ type: "success", title: "Konfiguration wiederhergestellt", message: "Setup und Einstellungen wurden übernommen." });
    } catch (caughtError) {
      showToast({ type: "error", title: "Wiederherstellung fehlgeschlagen", message: caughtError instanceof Error ? caughtError.message : "Datei und Passwort prüfen." });
    } finally {
      setConfigurationBusy(false);
    }
  }

  function toggleSecret(name: string) {
    setVisibleSecrets((current) => ({ ...current, [name]: !current[name] }));
  }

  async function loadUsbPorts(showSuccessToast = false) {
    setUsbPortsLoading(true);
    try {
      const response = await fetch("/api/system/usb-ports");
      if (!response.ok) throw new Error("USB-Port-Scan fehlgeschlagen.");

      const result = (await response.json()) as { ports?: UsbPort[] };
      const ports = result.ports ?? [];
      setUsbPorts(ports);

      if (form.snifferPort && !ports.some((usbPort) => usbPort.path === form.snifferPort)) {
        setManualSnifferPort(true);
      }

      if (showSuccessToast) {
        showToast({
          type: ports.length > 0 ? "success" : "info",
          title: "USB-Ports geprüft",
          message: ports.length > 0 ? `${ports.length} möglicher Port gefunden.` : "Kein USB-Seriell-Port sichtbar."
        });
      }
    } catch {
      if (showSuccessToast) {
        showToast({
          type: "warning",
          title: "USB-Ports nicht lesbar",
          message: "Du kannst den Port weiterhin manuell eintragen."
        });
      }
    } finally {
      setUsbPortsLoading(false);
    }
  }

  async function loadRoutingStatus(showResultToast = false) {
    setRoutingStatusLoading(true);
    try {
      const response = await fetch("/api/routing/status");
      if (!response.ok) throw new Error("Routing-Diagnose konnte nicht geprüft werden.");
      const result = (await response.json()) as RoutingStatus;
      setRoutingStatus(result);
      if (showResultToast) {
        showToast({
          type: result.hmipLogReceived ? "success" : "warning",
          title: result.hmipLogReceived ? "HmIP-Log wird empfangen" : "Noch keine HmIP-Logdaten",
          message: result.hmipLogReceived
            ? `${result.hmipLogLines} aktuelle Zeilen von ${result.host ?? "der Zentrale"} empfangen.`
            : result.collectorState === "stale"
              ? "Der Collector sendet nicht mehr aktuell. Bitte den Collector zuerst reparieren."
              : "Nach Log-Level-Änderung, Neustart und Collector-Lauf erneut testen."
        });
      }
    } catch (caughtError) {
      if (showResultToast) {
        showToast({
          type: "error",
          title: "Routing-Test fehlgeschlagen",
          message: caughtError instanceof Error ? caughtError.message : "Unbekannter Fehler"
        });
      }
    } finally {
      setRoutingStatusLoading(false);
    }
  }

  async function loadRoutingTopology(showResultToast = false) {
    setRoutingTopologyLoading(true);
    try {
      const response = await fetch("/api/routing/topology");
      if (!response.ok) throw new Error("Routing-Topologie konnte nicht geladen werden.");
      const result = (await response.json()) as RoutingTopology;
      setRoutingTopology(result);
      setSelectedRoutingNodeId((current) => result.nodes.some((node) => node.id === current) ? current : "central");
      if (showResultToast) {
        showToast({
          type: result.state === "ready" ? "success" : result.state === "partial" ? "info" : "warning",
          title: result.state === "ready" ? "Routing-Topologie aktualisiert" : "Routing-Daten aktualisiert",
          message: result.metrics.confirmedRoutes > 0
            ? `${result.metrics.confirmedRoutes} belegte Pfade und ${result.metrics.confirmedRouters} bestätigte Router gefunden.`
            : `${result.metrics.hmipDevices} HmIP- und ${result.metrics.bidcosDevices} klassische Homematic-Geräte gefunden; aktive Pfade sind im aktuellen Log noch nicht belegt.`
        });
      }
    } catch (caughtError) {
      if (showResultToast) {
        showToast({
          type: "error",
          title: "Topologie nicht verfügbar",
          message: caughtError instanceof Error ? caughtError.message : "Unbekannter Fehler"
        });
      }
    } finally {
      setRoutingTopologyLoading(false);
    }
  }

  async function loadSnifferSnapshot(showSuccessToast = false, showLoading = true) {
    if (!form.snifferEnabled) {
      setSnifferSnapshot(null);
      setSnifferHistory(null);
      return;
    }
    if (snifferAutoRefreshInFlight.current) return;
    snifferAutoRefreshInFlight.current = true;
    if (showLoading) setSnifferLoading(true);
    try {
      const response = await fetch("/api/sniffer/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port: form.snifferPort.trim() })
      });

      if (!response.ok) throw new Error("Snifferdaten konnten nicht gelesen werden.");

      const snapshot = (await response.json()) as SnifferSnapshot;
      setSnifferSnapshot(snapshot);
      const historyResponse = await fetch("/api/sniffer/history", { cache: "no-store" });
      if (historyResponse.ok) {
        setSnifferHistory((await historyResponse.json()) as SnifferHistoryPayload);
      }
      if (showSuccessToast) {
        showToast({
          type: snapshot.connected ? "success" : snapshot.configured ? "warning" : "info",
          title: "DC-Analyzer geprüft",
          message: snapshot.connected
            ? `${snapshot.summary.telegrams} Sniffer-Zeilen ausgewertet.`
            : snapshot.configured
              ? "Port ist eingetragen, aber noch keine Snifferdaten vorhanden."
              : "Bitte zuerst einen Sniffer-Port im Setup auswählen."
        });
      }
    } catch {
      if (showSuccessToast) {
        showToast({
          type: "warning",
          title: "Sniffer nicht lesbar",
          message: "Prüfe USB-Port, Rechte und ob AskSin Analyzer XS Daten liefert."
        });
      }
    } finally {
      if (showLoading) setSnifferLoading(false);
      snifferAutoRefreshInFlight.current = false;
    }
  }

  async function loadLogs(showSuccessToast = false) {
    setLogsLoading(true);
    try {
      const response = await fetch(`/api/logs/latest?fresh=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Logs konnten nicht geladen werden.");
      const payload = (await response.json()) as LogPayload;
      setLogPayload(payload);
      if (showSuccessToast) {
        showToast({
          type: payload.available ? "success" : "info",
          title: "Logs geladen",
          message: payload.available ? `${payload.logs.length} Logzeilen geladen.` : "Noch keine Logzeilen vorhanden."
        });
      }
    } catch {
      if (showSuccessToast) {
        showToast({
          type: "warning",
          title: "Logs nicht geladen",
          message: "Prüfe, ob der Collector Logdaten an den Analyzer sendet."
        });
      }
    } finally {
      setLogsLoading(false);
    }
  }

  async function loadDiagnostics(showSuccessToast = false) {
    setDiagnosticsLoading(true);
    try {
      const [diagnosticsResponse, historyResponse] = await Promise.all([
        fetch("/api/diagnostics", { cache: "no-store" }),
        fetch("/api/analysis/history", { cache: "no-store" })
      ]);
      if (!diagnosticsResponse.ok || !historyResponse.ok) throw new Error("Diagnosedaten konnten nicht geladen werden.");
      setDiagnostics((await diagnosticsResponse.json()) as DiagnosticsPayload);
      setAnalysisHistory((await historyResponse.json()) as AnalysisHistoryPayload);
      if (showSuccessToast) {
        showToast({
          type: "success",
          title: "Status aktualisiert",
          message: "Alle lokalen Datenquellen wurden neu eingelesen."
        });
      }
    } catch {
      if (showSuccessToast) {
        showToast({
          type: "warning",
          title: "Status nicht geladen",
          message: "Die lokale Diagnose-API ist momentan nicht erreichbar."
        });
      }
    } finally {
      setDiagnosticsLoading(false);
    }
  }

  async function testCcuConnection() {
    setCcuTestLoading(true);
    setCcuTestResult(null);
    try {
      const response = await fetch("/api/ccu/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ccuHost: form.ccuHost.trim(),
          ccuUser: form.ccuUser.trim(),
          ccuPassword: form.ccuPassword,
          xmlApiToken: (form.xmlApiToken ?? "").trim(),
          hasCcuPassword: Boolean(form.ccuPassword)
        })
      });
      const result = (await response.json()) as CcuTestResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "CCU-Test fehlgeschlagen.");
      setCcuTestResult(result);
      showToast({
        type: result.reachable ? "success" : result.webUiReachable ? "warning" : "error",
        title: result.reachable ? "CCU-Verbindung funktioniert" : "CCU-Test abgeschlossen",
        message: result.reachable
          ? `${result.devices} Geräte wurden gelesen.`
          : result.error ?? "Die Prüfschritte zeigen, wo die Verbindung scheitert."
      });
    } catch (error) {
      showToast({
        type: "error",
        title: "CCU-Test nicht möglich",
        message: error instanceof Error ? error.message : "Bitte lokale API prüfen."
      });
    } finally {
      setCcuTestLoading(false);
    }
  }

  async function analyzeLogsWithAi() {
    if (!logPayload?.available || logPayload.logs.length === 0) {
      showToast({
        type: "warning",
        title: "Keine Logdaten vorhanden",
        message: "Lade zuerst aktuelle Logs über den Collector. Ohne Logzeilen wird nichts an eine KI gesendet."
      });
      return;
    }

    if (!notificationSettings.ai.enabled) {
      showToast({
        type: "info",
        title: "KI-Logauswertung ist ausgeschaltet",
        message: "Aktiviere sie unter Einstellungen → KI-Logauswertung und hinterlege dort einen API-Key."
      });
      return;
    }

    setAiLogLoading(true);
    setAiLogResult(null);
    showToast({
      type: "info",
      title: "KI-Analyse gestartet",
      message: "Erst jetzt werden die angezeigten Logdaten an den gewählten KI-Anbieter gesendet."
    });
    try {
      const response = await fetch("/api/logs/analyze-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: aiLogMode })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(payload.message ?? "KI-Analyse konnte nicht gestartet werden.");
      }
      const result = (await response.json()) as AnalysisCheck;
      setAiLogResult(result);
      showToast({
        type: result.status === "critical" || result.status === "warning" ? "warning" : "success",
        title: "KI-Analyse fertig",
        message: result.summary
      });
    } catch (caughtError) {
      showToast({
        type: "warning",
        title: "KI-Analyse nicht möglich",
        message: caughtError instanceof Error ? caughtError.message : "Bitte Settings/API-Key prüfen."
      });
    } finally {
      setAiLogLoading(false);
    }
  }

  function selectSnifferPort(value: string) {
    if (value === "__manual__") {
      setManualSnifferPort(true);
      return;
    }

    setManualSnifferPort(false);
    updateForm({ ...form, snifferPort: value });
  }

  async function copyText(text: string) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
    }

    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  }

  function updateNotificationSettings(nextSettings: NotificationSettings) {
    setNotificationSettings(nextSettings);
  }

  async function saveNotificationSettings() {
    setSavingSettings(true);
    try {
      const response = await fetch("/api/settings/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notificationSettings)
      });

      if (!response.ok) throw new Error("Einstellungen konnten nicht gespeichert werden.");
      const result = (await response.json()) as { settings?: NotificationSettings };
      if (result.settings) {
        setNotificationSettings({
          telegram: { ...initialNotificationSettings.telegram, ...result.settings.telegram },
          email: { ...initialNotificationSettings.email, ...result.settings.email },
          events: { ...initialNotificationSettings.events, ...result.settings.events },
          ai: { ...initialNotificationSettings.ai, ...result.settings.ai }
        });
      }

      showToast({
        type: "success",
        title: "Einstellungen gespeichert",
        message: "Einstellungen wurden dauerhaft in der lokalen Datenbank gespeichert."
      });
    } catch {
      showToast({
        type: "error",
        title: "Einstellungen nicht gespeichert",
        message: "Bitte lokale API prüfen."
      });
    } finally {
      setSavingSettings(false);
    }
  }

  async function testNotificationChannel(channel: "telegram" | "email") {
    try {
      const response = await fetch("/api/settings/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, settings: notificationSettings })
      });

      if (!response.ok) throw new Error("Test fehlgeschlagen.");

      const result = (await response.json()) as { state: "disabled" | "not-configured" | "skipped" | "sent" | "failed"; message: string };
      showToast({
        type: result.state === "sent" ? "success" : result.state === "failed" || result.state === "not-configured" ? "warning" : "info",
        title: channel === "telegram" ? "Telegram-Test" : "E-Mail-Test",
        message: result.message
      });
    } catch {
      showToast({
        type: "error",
        title: "Test nicht möglich",
        message: "Bitte Einstellungen und lokale API prüfen."
      });
    }
  }

  function scheduleReloadAfterUpdate(reason: string) {
    if (updateReloadStarted.current) return;
    updateReloadStarted.current = true;
    console.info("[Homematic Analyzer][Update] waiting for new server version", {
      reason,
      currentVersion: appVersion
    });
    showToast({
      type: "info",
      title: "Update läuft",
      message: "Die Seite bleibt geöffnet und lädt erst neu, wenn die aktualisierte Version gestartet ist."
    });

    const startedAt = Date.now();
    let analyzerWasUnavailable = false;
    const reloadWhenNewVersionIsReady = async () => {
      try {
        const response = await fetch(`/api/health?reload=${Date.now()}`, { cache: "no-store" });
        if (response.ok) {
          const health = (await response.json()) as { version?: string };
          const versionChanged = Boolean(health.version && health.version !== appVersion);
          console.info("[Homematic Analyzer][Update] health response", {
            currentVersion: appVersion,
            serverVersion: health.version,
            analyzerWasUnavailable,
            versionChanged
          });

          if (versionChanged) {
            console.info("[Homematic Analyzer][Update] new version reachable, reloading page");
            window.setTimeout(() => window.location.reload(), 700);
            return;
          }
        }
      } catch {
        analyzerWasUnavailable = true;
      }

      if (Date.now() - startedAt > 180000) {
        console.warn("[Homematic Analyzer][Update] new version wait timed out");
        updateReloadStarted.current = false;
        showToast({
          type: "warning",
          title: "Automatisches Neuladen wartet",
          message: "Die neue Version wurde noch nicht erkannt. Der Update-Log bleibt sichtbar; lade die Seite erst nach Abschluss manuell neu."
        });
        return;
      }

      window.setTimeout(reloadWhenNewVersionIsReady, 1500);
    };

    window.setTimeout(reloadWhenNewVersionIsReady, 2500);
  }

  async function runAppUpdate() {
    if (isUpdateRunning) return;
    console.info("[Homematic Analyzer][Update] start clicked");
    setShowUpdateConfirm(false);
    setUpdatingApp(true);
    setUpdateRunStatus({
      status: "running",
      running: true,
      startedAt: new Date().toISOString(),
      log: "Update wird gestartet ..."
    });
    try {
      console.info("[Homematic Analyzer][Update] POST /api/system/update");
      const response = await fetch("/api/system/update", { method: "POST" });
      console.info("[Homematic Analyzer][Update] POST response", {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        let errorMessage = "Update konnte nicht gestartet werden.";
        let fallbackCommand = "sudo bash /opt/homematic-analyzer/scripts/install/install-linux.sh";
        try {
          const parsedError = JSON.parse(errorText) as { message?: string; error?: string; hint?: string; fallbackCommand?: string };
          errorMessage = [
            parsedError.message,
            parsedError.error ? `Grund: ${parsedError.error}` : undefined,
            parsedError.hint
          ].filter(Boolean).join(" ");
          fallbackCommand = parsedError.fallbackCommand ?? fallbackCommand;
        } catch {
          if (errorText.trim()) {
            errorMessage = errorText.trim().slice(0, 260);
          }
        }
        console.error("[Homematic Analyzer][Update] POST failed", {
          status: response.status,
          statusText: response.statusText,
          body: errorText
        });
        throw new Error(`${errorMessage} Fallback: ${fallbackCommand}`);
      }

      const result = (await response.json()) as { message?: string; log?: string };
      console.info("[Homematic Analyzer][Update] started", result);
      showToast({
        type: "success",
        title: "Update gestartet",
        message: result.message ?? "Die App aktualisiert sich im Hintergrund."
      });
    } catch (error) {
      console.error("[Homematic Analyzer][Update] start failed", error);
      const message = error instanceof Error ? error.message : "Bitte per SSH aktualisieren.";
      setUpdatingApp(false);
      setUpdateRunStatus({
        status: "failed",
        running: false,
        error: message
      });
      showToast({
        type: "error",
        title: "Update nicht gestartet",
        message
      });
    }
  }

  function requestAppUpdate() {
    if (isUpdateRunning) return;
    setShowUpdateConfirm(true);
  }

  function resetNotificationSettings() {
    setNotificationSettings(initialNotificationSettings);
    showToast({
      type: "info",
      title: "Benachrichtigungen zurückgesetzt",
      message: "Klicke Speichern, um die serverseitigen Einstellungen ebenfalls zurückzusetzen."
    });
  }

  function resetSavedSetup() {
    setForm(initialForm);
    try {
      window.localStorage.removeItem(setupStorageKey);
    } catch {
    }
    void syncSetupDefaults(initialForm);
    showToast({
      type: "info",
      title: "Zugangsdaten gelöscht",
      message: "Die gespeicherten Eingaben wurden aus diesem Browser entfernt."
    });
  }

  const groupedChecks = useMemo(() => {
    if (!displayedAnalysis) return [];

    return checkThemes
      .map((theme) => {
        const allChecks = theme.checkIds
          .map((checkId) => displayedAnalysis.checks.find((check) => check.id === checkId))
          .filter((check): check is AnalysisCheck => Boolean(check));
        const checks = selectedStatusFilter
          ? allChecks.filter((check) => check.status === selectedStatusFilter)
          : showHealthyChecks
            ? allChecks
            : allChecks.filter((check) => check.status !== "ok" || check.id === "routing-topology");
        const counts = allChecks.reduce<Record<CheckStatus, number>>(
          (accumulator, check) => {
            accumulator[check.status] += 1;
            return accumulator;
          },
          { ok: 0, improvement: 0, warning: 0, critical: 0, unavailable: 0 }
        );
        const highestStatus = statusOrder.find((status) => counts[status] > 0) ?? "unavailable";

        return {
          ...theme,
          checks,
          total: allChecks.length,
          counts,
          highestStatus,
          hasAttention: counts.critical + counts.warning + counts.improvement > 0
        };
      })
      .filter((theme) => theme.checks.length > 0);
  }, [displayedAnalysis, selectedStatusFilter, showHealthyChecks]);

  const summary = useMemo(() => {
    if (!displayedAnalysis) return null;

    return displayedAnalysis.checks.reduce<Record<CheckStatus, number>>(
      (accumulator, check) => {
        accumulator[check.status] += 1;
        return accumulator;
      },
      { ok: 0, improvement: 0, warning: 0, critical: 0, unavailable: 0 }
    );
  }, [displayedAnalysis]);
  const healthyCheckCount = displayedAnalysis?.checks.filter((check) => check.status === "ok" && check.id !== "routing-topology").length ?? 0;

  useEffect(() => {
    if (!displayedAnalysis) {
      setExpandedCheckThemes(new Set());
      return;
    }

    const attentionThemes = checkThemes
      .filter((theme) => theme.checkIds.some((checkId) => {
        const check = displayedAnalysis.checks.find((item) => item.id === checkId);
        return check && ["critical", "warning", "improvement"].includes(check.status);
      }))
      .map((theme) => theme.id);
    setExpandedCheckThemes(new Set(attentionThemes));
  }, [analysis?.generatedAt, analysisSnifferMode, displayedAnalysis]);

  useEffect(() => {
    if (!activeCheck) return;
    const activeTheme = checkThemes.find((theme) => (theme.checkIds as readonly string[]).includes(activeCheck));
    if (!activeTheme) return;
    setExpandedCheckThemes((current) => {
      if (current.has(activeTheme.id)) return current;
      const next = new Set(current);
      next.add(activeTheme.id);
      return next;
    });
  }, [activeCheck]);

  const guidedActions = useMemo(() => {
    if (!displayedAnalysis) return [];

    const actions: Array<{
      id: string;
      priority: number;
      eyebrow: string;
      title: string;
      detail: string;
      button: string;
      modal: Exclude<ActionModal, null>;
      checkId?: string;
    }> = [];
    const findCheck = (id: string) => displayedAnalysis.checks.find((check) => check.id === id);
    const alarmCheck = findCheck("alarm-messages");
    const serviceCheck = findCheck("service-messages");
    const reachabilityCheck = findCheck("reachability");
    const dutyCheck = findCheck("duty-cycle");
    const signalCheck = findCheck("signal-strength");
    const routingCheck = findCheck("routing-topology");
    const logCheck = findCheck("logs");

    if (alarmCheck && alarmCheck.status !== "ok" && alarmCheck.status !== "unavailable") {
      actions.push({
        id: "alarms",
        priority: 100,
        eyebrow: "Zuerst",
        title: alarmCheck.title,
        detail: alarmCheck.summary,
        button: "Alarmmeldungen ansehen",
        modal: "check",
        checkId: alarmCheck.id
      });
    }
    const deviceAttentionChecks = [serviceCheck, reachabilityCheck]
      .filter((check): check is AnalysisCheck => Boolean(check && check.status !== "ok" && check.status !== "unavailable"));
    if (deviceAttentionChecks.length > 0) {
      const primaryDeviceCheck = deviceAttentionChecks.find((check) => check.status === "critical")
        ?? deviceAttentionChecks.find((check) => check.status === "warning")
        ?? deviceAttentionChecks[0];
      actions.push({
        id: "device-state",
        priority: 90,
        eyebrow: "Danach",
        title: deviceAttentionChecks.length > 1 ? "Gerätemeldungen gemeinsam prüfen" : primaryDeviceCheck.title,
        detail: deviceAttentionChecks.map((check) => check.summary).join(" "),
        button: deviceAttentionChecks.length > 1 ? "Gerätezustand öffnen" : "Details öffnen",
        modal: "check",
        checkId: primaryDeviceCheck.id
      });
    }
    const radioAttentionChecks = [dutyCheck, signalCheck, routingCheck]
      .filter((check): check is AnalysisCheck => Boolean(check && check.status !== "ok" && check.status !== "unavailable"));
    if (radioAttentionChecks.length > 0) {
      const primaryRadioCheck = radioAttentionChecks.find((check) => check.id === "duty-cycle")
        ?? radioAttentionChecks.find((check) => check.id === "signal-strength")
        ?? radioAttentionChecks[0];
      actions.push({
        id: "radio-state",
        priority: 75,
        eyebrow: "Funk",
        title: radioAttentionChecks.length > 1 ? "Funkzustand gemeinsam einordnen" : primaryRadioCheck.title,
        detail: `${radioAttentionChecks.map((check) => check.summary).join(" ")}${form.snifferEnabled && analysisSnifferMode === "with-sniffer" ? " Snifferdaten ergänzen bei Bedarf die Verursacheranalyse." : ""}`,
        button: primaryRadioCheck.id === "duty-cycle" && form.snifferEnabled && analysisSnifferMode === "with-sniffer"
          ? "Funklast aufteilen"
          : primaryRadioCheck.id === "signal-strength" ? "Signalwerte öffnen" : "Funkdetails öffnen",
        modal: primaryRadioCheck.id === "duty-cycle" && form.snifferEnabled && analysisSnifferMode === "with-sniffer"
          ? "duty"
          : primaryRadioCheck.id === "signal-strength" ? "signal" : "check",
        checkId: primaryRadioCheck.id
      });
    }
    if (logCheck?.status === "unavailable") {
      const collectorWasSeen = Boolean(collectorStatus?.available);
      const collectorIsStale = collectorStatus?.state === "stale";
      const lastCollectorAt = collectorStatus?.collectedAt
        ? new Date(collectorStatus.collectedAt).toLocaleString("de-DE")
        : undefined;
      actions.push({
        id: "collector",
        priority: 55,
        eyebrow: collectorWasSeen ? "Verbindung prüfen" : "Daten ergänzen",
        title: collectorIsStale
          ? "Collector sendet nicht mehr"
          : collectorWasSeen
            ? "Collector liefert keine Logs"
            : "Log-Collector einrichten",
        detail: collectorIsStale
          ? `Der Collector war bereits eingerichtet, hat aber seit ${lastCollectorAt ?? "längerer Zeit"} keine Daten mehr gesendet.`
          : collectorWasSeen
            ? "Der Collector sendet Systemwerte, aber aktuell keine lesbaren Logzeilen."
            : "Logs fehlen noch. Das verhindert die belegbare Erkennung von Scriptfehlern, Dienstneustarts und auffälligen externen Zugriffen.",
        button: collectorWasSeen ? "Collector prüfen" : "Collector einrichten",
        modal: "collector",
        checkId: logCheck.id
      });
    }

    return actions.sort((left, right) => right.priority - left.priority).slice(0, 5);
  }, [displayedAnalysis, collectorStatus, form.snifferEnabled, analysisSnifferMode]);

  const actionModalCheck = useMemo(
    () => displayedAnalysis?.checks.find((check) => check.id === actionModalCheckId),
    [displayedAnalysis, actionModalCheckId]
  );

  function openActionModal(modal: Exclude<ActionModal, null>, checkId?: string) {
    setActionModalCheckId(checkId ?? null);
    setActionModal(modal);
  }

  function openSignalImprovement(deviceName = "") {
    setSignalFocusDeviceName(deviceName);
    openActionModal("signal");
  }

  function closeActionModal() {
    setActionModal(null);
    setActionModalCheckId(null);
    setSignalFocusDeviceName("");
  }

  useEffect(() => {
    if (!aiLogResult || aiLogLoading || currentPage !== "logs") return;
    window.requestAnimationFrame(() => {
      aiLogResultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      aiLogResultRef.current?.focus({ preventScroll: true });
    });
  }, [aiLogResult, aiLogLoading, currentPage]);

  useEffect(() => {
    if (!displayedAnalysis) return;

    const visibleChecks = selectedStatusFilter
      ? displayedAnalysis.checks.filter((check) => check.status === selectedStatusFilter)
      : showHealthyChecks
        ? displayedAnalysis.checks
        : displayedAnalysis.checks.filter((check) => check.status !== "ok" || check.id === "routing-topology");

    if (visibleChecks.length > 0) {
      const isActiveVisible = visibleChecks.some((check) => check.id === activeCheck);
      if (!isActiveVisible) {
        setActiveCheck(visibleChecks.find((check) => check.status !== "ok")?.id ?? visibleChecks[0].id);
      }
    } else {
      setActiveCheck(null);
    }
  }, [selectedStatusFilter, showHealthyChecks, displayedAnalysis, activeCheck]);

  useEffect(() => {
    let isActive = true;
    let updateCheckInFlight = false;
    let lastUpdateCheckAt = 0;
    let lastNotifiedUpdateDetail = "";
    let lastNotifiedCentralUpdateDetail = "";
    const updateCheckIntervalMs = 6 * 60 * 60 * 1000;
    const updateCheckCooldownMs = 30 * 1000;

    async function loadSetupDefaults() {
      try {
        const response = await fetch("/api/setup/defaults");
        if (!response.ok) return;

        const defaults = (await response.json()) as SetupDefaults;
        if (!isActive || Object.keys(defaults).length === 0) return;

        setForm((currentForm) => {
          const nextForm = {
            ...currentForm,
            ccuHost: currentForm.ccuHost || defaults.ccuHost || "",
            ccuUser: currentForm.ccuUser || defaults.ccuUser || "",
            ccuPassword: currentForm.ccuPassword || defaults.ccuPassword || "",
            xmlApiToken: currentForm.xmlApiToken || defaults.xmlApiToken || "",
            sshUser: currentForm.sshUser || defaults.sshUser || "root",
            sshPassword: currentForm.sshPassword || defaults.sshPassword || "",
            snifferEnabled: defaults.snifferEnabled ?? currentForm.snifferEnabled,
            snifferPort: currentForm.snifferPort || defaults.snifferPort || "",
            hmipRoutingEnabled: defaults.hmipRoutingEnabled ?? currentForm.hmipRoutingEnabled,
            hmipRoutingLogLevelSet: defaults.hmipRoutingLogLevelSet ?? currentForm.hmipRoutingLogLevelSet,
            hmipRoutingRestarted: defaults.hmipRoutingRestarted ?? currentForm.hmipRoutingRestarted
          };
          try {
            window.localStorage.setItem(setupStorageKey, JSON.stringify({
              ...nextForm,
              ccuPassword: "",
              xmlApiToken: "",
              sshPassword: ""
            }));
          } catch {
          }
          return nextForm;
        });
      } catch {
      }
    }

    async function loadNotificationSettings() {
      try {
        const response = await fetch("/api/settings/notifications");
        if (!response.ok) return;
        const settings = (await response.json()) as NotificationSettings;
        if (isActive) {
          setNotificationSettings({
            telegram: { ...initialNotificationSettings.telegram, ...settings.telegram },
            email: { ...initialNotificationSettings.email, ...settings.email },
            events: { ...initialNotificationSettings.events, ...settings.events },
            ai: { ...initialNotificationSettings.ai, ...settings.ai }
          });
        }
      } catch {
      }
    }

    async function checkForUpdates() {
      const now = Date.now();
      if (updateCheckInFlight || now - lastUpdateCheckAt < updateCheckCooldownMs) return;
      updateCheckInFlight = true;
      lastUpdateCheckAt = now;

      try {
        const [appResponse, centralResponse] = await Promise.all([
          fetch(`/api/system/update-status?checkedAt=${now}`, { cache: "no-store" }),
          fetch(`/api/system/central-update-status?checkedAt=${now}`, { cache: "no-store" })
        ]);
        if (!appResponse.ok) throw new Error("Lokale API nicht erreichbar");
        const status = (await appResponse.json()) as UpdateStatus;
        const centralStatus = centralResponse.ok ? await centralResponse.json() as UpdateStatus : null;

        if (!isActive) return;

        setUpdateStatus(status);
        setCentralUpdateStatus(centralStatus);
        if (status.state === "update" && status.detail !== lastNotifiedUpdateDetail) {
          lastNotifiedUpdateDetail = status.detail;
          showToast({
            type: "warning",
            title: "Update verfügbar",
            message: status.detail
          });
        } else if (status.state !== "update") {
          lastNotifiedUpdateDetail = "";
        }
        if (centralStatus?.state === "update" && centralStatus.detail !== lastNotifiedCentralUpdateDetail) {
          lastNotifiedCentralUpdateDetail = centralStatus.detail;
          showToast({
            type: "warning",
            title: centralStatus.label,
            message: centralStatus.detail
          });
        } else if (centralStatus?.state !== "update") {
          lastNotifiedCentralUpdateDetail = "";
        }
      } catch {
        if (!isActive) return;

        setUpdateStatus({
          state: "unknown",
          label: "Update-Check nicht möglich",
          detail: "Der lokale Analyzer konnte den Update-Status gerade nicht laden. Die App funktioniert trotzdem.",
          url: repositoryUrl
        });
        setCentralUpdateStatus(null);
        showToast({
          type: "warning",
          title: "Update-Check nicht möglich",
          message: "Der lokale Update-Status konnte gerade nicht geladen werden."
        });
      } finally {
        updateCheckInFlight = false;
      }
    }

    async function loadPreviousUpdateRun() {
      try {
        const response = await fetch("/api/system/update-run", { cache: "no-store" });
        if (!response.ok) return;
        const status = (await response.json()) as UpdateRunStatus;
        if (!isActive || status.status === "idle") return;

        setUpdateRunStatus(status);
        setUpdatingApp(status.status === "running");
      } catch {
      }
    }

    async function synchronizeFrontendVersion() {
      try {
        const response = await fetch(`/api/health?versionCheck=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) return;
        const health = (await response.json()) as { version?: string };
        if (!health.version || health.version === appVersion) {
          sessionStorage.removeItem("homematic-analyzer-version-reload");
          return;
        }

        const reloadKey = `${appVersion}->${health.version}`;
        if (sessionStorage.getItem("homematic-analyzer-version-reload") === reloadKey) return;
        sessionStorage.setItem("homematic-analyzer-version-reload", reloadKey);
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("appVersion", health.version);
        nextUrl.searchParams.set("refresh", String(Date.now()));
        window.location.replace(nextUrl.toString());
      } catch {
      }
    }

    function checkForUpdatesWhenVisible() {
      if (document.visibilityState === "visible") {
        void checkForUpdates();
      }
    }

    void loadSetupDefaults();
    void loadNotificationSettings();
    void synchronizeFrontendVersion();
    void checkForUpdates();
    void loadPreviousUpdateRun();
    void loadUsbPorts(false);
    const updateCheckInterval = window.setInterval(() => void checkForUpdates(), updateCheckIntervalMs);
    const centralVersionRetry = window.setTimeout(() => void checkForUpdates(), 90 * 1000);
    document.addEventListener("visibilitychange", checkForUpdatesWhenVisible);
    window.addEventListener("focus", checkForUpdatesWhenVisible);

    return () => {
      isActive = false;
      window.clearInterval(updateCheckInterval);
      window.clearTimeout(centralVersionRetry);
      document.removeEventListener("visibilitychange", checkForUpdatesWhenVisible);
      window.removeEventListener("focus", checkForUpdatesWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      setActiveAnalysisStep(0);
      return;
    }

    const interval = window.setInterval(() => {
      setActiveAnalysisStep((currentStep) => Math.min(currentStep + 1, analysisSteps.length - 1));
    }, 520);

    return () => window.clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    if (!updatingApp && updateRunStatus?.status !== "running") return;

    let isActive = true;

    async function loadUpdateRunStatus() {
      try {
        console.info("[Homematic Analyzer][Update] GET /api/system/update-run");
        const response = await fetch("/api/system/update-run");
        console.info("[Homematic Analyzer][Update] status response", {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText
        });
        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          console.error("[Homematic Analyzer][Update] status failed", {
            status: response.status,
            statusText: response.statusText,
            body: errorText
          });
          throw new Error("Update-Status nicht erreichbar");
        }
        const status = (await response.json()) as UpdateRunStatus;
        if (!isActive) return;

        console.info("[Homematic Analyzer][Update] status payload", {
          status: status.status,
          running: status.running,
          startedAt: status.startedAt,
          finishedAt: status.finishedAt,
          exitCode: status.exitCode,
          error: status.error,
          logLines: status.log ? status.log.split("\n").length : 0
        });
        setUpdateRunStatus(status);
        setUpdatingApp(status.status === "running");

        if (status.status === "completed") {
          showToast({
            type: "success",
            title: "Update abgeschlossen",
            message: "Die Seite lädt gleich automatisch neu."
          });
          scheduleReloadAfterUpdate("completed-status");
        }

        if (status.status === "failed") {
          showToast({
            type: "error",
            title: "Update fehlgeschlagen",
            message: status.error ?? "Bitte Update-Log prüfen."
          });
        }
      } catch (error) {
        if (!isActive) return;
        console.warn("[Homematic Analyzer][Update] polling failed", error);
        setUpdateRunStatus((current) => ({
          status: "running",
          running: true,
          startedAt: current?.startedAt,
          log: `${current?.log ?? ""}\nAnalyzer ist während des Updates kurz nicht erreichbar. Die Seite lädt automatisch neu, sobald er wieder da ist.`.trim()
        }));
        scheduleReloadAfterUpdate("polling-failed-during-update");
      }
    }

    void loadUpdateRunStatus();
    const interval = window.setInterval(() => void loadUpdateRunStatus(), 1800);

    return () => {
      isActive = false;
      window.clearInterval(interval);
    };
  }, [updatingApp, updateRunStatus?.status]);

  useEffect(() => {
    let isActive = true;

    async function loadDataStatus() {
      try {
        const [masterdataResponse, collectorResponse] = await Promise.all([
          fetch("/api/ccu-masterdata/latest"),
          fetch("/api/collector/latest")
        ]);

        if (isActive && masterdataResponse.ok) {
          setMasterdataStatus((await masterdataResponse.json()) as MasterdataStatus);
        }
        if (isActive && collectorResponse.ok) {
          setCollectorStatus((await collectorResponse.json()) as CollectorStatus);
        }
      } catch {
        if (isActive) {
          setMasterdataStatus(null);
          setCollectorStatus(null);
        }
      }
    }

    void loadDataStatus();
    const interval = window.setInterval(() => void loadDataStatus(), 15000);

    return () => {
      isActive = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!hasAnalysis || currentPage !== "analysis" || loading) return;

    let isActive = true;

    async function refreshAnalysisSnapshot() {
      if (analysisAutoRefreshInFlight.current) return;
      analysisAutoRefreshInFlight.current = true;
      setAnalysisAutoRefreshing(true);
      try {
        const data = await fetchAnalysisSnapshot({ notify: false });
        if (!isActive) return;
        setAnalysis(data);
        saveAnalysisSnapshot(data);
        setActiveCheck((currentActiveCheck) => (
          currentActiveCheck && data.checks.some((check) => check.id === currentActiveCheck)
            ? currentActiveCheck
            : data.checks.find((check) => check.status !== "ok")?.id ?? data.checks[0]?.id ?? null
        ));
      } catch (caughtError) {
        console.warn("[Homematic Analyzer][Analysis] Auto-Refresh fehlgeschlagen", caughtError);
      } finally {
        analysisAutoRefreshInFlight.current = false;
        if (isActive) setAnalysisAutoRefreshing(false);
      }
    }

    const refreshEveryMs = 60000;
    let nextRefreshAt = Date.now() + refreshEveryMs;

    setDashboardRefreshProgress(0);
    setDashboardRefreshSecondsLeft(60);
    void refreshAnalysisSnapshot();

    const refreshInterval = window.setInterval(() => {
      nextRefreshAt = Date.now() + refreshEveryMs;
      setDashboardRefreshProgress(0);
      setDashboardRefreshSecondsLeft(60);
      void refreshAnalysisSnapshot();
    }, refreshEveryMs);

    const tickInterval = window.setInterval(() => {
      const remainingMs = Math.max(0, nextRefreshAt - Date.now());
      setDashboardRefreshSecondsLeft(Math.ceil(remainingMs / 1000));
      setDashboardRefreshProgress(Math.min(100, Math.max(0, ((refreshEveryMs - remainingMs) / refreshEveryMs) * 100)));
    }, 1000);

    return () => {
      isActive = false;
      window.clearInterval(refreshInterval);
      window.clearInterval(tickInterval);
    };
  }, [hasAnalysis, currentPage, loading, form, notificationSettings]);

  useEffect(() => {
    if (!form.snifferEnabled && currentPage === "dc") {
      navigateTo("analysis");
    }
  }, [form.snifferEnabled, currentPage]);

  useEffect(() => {
    if (currentPage !== "dc" || !form.snifferEnabled) return;
    void loadUsbPorts(false);
    void loadSnifferSnapshot(false, true);

    const interval = window.setInterval(() => {
      void loadSnifferSnapshot(false, false);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [currentPage, form.snifferEnabled, form.snifferPort]);

  useEffect(() => {
    if (currentPage !== "logs") return;
    void loadLogs(false);

    const refreshLogs = () => {
      if (document.visibilityState === "visible") {
        void loadLogs(false);
      }
    };
    const interval = window.setInterval(refreshLogs, 15000);
    document.addEventListener("visibilitychange", refreshLogs);
    window.addEventListener("focus", refreshLogs);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshLogs);
      window.removeEventListener("focus", refreshLogs);
    };
  }, [currentPage]);

  useEffect(() => {
    if (!analysis || currentPage !== "analysis" || !form.snifferEnabled || !form.snifferPort.trim()) return;
    void loadSnifferSnapshot(false, false);
  }, [analysis?.generatedAt, currentPage, form.snifferEnabled, form.snifferPort]);

  useEffect(() => {
    if (currentPage !== "diagnostics") return;
    void loadDiagnostics(false);
  }, [currentPage]);

  useEffect(() => {
    if (!["settings", "analysis"].includes(currentPage) || !form.hmipRoutingEnabled) return;
    void loadRoutingStatus(false);
    const interval = window.setInterval(() => void loadRoutingStatus(false), 15000);
    return () => window.clearInterval(interval);
  }, [currentPage, form.hmipRoutingEnabled]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeMenu = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", closeMenu);
    return () => window.removeEventListener("keydown", closeMenu);
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (form.hmipRoutingEnabled || !analysis?.checks.some((check) => check.id === "routing-topology")) return;
    const nextAnalysis = {
      ...analysis,
      checks: analysis.checks.filter((check) => check.id !== "routing-topology")
    };
    setAnalysis(nextAnalysis);
    saveAnalysisSnapshot(nextAnalysis);
    if (activeCheck === "routing-topology") {
      setActiveCheck(firstRelevantCheckId(nextAnalysis));
    }
  }, [form.hmipRoutingEnabled, analysis, activeCheck]);

  useEffect(() => {
    if (currentPage !== "dc" && (!form.hmipRoutingEnabled || currentPage !== "analysis")) return;

    void loadRoutingTopology();
    const interval = window.setInterval(() => void loadRoutingTopology(), 30000);
    return () => window.clearInterval(interval);
  }, [form.hmipRoutingEnabled, currentPage]);

  async function fetchAnalysisSnapshot(options: { notify: boolean }) {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ccuHost: form.ccuHost.trim(),
        ccuUser: form.ccuUser.trim(),
        ccuPassword: form.ccuPassword,
        xmlApiToken: (form.xmlApiToken ?? "").trim(),
        hasCcuPassword: Boolean(form.ccuPassword),
        sshHost: form.ccuHost.trim(),
        sshUser: form.sshUser.trim(),
        sshPassword: form.sshPassword,
        hasSshPassword: Boolean(form.sshPassword),
        snifferEnabled: form.snifferEnabled,
        snifferPort: form.snifferPort.trim(),
        hmipRoutingEnabled: form.hmipRoutingEnabled,
        externalSystems: [],
        notificationSettings,
        notify: options.notify
      })
    });

    if (!response.ok) {
      throw new Error("Die Analyse konnte nicht gestartet werden.");
    }

    return (await response.json()) as AnalysisResponse;
  }

  async function runAnalysis(event?: FormEvent<HTMLFormElement>, targetCheckId?: string) {
    event?.preventDefault();
    setCurrentPage("analysis");
    setLoading(true);
    setActiveAnalysisStep(0);
    setError(null);
    setSelectedStatusFilter(null);
    showToast({
      type: "info",
      title: "Analyse gestartet",
      message: form.ccuHost.trim() ? "CCU, XML-API und verfügbare Zusatzdaten werden geprüft." : "Ohne CCU-Zugang werden nur mögliche Prüfpunkte vorbereitet."
    });

    try {
      const [data] = await Promise.all([fetchAnalysisSnapshot({ notify: true }), wait(2600)]);
      setActiveAnalysisStep(analysisSteps.length - 1);
      const criticalCount = data.checks.filter((check) => check.status === "critical").length;
      const unavailableCount = data.checks.filter((check) => check.status === "unavailable").length;
      setAnalysis(data);
      saveAnalysisSnapshot(data);
      setActiveCheck(
        targetCheckId && data.checks.some((check) => check.id === targetCheckId)
          ? targetCheckId
          : data.checks.find((check) => check.status !== "ok")?.id ?? data.checks[0]?.id ?? null
      );
      showToast({
        type: criticalCount > 0 ? "warning" : "success",
        title: "Analyse abgeschlossen",
        message: criticalCount > 0
          ? `${criticalCount} kritische Punkte gefunden. ${unavailableCount} Punkte konnten nicht geprüft werden.`
          : `${data.checks.length} Prüfpunkte ausgewertet. ${unavailableCount} Punkte konnten nicht geprüft werden.`
      });
      if (notificationSettings.telegram.enabled && data.notifications?.telegram) {
        const telegramResult = data.notifications.telegram;
        showToast({
          type: telegramResult.state === "sent" ? "success" : telegramResult.state === "failed" || telegramResult.state === "not-configured" ? "warning" : "info",
          title: telegramResult.state === "sent" ? "Telegram gesendet" : "Telegram Hinweis",
          message: telegramResult.message
        });
      }
      if (notificationSettings.email.enabled && data.notifications?.email) {
        const emailResult = data.notifications.email;
        showToast({
          type: emailResult.state === "sent" ? "success" : emailResult.state === "failed" || emailResult.state === "not-configured" ? "warning" : "info",
          title: emailResult.state === "sent" ? "E-Mail gesendet" : "E-Mail Hinweis",
          message: emailResult.message
        });
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Unbekannter Fehler";
      setError(message);
      showToast({
        type: "error",
        title: "Analyse fehlgeschlagen",
        message
      });
    } finally {
      setLoading(false);
    }
  }

  async function openRoutingGraphic(refreshAnalysis = false) {
    setCurrentPage("analysis");
    setSelectedStatusFilter(null);

    if (refreshAnalysis || !analysis?.checks.some((check) => check.id === "routing-topology")) {
      await runAnalysis(undefined, "routing-topology");
      await loadRoutingTopology();
    } else {
      setActiveCheck("routing-topology");
      await loadRoutingTopology();
    }

    window.setTimeout(() => {
      document.querySelector(".routing-topology-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  async function copyCollectorCommand() {
    const copied = await copyText(collectorCommand);
    setCollectorCommandPreview(copied ? "" : collectorCommand);
    showToast({
      type: copied ? "success" : "warning",
      title: copied ? "Befehl kopiert" : "Kopieren blockiert",
      message: copied ? "Du kannst ihn jetzt auf der Zentrale einfügen." : "Der Befehl wird unten eingeblendet. Bitte manuell markieren und kopieren."
    });
  }

  async function copyCcuMasterdataScript() {
    try {
      const response = await fetch(ccuMasterdataScriptUrl);

      if (!response.ok) {
        throw new Error("Script konnte nicht geladen werden.");
      }

      const script = await response.text();
      const copied = await copyText(script);
      setCcuScriptPreview(copied ? "" : script);
      showToast({
        type: copied ? "success" : "warning",
        title: copied ? "CCU-Script kopiert" : "Kopieren blockiert",
        message: copied ? "Script wurde kopiert." : "Das Script wird unten eingeblendet. Bitte manuell markieren und kopieren."
      });
    } catch {
      showToast({
        type: "warning",
        title: "Kopieren nicht möglich",
        message: "Das Script wird unten eingeblendet. Bitte manuell markieren und kopieren."
      });
    }
  }

  async function copyAskSinDevListScript() {
    try {
      const response = await fetch(askSinDevListScriptUrl);

      if (!response.ok) {
        throw new Error("Script konnte nicht geladen werden.");
      }

      const script = await response.text();
      const copied = await copyText(script);
      setAskSinScriptPreview(copied ? "" : script);
      showToast({
        type: copied ? "success" : "warning",
        title: copied ? "AskSin-Script kopiert" : "Kopieren blockiert",
        message: copied
          ? "Script wurde kopiert. Füge es in der CCU-WebUI als Programm ein."
          : "Das Script wird unten eingeblendet. Bitte manuell markieren und kopieren."
      });
    } catch {
      showToast({
        type: "warning",
        title: "Kopieren nicht möglich",
        message: "Das Script wird unten eingeblendet. Bitte manuell markieren und kopieren."
      });
    }
  }


  return (
    <main>
      <div className="toast-region" aria-live="polite" aria-label="Statusmeldungen">
        {toasts.map((toast) => (
          <div className={`toast toast-${toast.type}`} key={toast.id}>
            <div>
              <strong>{toast.title}</strong>
              {toast.message && <span>{toast.message}</span>}
            </div>
            <button type="button" onClick={() => removeToast(toast.id)} aria-label="Meldung schließen">
              ×
            </button>
          </div>
        ))}
      </div>

      <header className="app-topbar">
        <button type="button" className="app-brand" onClick={navigateHome} aria-label="Zur Startseite">
          <img src="/logo.png" alt="" aria-hidden="true" />
          <div>
            <strong>Homematic Analyzer</strong>
            <span>Belegbare Smarthome-Analyse</span>
          </div>
        </button>
        <button
          type="button"
          className={`mobile-menu-toggle ${mobileMenuOpen ? "is-open" : ""}`}
          onClick={() => setMobileMenuOpen((current) => !current)}
          aria-expanded={mobileMenuOpen}
          aria-controls="primary-navigation"
          aria-label={mobileMenuOpen ? "Menü schließen" : "Menü öffnen"}
        >
          <span className="mobile-menu-current">{pageLabels[currentPage]}</span>
          <span className="mobile-menu-icon" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </button>
        <nav id="primary-navigation" className={`page-tabs ${mobileMenuOpen ? "is-open" : ""}`} aria-label="Bereiche">
          <div className="page-tabs__left">
            <button type="button" className={currentPage === "analysis" ? "is-active" : ""} onClick={() => navigateTo("analysis")}>
              Analyse
            </button>
            {form.snifferEnabled && (
              <button type="button" className={currentPage === "dc" ? "is-active" : ""} onClick={() => navigateTo("dc")}>
                DC-Analyzer
              </button>
            )}
            <button type="button" className={currentPage === "logs" ? "is-active" : ""} onClick={() => navigateTo("logs")}>
              Logs
            </button>
            <button type="button" className={currentPage === "diagnostics" ? "is-active" : ""} onClick={() => navigateTo("diagnostics")}>
              Status
            </button>
            <button type="button" className={currentPage === "settings" ? "is-active" : ""} onClick={() => navigateTo("settings")}>
              Einstellungen
            </button>
          </div>
          <div className="page-tabs__right">
            <button type="button" className={currentPage === "setup" ? "is-active" : ""} onClick={() => navigateTo("setup")}>
              Setup <span className="tab-badge">{setupProgress.complete ? "✓" : `${setupProgress.percent}%`}</span>
            </button>
          </div>
        </nav>
      </header>

      {currentPage === "setup" && (
        <>
      <form className="setup" onSubmit={runAnalysis}>
        <section className="panel">
          <div className="panel__header">
            <p className="eyebrow">Setup</p>
            <h2>Zugänge eintragen</h2>
            <p>Empfohlene Reihenfolge: erst CCU-Zugang und XML-API-Token, danach das CCU-Script kopieren. Alles Weitere ist optional.</p>
            <p className="setup-note">Zugangsdaten werden lokal in diesem Browser gespeichert. Die CCU bleibt im LAN oder VPN.</p>
            <button type="button" className="ghost-button" onClick={resetSavedSetup}>
              Gespeicherte Daten löschen
            </button>
          </div>

          <div className="setup-roadmap" aria-label="Empfohlene Einrichtung">
            {[
              ["1", "CCU Login", "Host, Benutzer, Passwort und XML-API Token eintragen."],
              ["2", "Analyse testen", "Einmal Analyse starten und prüfen, ob Geräte gelesen werden."],
              ["3", "CCU-Script", "Script kopieren, in der WebUI einfügen und täglich laufen lassen."],
              ["4", "Optional", "Shell-Logs, Sniffer und Benachrichtigungen nur bei Bedarf ergänzen."]
            ].map(([number, title, text]) => (
              <div className="setup-roadmap-step" key={number}>
                <strong>{number}</strong>
                <span>{title}</span>
                <small>{text}</small>
              </div>
            ))}
          </div>

          <div className="setup-group-status" aria-label="Setup-Status nach Bereichen">
            {setupGroups.map((group) => (
              <article className={`${group.done ? "is-done" : ""} ${group.optional ? "is-optional" : "is-required"}`} key={group.label}>
                <span>{group.done ? "✓" : group.optional ? "○" : "!"}</span>
                <div>
                  <strong>{group.label}</strong>
                  <small>{group.text}</small>
                  <em>{group.hint}</em>
                </div>
                {group.optional && <b>optional</b>}
              </article>
            ))}
          </div>

          <div className="setup-sections">
            <fieldset className="setup-card">
              <legend>CCU / RaspberryMatic Login</legend>
              <p>Pflicht für Geräte, Servicemeldungen, Batterien, Duty Cycle und XML-API-Prüfung. Bei XML-API v2 wird zusätzlich ein XML-API Token (`sid`) benötigt.</p>
              <p className="security-note">Bitte keine öffentliche CCU-Adresse oder Portweiterleitung verwenden. Von außen besser per VPN verbinden.</p>
              <div className="form-grid form-grid-3">
                <label>
                  Host, IP oder XML-API URL
                  <input value={form.ccuHost} onChange={(event) => updateForm({ ...form, ccuHost: event.target.value })} placeholder="192.168.178.50 oder http://.../addons/xmlapi/?sid=..." autoComplete="url" />
                </label>
                <label>
                  Benutzer
                  <input value={form.ccuUser} onChange={(event) => updateForm({ ...form, ccuUser: event.target.value })} placeholder="Admin" autoComplete="username" />
                </label>
                <label>
                  Passwort
                  <span className="secret-field">
                    <input type={visibleSecrets.ccuPassword ? "text" : "password"} value={form.ccuPassword} onChange={(event) => updateForm({ ...form, ccuPassword: event.target.value })} placeholder="Wird im Browser gespeichert" autoComplete="current-password" />
                    <button type="button" onClick={() => toggleSecret("ccuPassword")} aria-label={visibleSecrets.ccuPassword ? "CCU Passwort ausblenden" : "CCU Passwort anzeigen"}>
                      {getSecretIcon(Boolean(visibleSecrets.ccuPassword))}
                    </button>
                  </span>
                </label>
              </div>
              <div className="form-grid form-grid-1 compact-grid">
                <label>
                  XML-API Token-ID / sid
                  <span className="secret-field">
                    <input type={visibleSecrets.xmlApiToken ? "text" : "password"} value={form.xmlApiToken ?? ""} onChange={(event) => updateForm({ ...form, xmlApiToken: event.target.value })} placeholder="Token-ID aus tokenlist.cgi — ohne CCU-Passwort" autoComplete="off" />
                    <button type="button" onClick={() => toggleSecret("xmlApiToken")} aria-label={visibleSecrets.xmlApiToken ? "XML-API Token ausblenden" : "XML-API Token anzeigen"}>
                      {getSecretIcon(Boolean(visibleSecrets.xmlApiToken))}
                    </button>
                  </span>
                </label>
              </div>
              <details className="inline-help">
                <summary>Wo finde ich die XML-API Token-ID?</summary>
                <ol>
                  <li>CCU WebUI öffnen.</li>
                  <li>`Einstellungen` → `Systemsteuerung` → `Zusatzsoftware` öffnen.</li>
                  <li>Beim Add-on `XML-API` auf `Einstellen` klicken.</li>
                  <li>Token registrieren oder vorhandene Token-ID aus `tokenlist.cgi` kopieren.</li>
                  <li>Die Token-ID hier ohne `@` eintragen und Analyse erneut starten.</li>
                </ol>
              </details>
              <div className="ccu-test-actions">
                <button type="button" className="primary-button" onClick={() => void testCcuConnection()} disabled={ccuTestLoading || !form.ccuHost.trim()}>
                  {ccuTestLoading ? "Verbindung wird geprüft …" : "CCU-Verbindung testen"}
                </button>
                <span>Prüft nacheinander Netzwerk, WebUI, Anmeldung, XML-API und Geräteliste.</span>
              </div>
              {ccuTestResult && (
                <div className={`ccu-test-result ${ccuTestResult.reachable ? "is-ok" : "has-error"}`}>
                  <div>
                    <strong>{ccuTestResult.reachable ? "CCU-Daten vollständig lesbar" : ccuTestResult.webUiReachable ? "WebUI erreichbar, XML-API noch nicht nutzbar" : "CCU vom Analyzer aus nicht erreichbar"}</strong>
                    <span>{ccuTestResult.reachable ? `${ccuTestResult.devices} Geräte gelesen.` : ccuTestResult.error ?? "Siehe Prüfschritte."}</span>
                  </div>
                  <ol>
                    {ccuTestResult.diagnostics.map((diagnostic) => (
                      <li className={`diagnostic-${diagnostic.status}`} key={`${diagnostic.step}-${diagnostic.detail}`}>
                        <strong>{diagnostic.step}</strong>
                        <span>{diagnostic.detail}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </fieldset>

            <fieldset className="setup-card setup-card-optional">
              <legend>SSH Login</legend>
              <p>Optional für Logauszüge und aktive Verbindungen. CPU/RAM, Temperatur, Speicher und Backups kommen bevorzugt über das CCU-WebUI-Script.</p>
              <div className="form-grid form-grid-2">
                <label>
                  SSH Benutzer
                  <input value={form.sshUser} onChange={(event) => updateForm({ ...form, sshUser: event.target.value })} placeholder="root" autoComplete="username" />
                </label>
                <label>
                  SSH Passwort
                  <span className="secret-field">
                    <input type={visibleSecrets.sshPassword ? "text" : "password"} value={form.sshPassword} onChange={(event) => updateForm({ ...form, sshPassword: event.target.value })} placeholder="Wird im Browser gespeichert" autoComplete="current-password" />
                    <button type="button" onClick={() => toggleSecret("sshPassword")} aria-label={visibleSecrets.sshPassword ? "SSH Passwort ausblenden" : "SSH Passwort anzeigen"}>
                      {getSecretIcon(Boolean(visibleSecrets.sshPassword))}
                    </button>
                  </span>
                </label>
              </div>
              <details className="inline-help">
                <summary>Wie richte ich SSH auf der Zentrale ein?</summary>
                <ol>
                  <li>WebUI öffnen und als Administrator anmelden.</li>
                  <li>`Einstellungen` → `Systemsteuerung` → `Sicherheit` öffnen.</li>
                  <li>SSH aktivieren und ein sicheres Passwort setzen.</li>
                  <li>Als Benutzer meist `root` verwenden; Host ist die IP der CCU/RaspberryMatic.</li>
                  <li>Wenn du kein SSH möchtest, leer lassen — die Basisanalyse funktioniert trotzdem.</li>
                </ol>
              </details>
            </fieldset>

            <fieldset className="setup-card setup-card-optional">
              <legend>Optionale Erweiterungen</legend>
              <label className="toggle sniffer-master-toggle">
                <input
                  type="checkbox"
                  checked={form.snifferEnabled}
                  onChange={(event) => updateForm({ ...form, snifferEnabled: event.target.checked })}
                />
                <span>AskSin-Sniffer verwenden</span>
              </label>
              <p>Die Basisanalyse ist bewusst ohne Löten nutzbar. Die Zentrale liefert Geräte, Meldungen, Batterien, Duty Cycle und Zentralen-RSSI; der Sniffer ergänzt nur tiefere Funkdetails.</p>
              <details className="inline-help">
                <summary>Brauche ich den AskSin-Sniffer überhaupt?</summary>
                <ul>
                  <li><strong>Ohne Sniffer:</strong> Geräte- und Alarmmeldungen, Batterien, Erreichbarkeit, Konfiguration, CCU-Duty-Cycle, RSSI der Zentrale und Funk-Topologie aus CCU-Daten.</li>
                  <li><strong>Mit Sniffer:</strong> einzelne Telegramme, Funklast pro Gerät, Carrier Sense und Empfang am Sniffer-Standort.</li>
                  <li>Gateways und Access Points sind zusätzliche Funkempfänger. Sie werden nicht pauschal als Router behandelt.</li>
                </ul>
              </details>
              {form.snifferEnabled ? (
                <>
                  <div className="usb-port-picker">
                    <label>
                      AskSin Analyzer XS USB-Port
                      <select value={snifferPortSelectValue} onChange={(event) => selectSnifferPort(event.target.value)}>
                        <option value="">Port noch nicht ausgewählt</option>
                        {usbPorts.map((usbPort) => (
                          <option value={usbPort.path} key={usbPort.path}>
                            {usbPort.stable ? "Stabil: " : ""}{usbPort.label}
                          </option>
                        ))}
                        <option value="__manual__">Manuell eintragen</option>
                      </select>
                    </label>
                    <button type="button" className="ghost-button" onClick={() => void loadUsbPorts(true)} disabled={usbPortsLoading}>
                      {usbPortsLoading ? "Suche läuft ..." : "Ports neu suchen"}
                    </button>
                  </div>
                  {showManualSnifferPort && (
                    <label>
                      Manueller USB-Port
                      <input value={form.snifferPort} onChange={(event) => updateForm({ ...form, snifferPort: event.target.value })} placeholder="/dev/serial/by-id/... oder /dev/ttyUSB0" />
                    </label>
                  )}
                  <p className={usbPorts.length > 0 ? "setup-note setup-note-ok" : "setup-note"}>
                    {usbPorts.length > 0
                      ? "Gefundene Ports werden bevorzugt als stabile /dev/serial/by-id Pfade angezeigt."
                      : "Wenn hier nichts erscheint: Sniffer anstecken oder in Proxmox/LXC erst den USB-Port durchreichen."}
                  </p>
                </>
              ) : (
                <p className="setup-note setup-note-ok">Sniffer ausgeschaltet. Die App zeigt nur Funktionen, die ohne Zusatzhardware zuverlässig verfügbar sind.</p>
              )}
            </fieldset>
          </div>

          <button className="analyze-button" disabled={loading}>
            {loading ? "Analyse läuft ..." : "Zur Analyse wechseln und starten"}
          </button>
          <p className="hint">Die Ergebnisse und die laufende Prüfung erscheinen auf der Analyse-Seite.</p>
          {error && <p className="error">{error}</p>}
        </section>
      </form>

      <section className="collector panel">
        <details>
          <summary>
            <span>
              <small>Einmaliges Setup</small>
              CCU-Daten täglich vorbereiten
            </span>
            <strong>Script anzeigen</strong>
          </summary>
          <div className="setup-script-content">
            <p>
              Dieses WebUI-Script legt die Variablen `HomematicAnalyzer_LastRun`, `HomematicAnalyzer_Status`,
              `HomematicAnalyzer_DeviceInventory`, `HomematicAnalyzer_SystemCpu`, `HomematicAnalyzer_SystemRam`,
              `HomematicAnalyzer_SystemTemperature`, `HomematicAnalyzer_SystemDisk`, `HomematicAnalyzer_SystemBackups`
              und `HomematicAnalyzer_Error` an. Es sendet Gerätenamen und CCU3/RaspberryMatic-Systemwerte an den Analyzer.
            </p>
            <p className="setup-note">Empfehlung: erst oben CCU-Login eintragen und eine Analyse testen, danach dieses Script kopieren.</p>
            <p className={`setup-note ${masterdataStatus?.available ? "setup-note-ok" : ""}`}>
              {masterdataStatus?.available
                ? `Empfangen: ${masterdataStatus.deviceCount} Geräte${masterdataStatus.systemAvailable ? " · CCU-Systemwerte" : ""}, zuletzt ${masterdataStatus.collectedAt ? new Date(masterdataStatus.collectedAt).toLocaleString("de-DE") : "gerade eben"}.`
                : "Noch keine CCU-Daten empfangen."}
            </p>
            {usesLocalAnalyzerUrl && (
              <p className="setup-warning">
                Wichtig: Die CCU kann `127.0.0.1` nicht erreichen, wenn der Analyzer auf deinem Rechner läuft.
                Öffne die App für das Script besser über deine Netzwerk-IP, z. B. `http://192.168.x.x:5173`.
              </p>
            )}
            <div className="script-actions">
              <button type="button" onClick={() => void copyCcuMasterdataScript()}>
                CCU-Script kopieren
              </button>
              <a href={ccuMasterdataScriptUrl} target="_blank" rel="noreferrer">
                Script im Browser öffnen
              </a>
            </div>
            {ccuScriptPreview && (
              <label className="script-preview">
                Script zum manuellen Kopieren
                <textarea readOnly value={ccuScriptPreview} onFocus={(event) => event.target.select()} />
              </label>
            )}
            <ol>
              <li>CCU WebUI öffnen.</li>
              <li>`Programme und Verknüpfungen` öffnen und ein neues Programm erstellen.</li>
              <li>Als Aktion `Script` wählen und den kopierten Inhalt einfügen.</li>
              <li>Einmal manuell ausführen und danach z. B. täglich nachts ausführen lassen.</li>
            </ol>
          </div>
        </details>

        <details className="secondary-details">
          <summary>
            <span>
              <small>Optional</small>
              Logs und Verbindungen per Shell sammeln
            </span>
            <strong>Details</strong>
          </summary>
          <div className="setup-script-content">
            <p>
              Nur nötig, wenn zusätzlich Logauszüge oder aktive CCU-Verbindungen geprüft werden sollen. CPU, RAM, Temperatur, Speicher und Backups kommen bevorzugt aus dem CCU-WebUI-Script.
            </p>
            <p className={`setup-note ${collectorStatus?.available && collectorStatus.state !== "stale" ? "setup-note-ok" : ""}`}>
              {collectorStatus?.available
                ? collectorStatus.state === "stale"
                  ? `Früher erkannt, aber nicht mehr aktuell: ${collectorStatus.host ?? "Zentrale"}, letzter Empfang ${collectorStatus.collectedAt ? new Date(collectorStatus.collectedAt).toLocaleString("de-DE") : "unbekannt"}. Cronjob und Zieladresse prüfen.`
                  : `Empfangen: ${collectorStatus.host ?? "Zentrale"}, zuletzt ${collectorStatus.collectedAt ? new Date(collectorStatus.collectedAt).toLocaleString("de-DE") : "gerade eben"} · ${collectorStatus.logs} Logzeilen · ${collectorStatus.connections} Verbindungen.`
                : "Noch keine Shell-Zusatzdaten empfangen. Nur für Logs und Verbindungen nötig."}
            </p>
            <div className="form-grid form-grid-2 compact-grid">
              <label>
                Ausführung
                <select value={collectorMode} onChange={(event) => setCollectorMode(event.target.value as typeof collectorMode)}>
                  <option value="once">Einmal jetzt senden</option>
                  <option value="install">Regelmäßig einrichten</option>
                  <option value="uninstall">Regelmäßige Übertragung entfernen</option>
                </select>
              </label>
              <label>
                Zyklus
                <select value={collectorInterval} onChange={(event) => setCollectorInterval(event.target.value as typeof collectorInterval)} disabled={collectorMode === "once" || collectorMode === "uninstall"}>
                  <option value="minute">Minütlich für Verlauf</option>
                  <option value="hourly">Stündlich</option>
                  <option value="daily">Täglich nachts</option>
                </select>
              </label>
            </div>
            <div className="script-box">
              <pre><code>{collectorCommand}</code></pre>
              <button type="button" onClick={() => void copyCollectorCommand()}>
                Kopieren
              </button>
            </div>
            <p className="muted">
              Für Verlaufsgrafiken ist minütlich sinnvoll. „Regelmäßig einrichten“ legt ausschließlich einen markierten Analyzer-Cronjob an.
              „Regelmäßige Übertragung entfernen“ löscht nur diesen Eintrag sowie die eigenen temporären Dateien.
            </p>
            {collectorCommandPreview && (
              <label className="script-preview">
                Shell-Befehl zum manuellen Kopieren
                <textarea readOnly value={collectorCommandPreview} onFocus={(event) => event.target.select()} />
              </label>
            )}
          </div>
        </details>
      </section>
        </>
      )}

      {currentPage === "dc" && (
        <section className="panel dc-page">
          <div className="panel__header dc-page__header">
            <div>
              <p className="eyebrow">DC-Analyzer</p>
              <h2>Funkverkehr verständlich prüfen</h2>
              <p>
                Live-Messwerte vom AskSin-Sniffer. Die wichtigsten Ergebnisse bleiben sichtbar, technische Details öffnest du nur bei Bedarf.
              </p>
            </div>
            <button type="button" className="analyze-button analyze-button-compact" onClick={() => void loadSnifferSnapshot(true)} disabled={snifferLoading}>
              {snifferLoading ? "Prüfe ..." : "Sniffer prüfen"}
            </button>
          </div>

          <div className="sniffer-decision-card">
            <div>
              <p className="eyebrow">Vor dem Aufbau</p>
              <h3>Brauchst du den Sniffer?</h3>
              <p>Für Geräte-RSSI und eine grundlegende Funkbewertung reicht die CCU/XML-API. Ein vorhandenes Gateway ersetzt den Sniffer nicht, macht ihn aber auch nicht zwingend erforderlich.</p>
            </div>
            <div className="sniffer-decision-grid">
              <article>
                <strong>Zentrale und Gateways</strong>
                <span>Liefern CCU-RSSI, Gerätezustände und bekannte Empfänger. Gut für die Funkabdeckung aus Sicht der Installation.</span>
              </article>
              <article>
                <strong>AskSin-Sniffer</strong>
                <span>Zeigt Telegramme, Funkzeit pro Gerät, Carrier Sense und RSSI genau am Standort des Sniffers.</span>
              </article>
            </div>
            <small>Wichtig: Ein klassisches Homematic LAN-Gateway oder HmIP-Access-Point ist Empfangsinfrastruktur. Nur ausdrücklich konfigurierte HmIP-Geräte werden als Router bezeichnet.</small>
          </div>

          <div className="dc-overview-strip">
            <div className={snifferSnapshot?.connected || snifferSnapshot?.readerActive ? "is-ok" : "needs-action"}>
              <span>Sniffer</span>
              <strong>
                {snifferSnapshot?.connected
                  ? "Daten werden empfangen"
                  : snifferSnapshot?.readerActive
                    ? "Verbunden, wartet auf Funk"
                    : "Noch nicht verbunden"}
              </strong>
              <small>{form.snifferPort.trim() || "Kein USB-Port ausgewählt"}</small>
            </div>
            <div className={masterdataStatus?.askSinDevListAvailable ? "is-ok" : "needs-action"}>
              <span>Gerätenamen</span>
              <strong>{masterdataStatus?.askSinDevListAvailable ? "Namen werden aufgelöst" : "Einrichtung fehlt"}</strong>
              <small>
                {masterdataStatus?.askSinDevListAvailable
                  ? `${masterdataStatus.askSinDevListCount ?? 0} Einträge vorhanden`
                  : "AskSinAnalyzerDevList einmalig vorbereiten"}
              </small>
            </div>
            <div>
              <span>Messzeitraum</span>
              <strong>Letzte 60 Minuten</strong>
              <small>{snifferSnapshot?.checkedAt ? `Aktualisiert ${formatSnifferTime(snifferSnapshot.checkedAt)}` : "Noch keine Messung"}</small>
            </div>
            <div className={ccuDutyEvidence ? "is-ok" : "needs-action"}>
              <span>CCU-Duty-Cycle</span>
              <strong>{ccuDutyEvidence ? ccuDutyEvidence.detail.replace(/^Zentrale meldet /, "") : "Aus Analyse"}</strong>
              <small>Quelle: CCU/XML-API, nicht Sniffer</small>
            </div>
            <a href="https://github.com/psi-4ward/AskSinAnalyzerXS" target="_blank" rel="noreferrer">
              <span>Technische Grundlage</span>
              <strong>AskSinAnalyzerXS</strong>
              <small>Projekt öffnen ↗</small>
            </a>
          </div>

          {!masterdataStatus?.askSinDevListAvailable && (
            <div className="dc-guidance-card needs-action">
              <div>
                <strong>Gerätenamen einmalig vorbereiten</strong>
                <span>Ohne Geräteliste kann der Analyzer nur Funkadressen anzeigen. Das Script legt die kompatible CCU-Systemvariable an.</span>
              </div>
              <div className="dc-guidance-actions">
                <button type="button" onClick={() => void copyAskSinDevListScript()}>
                  Script kopieren
                </button>
                <a href="https://homematic-forum.de/forum/viewtopic.php?t=84237" target="_blank" rel="noreferrer">
                  Anleitung
                </a>
              </div>
            </div>
          )}

          {askSinScriptPreview && (
            <label className="script-preview">
              AskSin-Geräteliste Script zum manuellen Kopieren
              <textarea readOnly value={askSinScriptPreview} onFocus={(event) => event.target.select()} />
            </label>
          )}

          <details className="dc-config-details" open={!form.snifferPort.trim()}>
            <summary>
              <span>
                <strong>Sniffer-Verbindung</strong>
                <small>{form.snifferPort.trim() ? `${form.snifferPort.trim()} ausgewählt` : "USB-Port auswählen, um Funkdaten zu empfangen"}</small>
              </span>
              <b>{form.snifferPort.trim() ? "Ändern" : "Einrichten"}</b>
            </summary>
            <div className="dc-setup-grid">
              <fieldset className="setup-card">
                <legend>USB-Port</legend>
                <p>Der Sniffer steckt am Analyzer-System. Bei Proxmox muss der Port vorher an den LXC durchgereicht werden.</p>
                <div className="usb-port-picker">
                  <label>
                    Serieller Port
                    <select value={snifferPortSelectValue} onChange={(event) => selectSnifferPort(event.target.value)}>
                      <option value="">Kein Sniffer / später einrichten</option>
                      {usbPorts.map((usbPort) => (
                        <option value={usbPort.path} key={usbPort.path}>
                          {usbPort.stable ? "Stabil: " : ""}{usbPort.label}
                        </option>
                      ))}
                      <option value="__manual__">Manuell eintragen</option>
                    </select>
                  </label>
                  <button type="button" className="ghost-button" onClick={() => void loadUsbPorts(true)} disabled={usbPortsLoading}>
                    {usbPortsLoading ? "Suche läuft ..." : "Ports suchen"}
                  </button>
                </div>
                {showManualSnifferPort && (
                  <label>
                    Manueller USB-Port
                    <input value={form.snifferPort} onChange={(event) => updateForm({ ...form, snifferPort: event.target.value })} placeholder="/dev/serial/by-id/... oder /dev/ttyUSB0" />
                  </label>
                )}
              </fieldset>

              <div className={`dc-status-card ${snifferSnapshot?.connected || snifferSnapshot?.readerActive ? "is-connected" : ""}`}>
                <strong>{snifferSnapshot?.connected ? "Empfang läuft" : snifferSnapshot?.readerActive ? "Port wird überwacht" : "Keine Verbindung"}</strong>
                <span>
                  {snifferSnapshot?.connected
                    ? `Quelle: ${snifferSnapshot.source}`
                    : snifferSnapshot?.readerActive
                      ? "Löse jetzt ein Homematic-Gerät aus. Neue Daten werden automatisch geladen."
                      : "Wähle einen Port und starte anschließend die Prüfung."}
                </span>
              </div>
            </div>
          </details>

          <div className="dc-metric-grid">
            {[
              ["Sniffer-Funkzeit · 60 Min.", snifferSnapshot?.summary.telegrams ? `${snifferSnapshot.summary.dutyCycle}%` : "nicht gemessen", "Quelle: AskSin-Sniffer. Gleitende Funkzeit-Schätzung, nicht der CCU-WebUI-Wert."],
              [
                "Top Funkzeit-Anteil · 60 Min.",
                topDutyDevice ? `${topDutyDevice.dutyShare}%` : "keine Telegramme",
                topDutyDevice
                  ? `${topDutyDevice.name} · Anteil an der gemessenen Sendezeit, nicht am gesamten Funkkanal.`
                  : "Noch kein Gerät mit Funktelegrammen erkannt."
              ],
              ["Rauschpegel / Carrier Sense", carrierSenseText, carrierSenseHint],
              ...gatewayDutyCycleCards.map((gateway, index) => [
                `Gateway-Funkzeit ${index + 1}`,
                `${gateway.dutyCycle}%`,
                `${gateway.name} · Quelle DC/RSSI: Sniffer · Zentralen-RSSI ${topologyNodeFor(gateway)?.ccuRssi ?? "–"} dBm`
              ]),
              ["Telegramme", snifferSnapshot?.summary.telegrams ? String(snifferSnapshot.summary.telegrams) : "0", `${snifferSnapshot?.summary.rawLines ?? 0} Rohzeilen empfangen.`],
              ["Geräte", snifferSnapshot?.summary.devices ? String(snifferSnapshot.summary.devices) : "0", "Erkannte Funk-Absender aus Telegrammen."],
              [
                "Datenformat",
                snifferSnapshot?.summary.protocolCompatible
                  ? "AskSin erkannt"
                  : snifferSnapshot?.readerActive
                    ? "wartet"
                    : "nicht geprüft",
                snifferSnapshot?.summary.protocolCompatible
                  ? `${snifferSnapshot.summary.validLines} gültige Zeilen · ${snifferSnapshot.summary.invalidLines} sonstige Meldungen`
                  : snifferSnapshot?.summary.invalidLines
                    ? `${snifferSnapshot.summary.invalidLines} Zeilen entsprechen noch nicht dem AskSin-Format.`
                    : "Parser folgt dem Referenzformat von AskSinAnalyzerXS."
              ],
              [
                "Schwächstes RSSI",
                weakestRssiDevice
                  ? `Zentrale ${topologyNodeFor(weakestRssiDevice)?.ccuRssi ?? "–"} · Sniffer ${snifferSnapshot?.summary.weakestRssi ?? "–"} dBm`
                  : "nicht gemessen",
                weakestRssiDevice
                  ? `${weakestRssiDevice.name}${weakestRssiDevice.type ? ` · ${weakestRssiDevice.type}` : ""}`
                  : "Schwächstes empfangenes Telegramm."
              ]
            ].map(([label, value, hint]) => (
              <div className="dc-metric" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <em>{hint}</em>
              </div>
            ))}
          </div>

          <div className="dc-chart-card">
            <div>
              <p className="eyebrow">Verlauf</p>
              <h3>Telegramme und gemessener Rauschpegel</h3>
              <p>
                Blau = empfangene Homematic-Telegramme. Orange = regelmäßige Rauschpegel-Messpunkte des Sniffers – nicht einzelne Störsignale.
              </p>
            </div>
            <div className="dc-chart">
              {(() => {
                const timeline = snifferSnapshot?.timeline ?? [];
                const hasChartData = timeline.some((point) => point.telegrams > 0 || point.noiseSamples > 0);
                const maxTelegrams = Math.max(1, ...timeline.map((point) => point.telegrams));
                const latestDataIndex = timeline.reduce(
                  (latest, point, index) => point.telegrams > 0 || point.noiseSamples > 0 ? index : latest,
                  -1
                );
                const selectedIndex = activeSnifferMinute ?? latestDataIndex;
                const selectedPoint = selectedIndex >= 0 ? timeline[selectedIndex] : undefined;
                const selectedNoise = noiseAssessment(selectedPoint?.noiseAverage);

                return (
                  <>
                    <div className="dc-chart-bars" aria-label="Minutenverlauf von Telegrammen und gemessenem Rauschpegel">
                      {timeline.map((point, index) => {
                        const telegramHeight = point.telegrams > 0
                          ? Math.max(8, Math.min(100, (point.telegrams / maxTelegrams) * 100))
                          : 0;
                        const noiseHeight = point.noiseAverage !== undefined
                          ? Math.max(8, Math.min(100, ((120 + point.noiseAverage) / 60) * 100))
                          : 0;
                        const time = new Date(point.minute).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
                        return (
                          <button
                            type="button"
                            className={`dc-chart-column ${selectedIndex === index ? "is-active" : ""}`}
                            key={point.minute}
                            onMouseEnter={() => setActiveSnifferMinute(index)}
                            onFocus={() => setActiveSnifferMinute(index)}
                            onClick={() => setActiveSnifferMinute(index)}
                            aria-label={`${time}: ${point.telegrams} Telegramme, ${point.noiseAverage ?? "kein"} dBm Rauschpegel`}
                          >
                            <span className="dc-chart-noise" style={{ height: `${noiseHeight}%` }} />
                            <span className="dc-chart-telegram" style={{ height: `${telegramHeight}%` }} />
                          </button>
                        );
                      })}
                      {!hasChartData && (
                        <div className="dc-chart-empty">
                          <strong>Warte auf Snifferdaten</strong>
                          <span>Der Port wird dauerhaft überwacht. Löse ein Homematic-Gerät aus.</span>
                        </div>
                      )}
                    </div>
                    {selectedPoint && (
                      <div className="dc-chart-inspector" aria-live="polite">
                        <div>
                          <small>Minute</small>
                          <strong>{new Date(selectedPoint.minute).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</strong>
                        </div>
                        <div>
                          <small>Telegramme</small>
                          <strong>{selectedPoint.telegrams}</strong>
                          <span>{formatPercent(selectedPoint.dutyCycle)} geschätzte Funkzeit</span>
                        </div>
                        <div className={`noise-${selectedNoise.className}`}>
                          <small>Rauschpegel</small>
                          <strong>{selectedPoint.noiseAverage !== undefined ? `${selectedPoint.noiseAverage} dBm` : "nicht gemessen"}</strong>
                          <span>{selectedNoise.label}{selectedPoint.noiseSamples ? ` · ${selectedPoint.noiseSamples} Messungen` : ""}</span>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
              <div className="dc-chart-axis">
                <span>← älter · vor bis zu 60 Minuten</span>
                <strong>neue Werte erscheinen rechts →</strong>
              </div>
              <div className="dc-chart-totals">
                <span>Telegramme: {snifferSnapshot?.summary.telegrams ?? 0}</span>
                <span>Rauschpegel-Messpunkte: {snifferSnapshot?.summary.rssiSamples ?? 0}</span>
              </div>
              <div className="dc-chart-note">
                Viele orange Messpunkte bedeuten nur, dass der Sniffer häufig gemessen hat. Entscheidend ist der dBm-Wert:
                Ein stärker negativer Wert wie −100 dBm steht für einen ruhigeren Funkhintergrund als beispielsweise −70 dBm.
              </div>
              <div className="sniffer-retention-note">
                <strong>Langzeitdaten lokal gespeichert</strong>
                <span>
                  {snifferHistory?.points.length ?? 0} Minuten-Messpunkte · Aufbewahrung {snifferHistory?.retentionDays ?? 30} Tage.
                  API-Keys, Passwörter und Tokens sind darin nicht enthalten.
                </span>
              </div>
            </div>
          </div>

          {snifferSnapshot?.devices.length ? (
            <>
            <div className="dc-duty-panel">
              <div>
                <p className="eyebrow">Funklast</p>
                <h3>Sniffer-Funkzeit nach Verursacher</h3>
                <p>
                  Gleitender Zeitraum: letzte 60 Minuten. Der Kreis entspricht 100% der verfügbaren Funkstunde:
                  farbige Segmente sind belegte Funkzeit, der hellgrüne Bereich ist noch verfügbar.
                  Zusammengefasste weitere Geräte sind separat als „Weitere Geräte“ markiert. Quelle ist der AskSin-Sniffer, nicht der CCU-WebUI-Duty-Cycle.
                </p>
              </div>
              {(() => {
                const colors = ["#3478f6", "#20a783", "#f59e0b", "#8b5cf6", "#ec4899"];
                const topDevices = snifferSnapshot.devices.slice(0, 5);
                const measuredDutyCycle = Math.max(0, snifferSnapshot.summary.dutyCycle ?? 0);
                const displayedDutyCycle = Math.min(100, measuredDutyCycle);
                const topDutyCycle = topDevices.reduce((sum, device) => sum + device.dutyCycle, 0);
                const chartScale = measuredDutyCycle > 100 ? 100 / measuredDutyCycle : 1;
                const remainingDevices = Math.max(0, snifferSnapshot.devices.length - topDevices.length);
                const remainingDutyCycle = Math.max(0, Math.round((measuredDutyCycle - topDutyCycle) * 10) / 10);
                const freeDutyCycle = Math.max(0, Math.round((100 - displayedDutyCycle) * 10) / 10);
                const segments = [
                  ...topDevices.map((device, index) => ({
                    key: device.address,
                    label: device.name,
                    detail: `${device.serial ? `${device.serial} · ` : ""}${device.address}`,
                    value: device.dutyCycle,
                    share: device.dutyCycle * chartScale,
                    kind: "device" as const,
                    color: colors[index]
                  })),
                  ...(remainingDevices > 0 && remainingDutyCycle > 0.01 ? [{
                    key: "remaining",
                    label: `Weitere ${remainingDevices} Geräte`,
                    detail: "Zusammengefasste vom Sniffer berechnete Funkzeit",
                    value: remainingDutyCycle,
                    share: remainingDutyCycle * chartScale,
                    kind: "remaining" as const,
                    color: "#475569"
                  }] : []),
                  ...(freeDutyCycle > 0.01 ? [{
                    key: "free",
                    label: "Noch verfügbar",
                    detail: "Unbelegter Anteil der Funkstunde",
                    value: freeDutyCycle,
                    share: freeDutyCycle,
                    kind: "free" as const,
                    color: "#dcfce7"
                  }] : [])
                ];
                let position = 0;
                const chartSegments = segments.map((segment) => {
                  const start = position;
                  position += segment.share;
                  return {
                    ...segment,
                    start,
                    end: Math.min(100, position),
                    middle: start + (position - start) / 2
                  };
                });
                const hoveredSegment = chartSegments.find((segment) => segment.key === hoveredDutySegmentKey);

                return (
                  <div className="dc-duty-chart-layout">
                    <div
                      className="dc-duty-donut"
                      role="img"
                      aria-label={`Sniffer-Funkzeit ${measuredDutyCycle} Prozent. ${segments.map((segment) => `${segment.label}: ${segment.value} Prozentpunkte`).join(", ")}`}
                    >
                      <svg viewBox="0 0 100 100" aria-hidden="true">
                        {chartSegments.map((segment) => {
                          const labelPosition = polarPoint(50, 36.5, segment.middle);
                          return (
                            <g
                              className={`dc-duty-segment dc-duty-segment--${segment.kind} ${hoveredDutySegmentKey === segment.key ? "is-active" : ""}`}
                              key={segment.key}
                              tabIndex={0}
                              onMouseEnter={() => setHoveredDutySegmentKey(segment.key)}
                              onMouseLeave={() => setHoveredDutySegmentKey(null)}
                              onFocus={() => setHoveredDutySegmentKey(segment.key)}
                              onBlur={() => setHoveredDutySegmentKey(null)}
                            >
                              <title>{segment.label}: {segment.value}% der verfügbaren Funkstunde</title>
                              <path d={donutSegmentPath(segment.start, segment.end)} fill={segment.color} />
                              {segment.value >= 4 && (
                                <text
                                  x={labelPosition.x}
                                  y={labelPosition.y}
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  style={{ fill: segment.kind === "free" ? "#166534" : "#fff" }}
                                >
                                  {segment.value}%
                                </text>
                              )}
                            </g>
                          );
                        })}
                      </svg>
                      <div className="dc-duty-donut__center">
                        {hoveredSegment ? (
                          <>
                            <strong>{hoveredSegment.value}%</strong>
                            <span>{hoveredSegment.label}</span>
                            <small>
                              {hoveredSegment.kind === "free"
                                ? "noch verfügbar"
                                : hoveredSegment.kind === "remaining"
                                  ? "weitere belegte Funkzeit"
                                  : "belegte Sniffer-Funkzeit"}
                            </small>
                          </>
                        ) : (
                          <>
                            <strong>{measuredDutyCycle}%</strong>
                            <span>Sniffer-Funkzeit</span>
                            <small>{measuredDutyCycle > 100 ? "Messwert über 100% – prüfen" : `${freeDutyCycle}% verfügbar`}</small>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="dc-duty-legend">
                      {segments.map((segment) => (
                        <div className={`dc-duty-legend-row dc-duty-legend-row--${segment.kind}`} key={segment.key}>
                          <i style={{ background: segment.color }} />
                          <div>
                            <strong>{segment.label}</strong>
                            <span>{segment.detail}</span>
                          </div>
                          <b>{segment.kind === "free" ? `${segment.value}% frei` : `${segment.value}% Funkzeit`}</b>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              <div className="dc-duty-explanation">
                <strong>So liest du das Diagramm:</strong>
                <span>
                  62% in der Mitte bedeutet beispielsweise: 62% der erlaubten Funkzeit waren in den letzten 60 Minuten belegt.
                  Die farbigen Gerätesegmente erklären, wer wie viele Prozentpunkte davon verursacht hat.
                  „Noch verfügbar“ zählt nicht als Verursacher, sondern ist die Restkapazität bis 100%.
                  Der bekannte CCU-Duty-Cycle steht separat im Analysepunkt „Duty Cycle“.
                </span>
              </div>
            </div>

            <details className="dc-table-card dc-data-details">
              <summary>
                <span>
                  <small>Geräte-Details</small>
                  <strong>Funklast und Signalwerte</strong>
                </span>
                <b>{snifferSnapshot.devices.length} Geräte · anzeigen</b>
              </summary>
              <div className="dc-table-wrap">
                <table className="dc-table">
                  <thead>
                    <tr>
                      <th>Gerät</th>
                      <th>Funkadresse</th>
                      <th>Telegramme</th>
                      <th>Sniffer-Funkzeit</th>
                      <th>Anteil</th>
                      <th>RSSI Zentrale</th>
                      <th>RSSI Sniffer Ø</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSnifferDevices.map((device) => (
                      <tr key={device.address}>
                        <td>
                          <strong>{device.name}</strong>
                          <span>{device.type ?? device.serial ?? (device.name === device.address ? "Name noch nicht auflösbar" : "")}</span>
                        </td>
                        <td><code>{device.address}</code></td>
                        <td>{device.telegrams}</td>
                        <td>{device.dutyCycle}%</td>
                        <td>
                          <div className="dc-mini-bar"><span style={{ width: `${Math.max(2, device.dutyShare)}%` }} /></div>
                          {device.dutyShare}%
                        </td>
                        <td><RssiAssessment value={topologyNodeFor(device)?.ccuRssi} /></td>
                        <td><RssiAssessment value={device.avgRssi} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {snifferSnapshot.devices.length > 10 && (
                <button type="button" className="dc-more-button" onClick={() => setShowAllSnifferDevices((current) => !current)}>
                  {showAllSnifferDevices ? "Nur die 10 höchsten Funklasten" : `Alle ${snifferSnapshot.devices.length} Geräte anzeigen`}
                </button>
              )}
              {snifferSnapshot.devices.some((device) => device.name === device.address) && (
                <div className="dc-guidance-card needs-action">
                  <div>
                    <strong>Einige Gerätenamen fehlen</strong>
                    <span>
                      Das ist kein Fehler im Funkempfang: Die Telegramme enthalten nur Funkadressen. Kopiere das AskSin-Geräteliste-Script,
                      führe es in der CCU-WebUI aus und prüfe danach erneut.
                    </span>
                  </div>
                  <div className="dc-guidance-actions">
                    <button type="button" onClick={() => void copyAskSinDevListScript()}>
                      Script kopieren
                    </button>
                  </div>
                </div>
              )}
            </details>

            <details className="dc-table-card dc-data-details">
              <summary>
                <span>
                  <small>Telegramm-Details</small>
                  <strong>Neueste Funktelegramme</strong>
                </span>
                <b>{snifferSnapshot.events.length} gespeichert · anzeigen</b>
              </summary>
              <div className="dc-table-wrap">
                <table className="dc-table dc-telegram-table">
                  <thead>
                    <tr>
                      <th>Zeit</th>
                      <th>Von</th>
                      <th>Von/An</th>
                      <th>An</th>
                      <th>RSSI Zentrale</th>
                      <th>RSSI Sniffer</th>
                      <th>Len</th>
                      <th>Cnt</th>
                      <th>Sniffer-Funkzeit</th>
                      <th>Typ</th>
                      <th>Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSnifferEvents.map((event, index) => (
                      <tr key={`${event.raw}-${index}`}>
                        <td>{formatSnifferTime(event.tstamp)}</td>
                        <td>
                          <strong>{event.fromName ?? event.fromAddress}</strong>
                          <span>{event.fromSerial ?? event.fromAddress}</span>
                        </td>
                        <td>{event.fromName && event.toName ? `${event.fromName} → ${event.toName}` : "–"}</td>
                        <td>
                          <strong>{event.toName ?? event.toAddress}</strong>
                          <span>{event.toSerial ?? event.toAddress}</span>
                        </td>
                        <td><RssiAssessment value={topologyNodeFor({ serial: event.fromSerial, address: event.fromAddress })?.ccuRssi} /></td>
                        <td><RssiAssessment value={event.rssi} /></td>
                        <td>{event.len}</td>
                        <td>{event.cnt}</td>
                        <td>{Math.round(event.dutyCycle * 10) / 10}%</td>
                        <td>{event.type || "–"}</td>
                        <td>
                          <div className="flag-list">
                            {event.flags.map((flag) => (
                              <span className={`flag-badge ${flagClass(flag)}`} key={flag}>{flag}</span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {snifferSnapshot.events.length > 10 && (
                <button type="button" className="dc-more-button" onClick={() => setShowAllSnifferEvents((current) => !current)}>
                  {showAllSnifferEvents ? "Nur die neuesten 10" : `Alle ${snifferSnapshot.events.length} Telegramme anzeigen`}
                </button>
              )}
            </details>
            </>
          ) : (
            <div className="system-collector-empty">
              <div>
                <p className="eyebrow">{snifferSnapshot?.rssiNoise?.length ? "Rauschpegel wird gemessen" : snifferSnapshot?.connected ? "Noch keine Funktelegramme" : "Noch leer"}</p>
                <h3>{snifferSnapshot?.rssiNoise?.length ? "Der Sniffer misst den Funkhintergrund, aber noch keine Homematic-Telegramme" : snifferSnapshot?.connected ? "Der Sniffer sendet Startmeldungen, aber noch keine Homematic-Telegramme" : "Der DC-Analyzer wartet auf echte Snifferdaten"}</h3>
                <p>
                  Wichtig: Kurze Zeilen wie `:8A;` sind RSSI-Noise/Carrier-Sense. Für die Telegramm-Tabelle müssen längere
                  AskSin-Zeilen im Format `:...;` ankommen. Löse dafür ein Homematic-Gerät in Funkreichweite aus.
                </p>
              </div>
              <ol>
                <li>Sniffer nach AskSinAnalyzerXS/AskSinSniffer328P aufbauen oder vorhandenen Sniffer anschließen.</li>
                <li>USB-Port im Setup oder hier auswählen.</li>
                <li>Bei Proxmox/LXC den USB-Port an den Container durchreichen.</li>
                <li>Ein Homematic-Gerät auslösen und danach „Sniffer prüfen“ klicken.</li>
              </ol>
              {snifferSnapshot?.diagnostics.length ? (
                <details className="dc-events" open>
                  <summary>
                    <span>
                      <small>Sniffer-Meldungen</small>
                      Start- und Infomeldungen
                    </span>
                    <strong>{snifferSnapshot.diagnostics.length}</strong>
                  </summary>
                  <ul>
                    {snifferSnapshot.diagnostics.map((line, index) => (
                      <li key={`${line}-${index}`}>
                        <strong>Sniffer</strong>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          )}
        </section>
      )}

      {currentPage === "diagnostics" && (
        <section className="panel diagnostics-page">
          <div className="panel__header diagnostics-page__header">
            <div>
              <p className="eyebrow">Status & Diagnose</p>
              <h2>Welche Datenquelle funktioniert?</h2>
              <p>Diese Ansicht zeigt den letzten Erfolg, das Datenalter und den konkreten Fehler jeder Quelle. Passwörter und Tokens werden niemals angezeigt.</p>
            </div>
            <button type="button" className="ghost-button" onClick={() => void loadDiagnostics(true)} disabled={diagnosticsLoading}>
              {diagnosticsLoading ? "Status wird geladen …" : "Status aktualisieren"}
            </button>
          </div>

          <div className="diagnostics-grid">
            {(diagnostics?.sources ?? []).map((source) => (
              <article className={`diagnostic-card diagnostic-card-${source.status}`} key={source.id}>
                <div className="diagnostic-card__header">
                  <div>
                    <span>{source.status === "ok" || source.status === "fresh" ? "Bereit" : source.status === "stale" ? "Veraltet" : source.status === "optional" ? "Optional" : source.status === "missing" ? "Fehlt" : "Fehler"}</span>
                    <h3>{source.label}</h3>
                  </div>
                  {source.lastSuccessAt && (
                    <small className={`data-age data-age-${formatDataAge(source.lastSuccessAt).state}`}>
                      {formatDataAge(source.lastSuccessAt).label}
                    </small>
                  )}
                </div>
                <p>{source.detail}</p>
                {source.diagnostics?.length ? (
                  <details>
                    <summary>Prüfschritte anzeigen</summary>
                    <ol>
                      {source.diagnostics.map((diagnostic) => (
                        <li className={`diagnostic-${diagnostic.status}`} key={`${diagnostic.step}-${diagnostic.detail}`}>
                          <strong>{diagnostic.step}</strong>
                          <span>{diagnostic.detail}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                ) : null}
              </article>
            ))}
          </div>

          {!diagnostics?.sources.length && !diagnosticsLoading && (
            <div className="system-collector-empty">
              <div>
                <p className="eyebrow">Noch keine Statusdaten</p>
                <h3>Diagnose konnte noch nicht geladen werden</h3>
                <p>Prüfe, ob die lokale Analyzer-API läuft, und klicke anschließend auf „Status aktualisieren“.</p>
              </div>
            </div>
          )}

          <div className="history-panel">
            <div>
              <p className="eyebrow">Analysehistorie</p>
              <h3>Veränderungen zwischen den letzten Analysen</h3>
            </div>
            {analysisHistory?.changes.length ? (
              <div className="history-changes">
                {analysisHistory.changes.map((change) => (
                  <div key={change.id}>
                    <strong>{change.title}</strong>
                    <span>{statusLabel[change.from]} → {statusLabel[change.to]}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Noch keine Statusänderung zwischen zwei gespeicherten Analysen erkannt.</p>
            )}
            <div className="history-list">
              {(analysisHistory?.entries ?? []).slice(0, 10).map((entry) => (
                <article key={entry.generatedAt}>
                  <strong>{new Date(entry.generatedAt).toLocaleString("de-DE")}</strong>
                  <span>{entry.summary.critical} kritisch · {entry.summary.warning} Hinweise · {entry.summary.improvement} Optimierungen · {entry.summary.ok} OK</span>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {currentPage === "logs" && (
        <section className="panel logs-page">
          <div className="panel__header logs-page__header">
            <div>
              <p className="eyebrow">Logs</p>
              <h2>Logauswertung</h2>
              <p>
                Hier siehst du die zuletzt vom Collector übertragenen Logs 1:1. Die KI bekommt diese Daten erst,
                wenn du unten ausdrücklich „Fehler prüfen“ oder „Gesamten Log analysieren“ startest.
              </p>
            </div>
            <div className="logs-actions">
              <button type="button" className="ghost-button" onClick={() => void loadLogs(true)} disabled={logsLoading}>
                {logsLoading ? "Lade ..." : "Logs neu laden"}
              </button>
            </div>
          </div>

          <div className="ai-log-controls">
            <div>
              <strong>Was soll geprüft werden?</strong>
              <span>Berücksichtigt werden höchstens die neuesten 500 vom Collector übertragenen Logzeilen.</span>
            </div>
            <label>
              Analyseumfang
              <select value={aiLogMode} onChange={(event) => setAiLogMode(event.target.value as "issues" | "full")}>
                <option value="issues">Nur Fehler und Warnungen (empfohlen)</option>
                <option value="full">Gesamten übertragenen Log prüfen</option>
              </select>
            </label>
            <button
              type="button"
              className="analyze-button analyze-button-compact"
              onClick={() => void analyzeLogsWithAi()}
              disabled={aiLogLoading}
            >
              {aiLogLoading ? "KI analysiert ..." : aiLogMode === "issues" ? "Fehler prüfen" : "Gesamten Log analysieren"}
            </button>
          </div>

          <div className="logs-privacy-note">
            <strong>Datenschutz-Hinweis</strong>
            <span>
              Automatisch wird nichts an OpenAI oder Gemini gesendet. Im Modus „Nur Fehler und Warnungen“ erfolgt keine KI-Anfrage,
              wenn der lokale Filter keine auffällige Zeile findet.
            </span>
          </div>

          {!notificationSettings.ai.enabled && (
            <div className="setup-note">
              KI-Analyse ist in den Einstellungen deaktiviert. Du kannst die Logs trotzdem lokal lesen.
            </div>
          )}

          {aiLogLoading && (
            <div className="ai-log-progress" role="status" aria-live="polite">
              <span className="ai-log-progress__spinner" />
              <div>
                <strong>KI analysiert die ausgewählten Logzeilen …</strong>
                <span>Das Ergebnis erscheint genau hier. Du wirst nach Abschluss automatisch dorthin geführt.</span>
              </div>
            </div>
          )}

          {aiLogResult && (
            <article
              className={`ai-log-result status-${aiLogResult.status}`}
              ref={aiLogResultRef}
              tabIndex={-1}
              aria-live="polite"
            >
              <div className="detail-title">
                <span className={`pill status-${aiLogResult.status}`}>
                  {getStatusIcon(aiLogResult.status, "status-icon-inline")}
                  {statusLabel[aiLogResult.status]}
                </span>
                <h3>{aiLogResult.title}</h3>
              </div>
              <p className="lead">{aiLogResult.summary}</p>
              <div className={`recommendation-banner status-${aiLogResult.status}`}>
                <div className="banner-icon">
                  {getStatusIcon(aiLogResult.status, "banner-svg")}
                </div>
                <div className="banner-content">
                  <strong>Was solltest du jetzt tun?</strong>
                  <p>{aiLogResult.recommendation}</p>
                </div>
              </div>
              {aiLogResult.evidence.length > 0 && (
                <>
                  <h4>Was wurde im Log erkannt?</h4>
                  <ul className="evidence ai-log-evidence">
                    {aiLogResult.evidence.map((item, index) => (
                      <li key={`${item.source}-${index}`}>
                        <strong><SourceBadge source={item.source} />{item.source}</strong>
                        <span>{item.detail}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h4>Einordnung</h4>
              <ul>
                {aiLogResult.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </article>
          )}

          <div className="logs-meta">
            <span>{logPayload?.host ? `Quelle: ${logPayload.host}` : "Quelle: noch nicht bekannt"}</span>
            <span>{logPayload?.collectedAt ? `Empfangen: ${new Date(logPayload.collectedAt).toLocaleString("de-DE")}` : "Noch kein Collector-Snapshot"}</span>
            <span>{logPayload?.logs.length ?? 0} Zeilen</span>
            <span>
              Analyzer: {typeof window !== "undefined" ? window.location.host : "lokaler Server"}
              {logPayload?.analyzerVersion ? ` · Version ${logPayload.analyzerVersion}` : ""}
            </span>
          </div>

          {logPayload?.logs.length ? (
            <pre className="raw-log-view" aria-label="Rohlog">{logPayload.logs.join("\n")}</pre>
          ) : (
            <div className="system-collector-empty">
              <div>
                <p className="eyebrow">Keine Logs</p>
                <h3>
                  {logPayload?.collectorState === "stale"
                    ? "Collector sendet nicht mehr"
                    : logPayload?.collectorAvailable
                      ? "Collector findet keine Logdatei"
                      : "Noch keine Logdaten empfangen"}
                </h3>
                <p>
                  {logPayload?.collectorState === "stale"
                    ? `Der Collector war bereits verbunden, der letzte Snapshot ist aber ${logPayload.collectorAgeMinutes ?? "viele"} Minuten alt. Installiere den dauerhaften Cronjob erneut.`
                    : logPayload?.collectorAvailable
                      ? "Systemdaten kommen an, aber auf der CCU wurde keine lesbare Logquelle gefunden. Prüfe /var/log/messages, /var/log/syslog oder journalctl."
                      : "Führe den Shell-Collector auf der CCU/RaspberryMatic aus, damit Logs hier 1:1 angezeigt werden."}
                </p>
              </div>
              <div className="script-copy-row">
                <code>{recommendedCollectorCommand}</code>
                <button type="button" onClick={() => void copyText(recommendedCollectorCommand)}>
                  Kopieren
                </button>
              </div>
            </div>
          )}

        </section>
      )}

      {currentPage === "analysis" && (
        <>
      {!analysis && <form className="analysis-start panel" onSubmit={runAnalysis}>
        <div>
          <p className="eyebrow">Analyse</p>
          <h2>Analyse starten</h2>
          <p>
            Ein Klick prüft die verfügbaren Datenquellen. Fehlende Setup-Punkte begrenzen nur die Tiefe der Analyse.
          </p>
          {!setupProgress.complete && (
            <p className="setup-note">Setup {setupProgress.percent}% eingerichtet · fehlende Punkte bei Bedarf ergänzen.</p>
          )}
        </div>
        <div className="analysis-start__actions">
          <button className="analyze-button analyze-button-compact" disabled={loading}>
            {loading ? "Analyse läuft ..." : "Analyse starten"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>}

      {loading && (
        <section className="analysis-loader panel" aria-live="polite" aria-label="Analyse läuft">
          <div className="loader-orbit" aria-hidden="true">
            <span className="orbit-ring orbit-ring-outer" />
            <span className="orbit-ring orbit-ring-inner" />
            <span className="orbit-dot orbit-dot-ccu">CCU</span>
            <span className="orbit-dot orbit-dot-xml">XML</span>
            <span className="orbit-dot orbit-dot-log">LOG</span>
            <strong>HA</strong>
          </div>
          <div className="loader-content">
            <p className="eyebrow">Analyse läuft</p>
            <h2>{analysisSteps[activeAnalysisStep]?.label ?? "Prüfung läuft"}</h2>
            <p>{analysisSteps[activeAnalysisStep]?.detail ?? "Datenquellen werden geprüft."}</p>
            <div className="loader-progress" role="progressbar" aria-valuemin={0} aria-valuemax={analysisSteps.length} aria-valuenow={activeAnalysisStep + 1}>
              <span style={{ width: `${((activeAnalysisStep + 1) / analysisSteps.length) * 100}%` }} />
            </div>
            <div className="loader-steps">
              {analysisSteps.map((step, index) => (
                <div className={`loader-step ${index < activeAnalysisStep ? "is-done" : ""} ${index === activeAnalysisStep ? "is-active" : ""}`} key={step.label}>
                  <span>{index < activeAnalysisStep ? "✓" : index + 1}</span>
                  <div>
                    <strong>{step.label}</strong>
                    <small>{step.detail}</small>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {analysis && summary && !loading && (
        <section className="results">
          <div className="results__header">
            <div>
              <p className="eyebrow">Ergebnis</p>
              <h2>Analyse vom {new Date(analysis.generatedAt).toLocaleString("de-DE")}</h2>
              <span className={`data-age data-age-${formatDataAge(analysis.generatedAt).state}`}>
                {formatDataAge(analysis.generatedAt).label}
              </span>
            </div>
            <div className="results__header-actions">
              {form.hmipRoutingEnabled && displayedAnalysis?.checks.some((check) => check.id === "routing-topology") && (
                <button
                  type="button"
                  className="routing-entry-button"
                  onClick={() => void openRoutingGraphic(false)}
                  disabled={loading || routingTopologyLoading}
                >
                  <span aria-hidden="true">↗</span>
                  <strong>Routing-Grafik</strong>
                </button>
              )}
              <div className={`auto-refresh-pill ${analysisAutoRefreshing ? "is-refreshing" : ""}`} aria-live="polite">
                <span aria-hidden="true">↻</span>
                <div>
                  <strong>{analysisAutoRefreshing ? "Aktualisiert …" : "Auto-Refresh"}</strong>
                  <small>{analysisAutoRefreshing ? "Daten werden geprüft" : `in ${dashboardRefreshSecondsLeft}s`}</small>
                </div>
              </div>
              <div className="score">
                <strong>{displayedAnalysis?.checks.length ?? analysis.checks.length}</strong>
                <span>Prüfpunkte</span>
              </div>
            </div>
          </div>

          <section className="analysis-source-hub" aria-labelledby="analysis-source-title">
            <div className="analysis-source-hub__header">
              <div>
                <p className="eyebrow">Datenquellen</p>
                <h3 id="analysis-source-title">Woher kommen die Ergebnisse?</h3>
              </div>
              <button type="button" className="light-button" onClick={() => navigateTo("diagnostics")}>
                Status öffnen
              </button>
            </div>
            <div className="analysis-source-hub__grid">
              {analysisSourceItems.map((source) => {
                const age = formatDataAge(source.time);
                const state = source.time ? age.state : source.required ? "missing" : "optional";
                return (
                  <article className={`source-hub-card source-hub-card-${state}`} key={source.id}>
                    <div>
                      <strong>{source.label}</strong>
                      <small className={`data-age data-age-${age.state}`}>
                        {source.time ? age.label : source.required ? "fehlt" : "optional"}
                      </small>
                    </div>
                    <p>{source.purpose}</p>
                    <button
                      type="button"
                      onClick={() => {
                        if (source.actionType === "diagnostics") navigateTo("diagnostics");
                        if (source.actionType === "collector") openActionModal("collector");
                        if (source.actionType === "masterdata") navigateTo("setup");
                        if (source.actionType === "dc") navigateTo("dc");
                      }}
                    >
                      {source.action}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>

          {snifferAffectedChecks > 0 && (
            <section className="analysis-source-mode" aria-label="Snifferdaten in der Analyse">
              <div>
                <strong>{analysisSnifferMode === "base" ? "Basisanalyse ohne Snifferwerte" : "Zusatzanalyse mit Snifferwerten"}</strong>
                <span>
                  {analysisSnifferMode === "base"
                    ? "Empfohlen für die meisten Nutzer: CCU-, XML-API-, Collector- und Systemdaten. Sniffer-Belege bleiben ausgeblendet."
                    : "Ergänzt die Basisanalyse um Telegramme, Funklast und Messwerte am Standort des Sniffers."}
                </span>
              </div>
              <div role="group" aria-label="Analyseansicht wählen">
                <button
                  type="button"
                  className={analysisSnifferMode === "base" ? "is-active" : ""}
                  onClick={() => setAnalysisSnifferMode("base")}
                >
                  Ohne Sniffer
                </button>
                <button
                  type="button"
                  className={analysisSnifferMode === "with-sniffer" ? "is-active" : ""}
                  onClick={() => setAnalysisSnifferMode("with-sniffer")}
                >
                  Mit Sniffer <small>{snifferAffectedChecks}</small>
                </button>
              </div>
            </section>
          )}

          {guidedActions.length > 0 && (
            <section className="guided-actions" aria-labelledby="guided-actions-title">
              <div className="guided-actions__header">
                <div>
                  <p className="eyebrow">Nächste Schritte</p>
                  <h3 id="guided-actions-title">Das solltest du jetzt tun</h3>
                  <p>Nach Priorität sortiert. Öffne nur den Schritt, den du gerade bearbeiten möchtest.</p>
                </div>
                <span>{guidedActions.length} Schritte</span>
              </div>
              <div className="guided-actions__grid">
                {guidedActions.map((action, index) => (
                  <article className="guided-action-card" key={action.id}>
                    <div className="guided-action-card__number">{index + 1}</div>
                    <div>
                      <small>{action.eyebrow}</small>
                      <h4>{action.title}</h4>
                      <p>{action.detail}</p>
                    </div>
                    <button type="button" onClick={() => openActionModal(action.modal, action.checkId)}>
                      {action.button}
                    </button>
                  </article>
                ))}
              </div>
            </section>
          )}

          {analysis.systemDashboard?.available && (
            <div className="system-dashboard">
              <div className="system-dashboard__header">
                <div>
                  <p className="eyebrow">System-Dashboard</p>
                  <h3>{analysis.systemDashboard.host ?? "Zentrale"}</h3>
                  {analysis.systemDashboard.ccuHost && (
                    <a className="system-dashboard__link" href={analysis.systemDashboard.ccuUiUrl ?? `http://${analysis.systemDashboard.ccuHost}/`} target="_blank" rel="noreferrer">
                      CCU UI öffnen: {analysis.systemDashboard.ccuHost}
                    </a>
                  )}
                </div>
                <div className="system-dashboard__meta">
                  <div className="system-dashboard__freshness">
                    {analysis.systemDashboard.collectedAt ? (
                      <>
                        <small className={`data-age data-age-${formatDataAge(analysis.systemDashboard.collectedAt).state}`}>
                          {formatDataAge(analysis.systemDashboard.collectedAt).label}
                        </small>
                        <span>Systemwerte vom {new Date(analysis.systemDashboard.collectedAt).toLocaleString("de-DE")}</span>
                      </>
                    ) : (
                      <span>Zeitpunkt des Snapshots unbekannt</span>
                    )}
                  </div>
                  <button type="button" className="collector-shortcut-button" onClick={() => openActionModal("collector")}>
                    Collector-Script anzeigen
                  </button>
                </div>
              </div>
              {hasShellSystemData(analysis.systemDashboard) && (
                <div className="dashboard-refresh-timer" aria-label={`Nächste Aktualisierung in ${dashboardRefreshSecondsLeft} Sekunden`}>
                  <div>
                    <span>Nächste Aktualisierung</span>
                    <strong>{dashboardRefreshSecondsLeft}s</strong>
                  </div>
                  <div className="dashboard-refresh-timer__track">
                    <span style={{ width: `${dashboardRefreshProgress}%` }} />
                  </div>
                </div>
              )}
              {!hasShellSystemData(analysis.systemDashboard) ? (
                <div className="system-collector-empty">
                  <div>
                    <p className="eyebrow">Systemdaten fehlen</p>
                    <h3>CPU, RAM, Temperatur, Speicher und Backups brauchen das Shell-Script</h3>
                    <p>
                      Die Homematic-Analyse funktioniert bereits. Für das System-Dashboard muss die CCU/RaspberryMatic
                      aber regelmäßig Messwerte an den Analyzer senden.
                    </p>
                  </div>
                  <ol>
                    <li>Per SSH auf der CCU/RaspberryMatic anmelden: <code>ssh root@{analysis.systemDashboard.ccuHost ?? (form.ccuHost.trim() || "CCU-IP")}</code></li>
                    <li>Den folgenden Befehl einfügen und ausführen.</li>
                    <li>Danach die Analyse neu starten oder kurz warten — die Werte aktualisieren sich minütlich.</li>
                  </ol>
                  <div className="script-copy-row">
                    <code>{collectorCommand}</code>
                    <button type="button" onClick={() => void copyCollectorCommand()}>
                      Kopieren
                    </button>
                    <button type="button" className="secondary" onClick={() => openActionModal("collector")}>
                      Anleitung öffnen
                    </button>
                  </div>
                  <details className="system-collector-empty__help">
                    <summary>Wie aktiviere ich SSH?</summary>
                    <p>
                      WebUI öffnen → Einstellungen → Systemsteuerung → Sicherheit → SSH aktivieren und Passwort setzen.
                      Der Benutzer ist bei RaspberryMatic/CCU normalerweise <code>root</code>.
                    </p>
                  </details>
                </div>
              ) : (
                <div className="system-metric-groups">
                  {(() => {
                  const history = analysis.systemDashboard.history ?? [];
                  const timeLabels = historyTimeLabels(history);
                  const temperatureValues = history.map((point) => parseTemperature(point.temperature)).filter((value): value is number => value !== undefined);
                  const temperatureMin = temperatureValues.length ? Math.floor(Math.min(...temperatureValues) - 2) : 0;
                  const temperatureMax = temperatureValues.length ? Math.ceil(Math.max(...temperatureValues) + 2) : 100;

                  const metrics = [
                  {
                    group: "performance",
                    label: "CPU",
                    value: formatCpu(analysis.systemDashboard.cpu),
                    hint: "Systemlast der CCU/RaspberryMatic.",
                    help: "Wenn CPU nicht verfügbar ist: Setup öffnen und den Shell-Collector minütlich einrichten. Der Verlauf zeigt 0–100% CPU-Auslastung der CCU.",
                    sparkline: sparklinePoints(history.map((point) => parseCpuLoad(point.cpu)).filter((value): value is number => value !== undefined)),
                    sparklineLabel: "CPU-Verlauf 0 bis 100 Prozent",
                    axisTop: "100%",
                    axisBottom: "0%",
                    timeLabels
                  },
                  {
                    group: "performance",
                    label: "RAM",
                    value: formatMemory(analysis.systemDashboard.memory),
                    hint: "Arbeitsspeicher der CCU/RaspberryMatic.",
                    help: "Wenn RAM nicht verfügbar ist: Setup öffnen und den Shell-Collector minütlich einrichten oder das CCU-WebUI-Script erneut kopieren. Der Verlauf zeigt 0–100% RAM-Belegung.",
                    sparkline: sparklinePoints(history.map((point) => parseMemoryUsagePercent(point.memory)).filter((value): value is number => value !== undefined)),
                    sparklineLabel: "RAM-Verlauf 0 bis 100 Prozent",
                    axisTop: "100%",
                    axisBottom: "0%",
                    timeLabels
                  },
                  {
                    group: "performance",
                    label: "Temperatur",
                    value: formatTemperature(analysis.systemDashboard.temperature),
                    hint: analysis.systemDashboard.temperature ? "CPU-/Systemtemperatur der Zentrale." : "Auf der CCU das aktualisierte WebUI-Script einmal ausführen.",
                    help: "Temperatur kommt über `/usr/bin/vcgencmd measure_temp`. Wenn sie fehlt: Script auf RaspberryMatic/CCU3 ausführen; in einem LXC ist dieser Wert meist nicht vorhanden.",
                    sparkline: sparklinePoints(temperatureValues, 120, 34, temperatureMin, temperatureMax),
                    sparklineLabel: "Temperatur-Verlauf der Zentrale",
                    axisTop: `${temperatureMax}°`,
                    axisBottom: `${temperatureMin}°`,
                    timeLabels
                  },
                  {
                    group: "storage",
                    label: "Lokaler Speicher",
                    value: formatDisk(analysis.systemDashboard.disk),
                    hint: "Interner Speicherbereich der CCU/RaspberryMatic.",
                    help: "Wenn lokaler Speicher nicht verfügbar ist: CCU-WebUI-Script aktualisieren und erneut ausführen oder Shell-Collector minütlich einrichten. Geprüft wird `df -h /usr/local`. Gelb ab 80%, rot ab 95% Belegung.",
                    usageStatus: (() => {
                      const usage = parseDiskUsagePercent(analysis.systemDashboard.disk);
                      return usage === undefined ? "" : usage >= 95 ? "danger" : usage >= 80 ? "warning" : "";
                    })(),
                    statusLabel: (() => {
                      const usage = parseDiskUsagePercent(analysis.systemDashboard.disk);
                      return usage === undefined || usage < 80 ? "" : usage >= 95 ? "Speicher kritisch" : "Speicher wird knapp";
                    })()
                  },
                  {
                    group: "storage",
                    label: "USB/Backup-Speicher",
                    value: formatDisk(analysis.systemDashboard.backupDisk),
                    hint: "Speicherplatz des Backup-Mediums, falls ein USB-Stick erkannt wurde.",
                    help: "Der Wert kommt vom Dateisystem, auf dem das neueste Backup liegt. Wenn nicht verfügbar: Shell-Collector nach dem Update neu auf der CCU ausführen und prüfen, ob der Stick unter `/media`, `/mnt` oder `/run/media` gemountet ist.",
                    usageStatus: (() => {
                      const usage = parseDiskUsagePercent(analysis.systemDashboard.backupDisk);
                      return usage === undefined ? "" : usage >= 95 ? "danger" : usage >= 80 ? "warning" : "";
                    })(),
                    statusLabel: (() => {
                      const usage = parseDiskUsagePercent(analysis.systemDashboard.backupDisk);
                      return usage === undefined || usage < 80 ? "" : usage >= 95 ? "Speicher kritisch" : "Speicher wird knapp";
                    })()
                  },
                  {
                    group: "storage",
                    label: "Backups",
                    value: formatBackups(
                      analysis.systemDashboard.backups,
                      analysis.systemDashboard.backupPaths,
                      analysis.systemDashboard.backupLatestDirectory,
                      analysis.systemDashboard.backupLatestAt,
                      analysis.systemDashboard.backupLatestPath
                    ),
                    hint: Number(analysis.systemDashboard.backups ?? 0) > 0 ? "Backup-Ordner und Datum des neuesten Backups." : "Keine Backup-Dateien in den bekannten CCU-Pfaden gefunden.",
                    help: "Bekannte Pfade: `/usr/local/backup`, `/media`, `/mnt`, `/run/media`, `/usr/local/sdcard`. Per SSH suchen: `find /usr/local/backup /media /mnt /run/media /usr/local/sdcard -type f 2>/dev/null | grep -Ei '(\\.sbk$|\\.tar\\.gz$|\\.tgz$|\\.zip$)'`.",
                    onClick: Number(analysis.systemDashboard.backups ?? 0) > 0 ? () => {
                      setBackupPage(0);
                      setShowBackupModal(true);
                    } : undefined
                  },
                  {
                    group: "operation",
                    label: "Uptime",
                    value: formatUptime(analysis.systemDashboard.uptime),
                    hint: "Laufzeit seit dem letzten Neustart.",
                    help: "Wenn nicht verfügbar: CCU-WebUI-Script erneut ausführen. Es liest `uptime` direkt auf der Zentrale."
                  }
                ];
                  const groups = [
                    { id: "performance", title: "Leistung", description: "CPU, Arbeitsspeicher und Temperatur" },
                    { id: "storage", title: "Speicher & Backups", description: "Interner Speicher, Backup-Medium und Datensicherungen" },
                    { id: "operation", title: "Betrieb", description: "Laufzeit und Neustarts der Zentrale" }
                  ];

                  return groups.map((group) => (
                    <section className={`system-metric-group system-metric-group-${group.id}`} key={group.id}>
                      <header>
                        <strong>{group.title}</strong>
                        <span>{group.description}</span>
                      </header>
                      <div className="metric-grid">
                        {metrics.filter((metric) => metric.group === group.id).map((metric) => (
                  <div
                    className={`metric-card ${metric.usageStatus ? `metric-card-${metric.usageStatus}` : ""} ${metric.onClick ? "metric-card-clickable" : ""}`}
                    key={metric.label}
                    role={metric.onClick ? "button" : undefined}
                    tabIndex={metric.onClick ? 0 : undefined}
                    onClick={metric.onClick}
                    onKeyDown={(event) => {
                      if (!metric.onClick) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        metric.onClick();
                      }
                    }}
                  >
                    <div className="metric-card__top">
                      <span>{metric.label}</span>
                      <div className="metric-card__actions">
                        {metric.statusLabel && (
                          <span className={`metric-status metric-status-${metric.usageStatus}`}>
                            {metric.statusLabel}
                          </span>
                        )}
                        <button type="button" className={metricNeedsHelp(metric.value) ? "metric-help needs-attention" : "metric-help"} aria-label={`Hilfe zu ${metric.label}`}>
                          ?
                        </button>
                      </div>
                      <div className="metric-tooltip" role="tooltip">
                        {metric.help}
                      </div>
                    </div>
                    <strong>{metric.value}</strong>
                    <em>{metric.hint}</em>
                    {metric.sparkline && (
                      <div className="metric-chart" aria-label={metric.sparklineLabel}>
                        <div className="metric-chart__axis">
                          <span>{metric.axisTop}</span>
                          <span>{metric.axisBottom}</span>
                        </div>
                        <div className="metric-chart__body">
                          <svg className="metric-sparkline" viewBox="0 0 120 34" preserveAspectRatio="none" role="img" aria-label={metric.sparklineLabel}>
                            <line x1="0" y1="0" x2="120" y2="0" />
                            <line x1="0" y1="34" x2="120" y2="34" />
                            <polyline points={metric.sparkline} />
                          </svg>
                          {metric.timeLabels && (
                            <div className="metric-chart__time">
                              <span>{metric.timeLabels.start}</span>
                              <span>{metric.timeLabels.duration}</span>
                              <span>{metric.timeLabels.end}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                        ))}
                      </div>
                    </section>
                  ));
                  })()}
                </div>
              )}
            </div>
          )}

          <section className="result-filters" aria-labelledby="result-filter-title">
            <div className="result-filters__header">
              <div>
                <p className="eyebrow">Prüfergebnisse</p>
                <h3 id="result-filter-title">Statusfilter</h3>
              </div>
              <span>{selectedStatusFilter ? `${statusLabel[selectedStatusFilter]} ausgewählt` : "Karten klicken, um die Liste zu filtern"}</span>
            </div>
            <div className={`summary-grid ${selectedStatusFilter ? "has-filter" : ""}`}>
              {statusOrder.map((status) => {
                const isActive = selectedStatusFilter === status;
                return (
                  <button
                    type="button"
                    className={`summary-card status-${status} ${isActive ? "is-active" : ""}`}
                    key={status}
                    onClick={() => {
                      setSelectedStatusFilter((current) => current === status ? null : status);
                      if (status === "ok") setShowHealthyChecks(true);
                      const firstMatchingCheck = displayedAnalysis?.checks.find((check) => check.status === status);
                      if (firstMatchingCheck) {
                        setActiveCheck(firstMatchingCheck.id);
                      }
                    }}
                    aria-pressed={isActive}
                    title={`${summary[status]} Prüfpunkte mit Status „${statusLabel[status]}“ anzeigen`}
                  >
                    <div className="summary-card-header">
                      <strong>{summary[status]}</strong>
                      {getStatusIcon(status, "summary-icon")}
                    </div>
                    <span>{statusLabel[status]}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="analysis-detail-toggle">
            <div>
              <strong>{showHealthyChecks ? "Alle Prüfpunkte sichtbar" : "Fokus auf Handlungsbedarf"}</strong>
              <span>
                {showHealthyChecks
                  ? "Auch unauffällige Detailprüfungen wie Batterien und Firmware werden angezeigt."
                  : `${healthyCheckCount} unauffällige Detailprüfungen sind eingeklappt. Hinweise und Probleme bleiben sichtbar.`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedStatusFilter(null);
                setShowHealthyChecks((current) => !current);
              }}
            >
              {showHealthyChecks ? "Unauffällige ausblenden" : `${healthyCheckCount} unauffällige anzeigen`}
            </button>
          </div>

          <div className="check-layout">
            <div className="check-list">
              {groupedChecks.map((group) => {
                const items = group.checks.map((check) => (
                  <button
                    type="button"
                    className={`check-item status-${check.status} ${activeCheck === check.id ? "is-active" : ""}`}
                    onClick={() => setActiveCheck(check.id)}
                    key={check.id}
                  >
                    <div className="check-item-head">
                      {getStatusIcon(check.status, "check-item-icon")}
                      <span>{check.title}</span>
                    </div>
                    <small>{check.category}</small>
                  </button>
                ));
                const containsActiveCheck = group.checks.some((check) => check.id === activeCheck);
                return (
                  <details
                    key={`${analysis.generatedAt}-${selectedStatusFilter ?? "all"}-${group.id}`}
                    className={`check-theme status-${group.highestStatus}`}
                    open={Boolean(selectedStatusFilter) || expandedCheckThemes.has(group.id) || containsActiveCheck}
                    onToggle={(event) => {
                      if (selectedStatusFilter) return;
                      const isOpen = event.currentTarget.open;
                      setExpandedCheckThemes((current) => {
                        const next = new Set(current);
                        if (isOpen) next.add(group.id);
                        else next.delete(group.id);
                        return next;
                      });
                    }}
                  >
                    <summary>
                      <div className="check-theme__title">
                        <span className={`check-theme__status status-${group.highestStatus}`}>
                          {getStatusIcon(group.highestStatus, "check-theme__icon")}
                        </span>
                        <div>
                          <strong>{group.title}</strong>
                          <small>{group.description}</small>
                        </div>
                      </div>
                      <div className="check-theme__summary">
                        {statusOrder.map((status) => group.counts[status] > 0 && (
                          <span className={`check-theme__count status-${status}`} key={status}>
                            {group.counts[status]} {statusLabel[status]}
                          </span>
                        ))}
                        <span className="check-theme__total">
                          {selectedStatusFilter ? `${group.checks.length} gefiltert` : `${group.total} Punkte`}
                        </span>
                      </div>
                    </summary>
                    <div className="check-theme__items">
                      {items}
                    </div>
                  </details>
                );
              })}
            </div>

            <div className="check-detail">
              {displayedAnalysis?.checks
                .filter((check) => check.id === activeCheck)
                .map((check) => {
                  const relatedTheme = checkThemes.find((theme) => (theme.checkIds as readonly string[]).includes(check.id));
                  const relatedChecks = relatedTheme
                    ? relatedTheme.checkIds
                      .filter((checkId) => checkId !== check.id)
                      .map((checkId) => displayedAnalysis.checks.find((item) => item.id === checkId))
                      .filter((item): item is AnalysisCheck => Boolean(item))
                    : [];
                  return (
                  <article key={check.id}>
                    <div className="detail-title">
                      <span className={`pill status-${check.status}`}>
                        {getStatusIcon(check.status, "status-icon-inline")}
                        {statusLabel[check.status]}
                      </span>
                      <h3>{check.title}</h3>
                    </div>
                    <p className="lead">{check.summary}</p>
                    {relatedTheme?.id === "foundation" && (
                      <div className="foundation-chain" aria-label="Prüfkette der CCU-Datenbasis">
                        {relatedTheme.checkIds.map((checkId, index) => {
                          const foundationCheck = displayedAnalysis.checks.find((item) => item.id === checkId);
                          if (!foundationCheck) return null;
                          return (
                            <button
                              type="button"
                              className={`status-${foundationCheck.status} ${foundationCheck.id === check.id ? "is-active" : ""}`}
                              key={foundationCheck.id}
                              onClick={() => setActiveCheck(foundationCheck.id)}
                            >
                              <span>{index + 1}</span>
                              <div>
                                <strong>{foundationCheck.title}</strong>
                                <small>{statusLabel[foundationCheck.status]}</small>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {relatedChecks.length > 0 && (
                      <nav className="related-checks" aria-label={`Verwandte Prüfpunkte zu ${check.title}`}>
                        <span>Gehört zusammen mit</span>
                        <div>
                          {relatedChecks.map((relatedCheck) => (
                            <button
                              type="button"
                              className={`status-${relatedCheck.status}`}
                              key={relatedCheck.id}
                              onClick={() => setActiveCheck(relatedCheck.id)}
                            >
                              {getStatusIcon(relatedCheck.status, "related-check-icon")}
                              {relatedCheck.title}
                            </button>
                          ))}
                        </div>
                      </nav>
                    )}
                    <div className="check-context-actions">
                      {["ccu-connection", "xml-api", "ccu-masterdata", "system-health"].includes(check.id) && (
                        <button type="button" onClick={() => setCurrentPage("setup")}>Setup öffnen</button>
                      )}
                      {["system-health", "logs", "external-access"].includes(check.id) && (
                        <button type="button" onClick={() => openActionModal("collector")}>Collector-Script anzeigen</button>
                      )}
                      {["duty-cycle", "signal-strength"].includes(check.id) && form.snifferEnabled && analysisSnifferMode === "with-sniffer" && (
                        <button type="button" onClick={() => setCurrentPage("dc")}>DC-Analyzer öffnen</button>
                      )}
                      {check.id === "signal-strength" && (
                        <button type="button" onClick={() => openSignalImprovement()}>Empfang verbessern</button>
                      )}
                      {check.id === "routing-topology" && (
                        <button type="button" onClick={() => void openRoutingGraphic(false)}>Routing-Grafik öffnen</button>
                      )}
                      {check.id === "logs" && (
                        <button type="button" onClick={() => setCurrentPage("logs")}>Logs und KI-Auswertung öffnen</button>
                      )}
                      {check.id === "notifications" && (
                        <button type="button" onClick={() => setCurrentPage("settings")}>Benachrichtigungen einstellen</button>
                      )}
                    </div>

                    {check.id === "routing-topology" && (
                      <RoutingTopologyView
                        topology={routingTopology}
                        loading={routingTopologyLoading}
                        selectedNodeId={selectedRoutingNodeId}
                        onSelectNode={setSelectedRoutingNodeId}
                        onRefresh={() => void loadRoutingTopology(true)}
                      />
                    )}
                    
                    <div className={`recommendation-banner status-${check.status}`}>
                      <div className="banner-icon">
                        {getStatusIcon(check.status, "banner-svg")}
                      </div>
                      <div className="banner-content">
                        <strong>Handlungsempfehlung</strong>
                        <p>{check.recommendation}</p>
                      </div>
                    </div>
                    <h4>Belege</h4>
                    {check.evidence.length > 0 ? (
                      <ul className="evidence">
                        {check.evidence.map((item, index) => (
                          <li key={`${item.source}-${index}`}>
                            <strong><SourceBadge source={item.source} />{item.source}</strong>
                            <EvidenceDetail item={item} />
                            {check.id === "signal-strength" && (() => {
                              const comparison = parseRssiComparison(item.detail) ?? parseCentralRssi(item.detail);
                              return comparison?.name ? (
                                <button type="button" className="evidence-action" onClick={() => openSignalImprovement(comparison.name)}>
                                  Empfang verbessern
                                </button>
                              ) : null;
                            })()}
                            {item.url && (
                              <a href={item.url} target="_blank" rel="noreferrer">
                                Anleitung öffnen
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">
                        {check.status === "unavailable"
                          ? "Für diesen Punkt fehlt aktuell eine passende Datenquelle. Deshalb wird hier kein Fehler behauptet."
                          : check.status === "ok"
                            ? "Keine auffälligen Belege gefunden."
                            : "Noch kein Beleg verfügbar. Deshalb wird hier kein Fehler behauptet."}
                      </p>
                    )}
                    <h4>Details</h4>
                    <ul>
                      {check.details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  </article>
                  );
                })}
            </div>
          </div>
        </section>
      )}
        </>
      )}

      {currentPage === "settings" && (
        <section className="panel settings-page">
          <div className="panel__header">
            <p className="eyebrow">Einstellungen</p>
            <h2>Optionale Funktionen</h2>
            <p>Aktiviere nur die Funktionen, die du wirklich nutzen möchtest. Benachrichtigungen, KI und HmIP-Routing bleiben sonst vollständig außen vor.</p>
            <p className="setup-note">Secrets werden lokal verschlüsselt gespeichert. Die App bleibt trotzdem für Heimnetz oder VPN gedacht und sollte nicht öffentlich ins Internet gestellt werden.</p>
            <div className="script-actions">
              <button type="button" onClick={() => void saveNotificationSettings()} disabled={savingSettings}>
                {savingSettings ? "Speichert ..." : "Einstellungen speichern"}
              </button>
              <button type="button" className="light-button" onClick={resetNotificationSettings}>
                Zurücksetzen
              </button>
            </div>
          </div>

          <div className="settings-grid">
            <details className="setup-card settings-block sniffer-settings" open>
              <summary>
                <span>AskSin-Sniffer</span>
                <small>{form.snifferEnabled ? "Aktiv · zusätzliche Funkdetails" : "Aus · Basisanalyse ohne Zusatzhardware"}</small>
              </summary>
              <div className="settings-block__body">
                <label className="toggle sniffer-master-toggle">
                  <input
                    type="checkbox"
                    checked={form.snifferEnabled}
                    onChange={(event) => updateForm({ ...form, snifferEnabled: event.target.checked })}
                  />
                  <span>Sniffer-Funktionen aktivieren</span>
                </label>
                <div className="sniffer-feature-comparison">
                  <div>
                    <strong>Ohne Sniffer – für die meisten Nutzer</strong>
                    <span>Geräte, Meldungen, Batterien, Erreichbarkeit, Konfiguration, CCU-Duty-Cycle, Zentralen-RSSI und Topologie.</span>
                  </div>
                  <div>
                    <strong>Zusätzlich mit Sniffer</strong>
                    <span>Telegramme, Funkzeit je Gerät, Rauschpegel/Carrier Sense und RSSI am Standort des Sniffers.</span>
                  </div>
                </div>
                <p className="setup-note">
                  Beim Ausschalten bleiben Port und bisherige Einrichtung gespeichert. Du kannst einen defekten oder vorübergehend entfernten Sniffer später einfach wieder aktivieren.
                </p>
              </div>
            </details>

            <details className="setup-card settings-block routing-settings" open>
              <summary>
                <span>HmIP-Routing-Analyse</span>
                <small>{form.hmipRoutingEnabled ? "Aktiv · Einrichtung prüfen" : "Optional · ausgeschaltet"}</small>
              </summary>
              <div className="settings-block__body">
                <label className="toggle routing-master-toggle">
                  <input
                    type="checkbox"
                    checked={form.hmipRoutingEnabled}
                    onChange={(event) => updateForm({ ...form, hmipRoutingEnabled: event.target.checked })}
                  />
                  <span>HmIP-Routing analysieren</span>
                </label>

                {!form.hmipRoutingEnabled ? (
                  <div className="routing-disabled-note">
                    <strong>Der Routing-Prüfpunkt ist ausgeblendet.</strong>
                    <span>Aktiviere ihn nur, wenn du Router, Routing-Aktivität und später echte Verbindungswege untersuchen möchtest.</span>
                  </div>
                ) : (
                  <div className="routing-guide">
                    <div className="routing-guide__intro">
                      <div>
                        <strong>Einmal einrichten, danach direkt zur Grafik</strong>
                        <span>Arbeite die Schritte von oben nach unten ab. Sobald der letzte Haken automatisch grün wird, öffnet der Abschlussbutton die fertige Routing-Karte.</span>
                      </div>
                      <span className={`routing-readiness ${routingStatus?.hmipLogReceived ? "is-ready" : ""}`}>
                        {routingStatus?.hmipLogReceived ? "Empfang bereit" : "Noch nicht vollständig"}
                      </span>
                    </div>

                    <ol className="routing-checklist">
                      <li className="is-complete">
                        <input type="checkbox" checked readOnly aria-label="Routing-Analyse aktiviert" />
                        <div>
                          <strong>Routing-Analyse aktiviert</strong>
                          <span>Der Prüfpunkt erscheint ab der nächsten Analyse.</span>
                        </div>
                      </li>
                      <li className={form.hmipRoutingLogLevelSet ? "is-complete" : ""}>
                        <input
                          type="checkbox"
                          checked={form.hmipRoutingLogLevelSet}
                          onChange={(event) => updateForm({ ...form, hmipRoutingLogLevelSet: event.target.checked })}
                          aria-label="Homematic IP auf Alles loggen gestellt"
                        />
                        <div>
                          <strong>Homematic IP auf „Alles loggen“ stellen</strong>
                          <span>
                            In der CCU WebUI unter Einstellungen → Systemsteuerung → Zentralen-Wartung → Fehlerprotokoll.
                            {ccuUiUrl && <> <a href={ccuUiUrl} target="_blank" rel="noreferrer">CCU WebUI öffnen</a></>}
                          </span>
                          <figure className="routing-help-image">
                            <a href="/docs/hmip-routing-loglevel.png" target="_blank" rel="noreferrer">
                              <img src="/docs/hmip-routing-loglevel.png" alt="OpenCCU Zentralen-Wartung mit Fehlerprotokoll und Auswahl Alles loggen für Homematic IP" />
                            </a>
                            <figcaption>Bei „Homematic IP“ → „Alles loggen“ auswählen und „Einstellungen übernehmen“ klicken.</figcaption>
                          </figure>
                        </div>
                      </li>
                      <li className={form.hmipRoutingRestarted ? "is-complete" : ""}>
                        <input
                          type="checkbox"
                          checked={form.hmipRoutingRestarted}
                          onChange={(event) => updateForm({ ...form, hmipRoutingRestarted: event.target.checked })}
                          aria-label="Zentrale nach Änderung neu gestartet"
                        />
                        <div>
                          <strong>Zentrale danach neu starten</strong>
                          <span>Die Änderung des HmIPServer-Loglevels wird erst nach dem Neustart zuverlässig aktiv.</span>
                        </div>
                      </li>
                      <li className={routingStatus?.collectorState === "fresh" ? "is-complete" : ""}>
                        <input type="checkbox" checked={routingStatus?.collectorState === "fresh"} readOnly aria-label="Collector sendet aktuell" />
                        <div>
                          <strong>Aktuellen Collector auf der CCU ausführen</strong>
                          <span>
                            {routingStatus?.collectorState === "fresh"
                              ? `Letzte Daten: ${routingStatus.collectedAt ? new Date(routingStatus.collectedAt).toLocaleString("de-DE") : "soeben"}.`
                              : "Der Collector muss auch /var/log/hmserver.log übertragen. Kopiere den Befehl per SSH auf die CCU."}
                          </span>
                          {routingStatus?.collectorState !== "fresh" && (
                            <div className="routing-command">
                              <code>{recommendedCollectorCommand}</code>
                              <button type="button" onClick={() => void copyText(recommendedCollectorCommand)}>Kopieren</button>
                            </div>
                          )}
                        </div>
                      </li>
                      <li className={routingStatus?.hmipLogReceived ? "is-complete is-automatic" : "is-automatic"}>
                        <input type="checkbox" checked={Boolean(routingStatus?.hmipLogReceived)} readOnly aria-label="HmIPServer-Log wird empfangen" />
                        <div>
                          <strong>HmIPServer-Daten werden empfangen</strong>
                          <span>
                            {routingStatus?.hmipLogReceived
                              ? `${routingStatus.hmipLogLines} aktuelle Logzeilen von ${routingStatus.host ?? "der CCU"} erkannt.`
                              : "Dieser Haken wird automatisch gesetzt, sobald nach dem Neustart passende Daten eintreffen."}
                          </span>
                        </div>
                      </li>
                    </ol>

                    <div className={`routing-finish ${routingStatus?.hmipLogReceived ? "is-ready" : ""}`}>
                      <div>
                        <strong>{routingStatus?.hmipLogReceived ? "Einrichtung abgeschlossen" : "Letzter Schritt: Empfang bestätigen"}</strong>
                        <span>
                          {routingStatus?.hmipLogReceived
                            ? "Die Routing-Daten kommen an. Öffne jetzt direkt die grafische Topologie."
                            : "Prüfe den Empfang. Sobald HmIPServer-Daten erkannt werden, wird die Routing-Grafik freigeschaltet."}
                        </span>
                      </div>
                      <div className="routing-actions">
                        <button type="button" className="light-button" onClick={() => void loadRoutingStatus(true)} disabled={routingStatusLoading}>
                          {routingStatusLoading ? "Empfang wird geprüft …" : "Empfang erneut prüfen"}
                        </button>
                        <button
                          type="button"
                          className="routing-result-button"
                          onClick={() => void openRoutingGraphic(true)}
                          disabled={!routingStatus?.hmipLogReceived || loading}
                        >
                          {loading ? "Analyse läuft …" : "Routing-Grafik öffnen"}
                        </button>
                      </div>
                    </div>

                    {routingStatus?.sample.length ? (
                      <details className="routing-log-sample">
                        <summary>Empfangene HmIPServer-Zeilen ansehen</summary>
                        <pre>{routingStatus.sample.join("\n")}</pre>
                      </details>
                    ) : null}

                    <p className="routing-warning">
                      Nach erfolgreicher Datenerfassung „Homematic IP“ wieder auf „Nur Fehler protokollieren“ oder den vorherigen Wert stellen. „Alles loggen“ erzeugt deutlich mehr Logdaten.
                    </p>

                    <details className="routing-remove">
                      <summary>Collector später rückstandslos entfernen</summary>
                      <p>Der Befehl entfernt nur den vom Analyzer markierten Cronjob und seine temporären Dateien. Andere CCU-Cronjobs, Backups und Systemdateien bleiben unberührt.</p>
                      <div className="routing-command">
                        <code>{collectorUninstallCommand}</code>
                        <button type="button" onClick={() => void copyText(collectorUninstallCommand)}>Kopieren</button>
                      </div>
                    </details>
                  </div>
                )}
              </div>
            </details>

            <details className="setup-card settings-block" open>
              <summary><span>Telegram</span><small>Bot und Chat-ID</small></summary>
              <div className="settings-block__body">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={notificationSettings.telegram.enabled}
                  onChange={(event) => updateNotificationSettings({
                    ...notificationSettings,
                    telegram: { ...notificationSettings.telegram, enabled: event.target.checked }
                  })}
                />
                <span>Telegram aktivieren</span>
              </label>

              <details className="inline-help" style={{ marginBottom: "16px" }}>
                <summary>Anleitung: Telegram-Bot erstellen</summary>
                <ol>
                  <li>Öffne den <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> in Telegram und sende <code>/newbot</code>.</li>
                  <li>Wähle einen Namen und einen eindeutigen Benutzernamen für deinen Bot.</li>
                  <li>Kopiere das generierte <strong>HTTP API Token</strong> (Bot Token) in das Feld unten.</li>
                  <li>Sende eine beliebige Nachricht (oder <code>/start</code>) an deinen Bot, um den Chat zu aktivieren.</li>
                  <li>Öffne den <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer">@userinfobot</a> in Telegram, um deine persönliche <strong>Chat ID</strong> zu ermitteln.</li>
                  <li>Trage beide Werte ein und klicke auf „Telegram testen“.</li>
                </ol>
              </details>

              <div className="form-grid form-grid-2">
                <label>
                  Bot Token
                  <span className="secret-field">
                    <input
                      type={visibleSecrets.telegramBotToken ? "text" : "password"}
                      value={notificationSettings.telegram.botToken}
                      onChange={(event) => updateNotificationSettings({
                        ...notificationSettings,
                        telegram: { ...notificationSettings.telegram, botToken: event.target.value }
                      })}
                      placeholder="123456:ABC..."
                      autoComplete="off"
                    />
                    <button type="button" onClick={() => toggleSecret("telegramBotToken")} aria-label={visibleSecrets.telegramBotToken ? "Telegram Bot Token ausblenden" : "Telegram Bot Token anzeigen"}>
                      {getSecretIcon(Boolean(visibleSecrets.telegramBotToken))}
                    </button>
                  </span>
                </label>
                <label>
                  Chat ID
                  <input
                    value={notificationSettings.telegram.chatId}
                    onChange={(event) => updateNotificationSettings({
                      ...notificationSettings,
                      telegram: { ...notificationSettings.telegram, chatId: event.target.value }
                    })}
                    placeholder="123456789"
                    autoComplete="off"
                  />
                </label>
              </div>
              <div className="script-actions">
                <button type="button" onClick={() => void testNotificationChannel("telegram")}>
                  Telegram testen
                </button>
              </div>
              </div>
            </details>

            <details className="setup-card settings-block">
              <summary><span>E-Mail SMTP</span><small>Mailserver optional</small></summary>
              <div className="settings-block__body">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={notificationSettings.email.enabled}
                  onChange={(event) => updateNotificationSettings({
                    ...notificationSettings,
                    email: { ...notificationSettings.email, enabled: event.target.checked }
                  })}
                />
                <span>E-Mail aktivieren</span>
              </label>
              <div className="form-grid form-grid-3">
                <label>
                  SMTP Host
                  <input
                    value={notificationSettings.email.host}
                    onChange={(event) => updateNotificationSettings({
                      ...notificationSettings,
                      email: { ...notificationSettings.email, host: event.target.value }
                    })}
                    placeholder="smtp.example.com"
                  />
                </label>
                <label>
                  Port
                  <input
                    type="number"
                    value={notificationSettings.email.port}
                    onChange={(event) => updateNotificationSettings({
                      ...notificationSettings,
                      email: { ...notificationSettings.email, port: Number(event.target.value) || 587 }
                    })}
                    placeholder="587"
                  />
                </label>
                <label className="toggle toggle-inline">
                  <input
                    type="checkbox"
                    checked={notificationSettings.email.secure}
                    onChange={(event) => updateNotificationSettings({
                      ...notificationSettings,
                      email: { ...notificationSettings.email, secure: event.target.checked }
                    })}
                  />
                  <span>SSL/TLS direkt nutzen</span>
                </label>
              </div>
              <div className="form-grid form-grid-2">
                <label>
                  SMTP Benutzer
                  <input
                    value={notificationSettings.email.user}
                    onChange={(event) => updateNotificationSettings({
                      ...notificationSettings,
                      email: { ...notificationSettings.email, user: event.target.value }
                    })}
                    autoComplete="username"
                  />
                </label>
                <label>
                  SMTP Passwort
                  <span className="secret-field">
                    <input
                      type={visibleSecrets.smtpPassword ? "text" : "password"}
                      value={notificationSettings.email.password}
                      onChange={(event) => updateNotificationSettings({
                        ...notificationSettings,
                        email: { ...notificationSettings.email, password: event.target.value }
                      })}
                      autoComplete="current-password"
                    />
                    <button type="button" onClick={() => toggleSecret("smtpPassword")} aria-label={visibleSecrets.smtpPassword ? "SMTP Passwort ausblenden" : "SMTP Passwort anzeigen"}>
                      {getSecretIcon(Boolean(visibleSecrets.smtpPassword))}
                    </button>
                  </span>
                </label>
              </div>
              <div className="form-grid form-grid-2">
                <label>
                  Absender
                  <input
                    value={notificationSettings.email.from}
                    onChange={(event) => updateNotificationSettings({
                      ...notificationSettings,
                      email: { ...notificationSettings.email, from: event.target.value }
                    })}
                    placeholder="homematic@example.com"
                  />
                </label>
                <label>
                  Empfänger
                  <input
                    value={notificationSettings.email.to}
                    onChange={(event) => updateNotificationSettings({
                      ...notificationSettings,
                      email: { ...notificationSettings.email, to: event.target.value }
                    })}
                    placeholder="du@example.com"
                  />
                </label>
              </div>
              <div className="script-actions">
                <button type="button" onClick={() => void testNotificationChannel("email")}>
                  E-Mail testen
                </button>
              </div>
              </div>
            </details>

            <details className="setup-card settings-block">
              <summary><span>KI-Logauswertung</span><small>OpenAI oder Gemini</small></summary>
              <div className="settings-block__body">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={notificationSettings.ai.enabled}
                  onChange={(event) => updateNotificationSettings({
                    ...notificationSettings,
                    ai: { ...notificationSettings.ai, enabled: event.target.checked }
                  })}
                />
                <span>Logs optional per KI verständlich auswerten</span>
              </label>
              <p className="setup-note">
                Aktuell werden nur Logzeilen an den gewählten Anbieter gesendet. CCU-, SSH-, Telegram- und SMTP-Zugangsdaten werden nicht an die KI übertragen.
              </p>
              <div className="form-grid form-grid-3">
                <label>
                  Anbieter
                  <select
                    value={notificationSettings.ai.provider}
                    onChange={(event) => updateNotificationSettings({
                      ...notificationSettings,
                      ai: { ...notificationSettings.ai, provider: event.target.value as NotificationSettings["ai"]["provider"] }
                    })}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="gemini">Google Gemini</option>
                  </select>
                </label>
                <label>
                  OpenAI Modell
                  <input
                    value={notificationSettings.ai.openaiModel}
                    onChange={(event) => updateNotificationSettings({
                      ...notificationSettings,
                      ai: { ...notificationSettings.ai, openaiModel: event.target.value }
                    })}
                    placeholder="gpt-4o-mini"
                  />
                </label>
                <label>
                  Gemini Modell
                  <input
                    value={notificationSettings.ai.geminiModel}
                    onChange={(event) => updateNotificationSettings({
                      ...notificationSettings,
                      ai: { ...notificationSettings.ai, geminiModel: event.target.value }
                    })}
                    placeholder="gemini-1.5-flash"
                  />
                </label>
              </div>
              <div className="form-grid form-grid-2">
                <label>
                  OpenAI API Key
                  <span className="secret-field">
                    <input
                      type={visibleSecrets.openAiApiKey ? "text" : "password"}
                      value={notificationSettings.ai.openaiApiKey}
                      onChange={(event) => updateNotificationSettings({
                        ...notificationSettings,
                        ai: { ...notificationSettings.ai, openaiApiKey: event.target.value }
                      })}
                      placeholder="sk-..."
                      autoComplete="off"
                    />
                    <button type="button" onClick={() => toggleSecret("openAiApiKey")} aria-label={visibleSecrets.openAiApiKey ? "OpenAI API Key ausblenden" : "OpenAI API Key anzeigen"}>
                      {getSecretIcon(Boolean(visibleSecrets.openAiApiKey))}
                    </button>
                  </span>
                </label>
                <label>
                  Gemini API Key
                  <span className="secret-field">
                    <input
                      type={visibleSecrets.geminiApiKey ? "text" : "password"}
                      value={notificationSettings.ai.geminiApiKey}
                      onChange={(event) => updateNotificationSettings({
                        ...notificationSettings,
                        ai: { ...notificationSettings.ai, geminiApiKey: event.target.value }
                      })}
                      placeholder="AIza..."
                      autoComplete="off"
                    />
                    <button type="button" onClick={() => toggleSecret("geminiApiKey")} aria-label={visibleSecrets.geminiApiKey ? "Gemini API Key ausblenden" : "Gemini API Key anzeigen"}>
                      {getSecretIcon(Boolean(visibleSecrets.geminiApiKey))}
                    </button>
                  </span>
                </label>
              </div>
              <p className="muted">Meine Empfehlung: Erst nur Logs per KI erklären lassen. Geräte-, Routing- und Firmware-Bewertungen bleiben deterministisch und belegbasiert.</p>
              </div>
            </details>

            <details className="setup-card settings-block" open>
              <summary><span>Wann benachrichtigen?</span><small>Events auswählen</small></summary>
              <div className="settings-block__body">
              <div className="event-grid">
                {[
                  ["critical", "Kritische Punkte"],
                  ["warning", "Warnungen"],
                  ["dutyCycle", "Duty Cycle kritisch/hoch"],
                  ["battery", "Batterie niedrig"],
                  ["unreachable", "Gerät nicht erreichbar"],
                  ["configPending", "Konfiguration ausstehend"],
                  ["externalAccess", "Externe CCU-Zugriffe"],
                  ["sniffer", "Sniffer getrennt"],
                  ["releases", "Neue Zentralen-Releases"]
                ].map(([key, label]) => (
                  <label className="toggle event-toggle" key={key}>
                    <input
                      type="checkbox"
                      checked={Boolean(notificationSettings.events[key as keyof NotificationSettings["events"]])}
                      onChange={(event) => updateNotificationSettings({
                        ...notificationSettings,
                        events: { ...notificationSettings.events, [key]: event.target.checked }
                      })}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <p className="muted">Neue Releases werden als eigener Hinweis verarbeitet, sobald der Release-Check ein Update belegt.</p>
              </div>
            </details>

            <details className="setup-card settings-block security-settings" open>
              <summary><span>Sicherung & Datenschutz</span><small>Verschlüsselte Konfiguration</small></summary>
              <div className="settings-block__body">
                <p>
                  Passwörter, XML-API-Token und API-Keys werden serverseitig AES-256-GCM-verschlüsselt gespeichert.
                  Im Browser bleiben diese Werte nicht mehr dauerhaft im Klartext.
                </p>
                <label>
                  Passwort für Backup oder Wiederherstellung
                  <span className="secret-field">
                    <input
                      type={visibleSecrets.configurationPassphrase ? "text" : "password"}
                      value={configurationPassphrase}
                      onChange={(event) => setConfigurationPassphrase(event.target.value)}
                      placeholder="Mindestens 8 Zeichen"
                      autoComplete="new-password"
                    />
                    <button type="button" onClick={() => toggleSecret("configurationPassphrase")} aria-label={visibleSecrets.configurationPassphrase ? "Backup-Passwort ausblenden" : "Backup-Passwort anzeigen"}>
                      {getSecretIcon(Boolean(visibleSecrets.configurationPassphrase))}
                    </button>
                  </span>
                </label>
                <div className="configuration-backup-actions">
                  <button type="button" onClick={() => void exportConfigurationBackup()} disabled={configurationBusy}>
                    {configurationBusy ? "Bitte warten …" : "Konfiguration sichern"}
                  </button>
                  <label className="light-button file-button">
                    Backup wiederherstellen
                    <input
                      type="file"
                      accept="application/json,.json"
                      disabled={configurationBusy}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void restoreConfigurationBackup(file);
                        event.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <p className="muted">
                  Das portable Backup enthält Setup und Benachrichtigungseinstellungen einschließlich Secrets – ausschließlich verschlüsselt mit deinem Backup-Passwort.
                  Messwerte, Logs und Analysehistorie werden nicht exportiert.
                </p>
              </div>
            </details>
          </div>
        </section>
      )}

      {showUpdateConfirm && (
        <div className="confirm-backdrop" role="presentation" onMouseDown={() => setShowUpdateConfirm(false)}>
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="update-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="eyebrow">Update bestätigen</p>
            <h2 id="update-confirm-title">Analyzer jetzt aktualisieren?</h2>
            <p>
              Die App lädt die neueste Version von GitHub, installiert Abhängigkeiten, baut neu und startet danach kurz neu.
              Währenddessen kann die Oberfläche für einen Moment nicht erreichbar sein.
            </p>
            <div className="confirm-dialog__actions">
              <button type="button" className="ghost-button" onClick={() => setShowUpdateConfirm(false)}>
                Abbrechen
              </button>
              <button type="button" className="primary-button" onClick={() => void runAppUpdate()} disabled={isUpdateRunning}>
                {isUpdateRunning ? "Update läuft …" : "OK, Update starten"}
              </button>
            </div>
          </section>
        </div>
      )}

      {actionModal && (
        <div className="confirm-backdrop" role="presentation" onMouseDown={closeActionModal}>
          <section className="confirm-dialog action-modal" role="dialog" aria-modal="true" aria-labelledby="action-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            {actionModal === "collector" && (
              <>
                <p className="eyebrow">Collector verwalten</p>
                <h2 id="action-modal-title">
                  {collectorStatus?.state === "stale"
                    ? "Der Collector war eingerichtet, sendet aber nicht mehr"
                    : collectorStatus?.available
                      ? "Collector ist eingerichtet"
                      : "Collector auf der CCU einrichten"}
                </h2>
                <p>
                  {collectorStatus?.state === "stale"
                    ? `Der Analyzer hat den Collector früher erkannt. Der letzte Snapshot kam am ${collectorStatus.collectedAt ? new Date(collectorStatus.collectedAt).toLocaleString("de-DE") : "unbekannten Zeitpunkt"}. Nach einem CCU-Neustart oder Update kann der alte, nicht dauerhaft gespeicherte Cronjob verschwunden sein.`
                    : collectorStatus?.available
                      ? "Der Collector sendet Systemwerte, Backups, Speicherinfos, Verbindungen und — wenn vorhanden — Logzeilen an diesen Analyzer."
                      : "Das Script läuft auf der CCU/RaspberryMatic und sendet Systemwerte, Backups, Verbindungen und Logdaten an diesen Analyzer. Dein PC oder Smartphone spielt dabei keine Rolle."}
                </p>
                <div className="collector-command-panel">
                  <div>
                    <strong>Was möchtest du tun?</strong>
                    <span>
                      {collectorStatus?.available && collectorStatus.state !== "stale"
                        ? `Aktuell empfangen: ${collectorStatus.host ?? "Zentrale"} · ${collectorStatus.collectedAt ? new Date(collectorStatus.collectedAt).toLocaleString("de-DE") : "gerade eben"}`
                        : "Kopiere den Befehl und führe ihn per SSH auf der CCU/RaspberryMatic aus."}
                    </span>
                  </div>
                  <div className="collector-command-options">
                    <label>
                      Ausführung
                      <select value={collectorMode} onChange={(event) => setCollectorMode(event.target.value as typeof collectorMode)}>
                        <option value="once">Einmal jetzt senden</option>
                        <option value="install">Regelmäßig einrichten</option>
                        <option value="uninstall">Regelmäßige Übertragung entfernen</option>
                      </select>
                    </label>
                    <label>
                      Zyklus
                      <select value={collectorInterval} onChange={(event) => setCollectorInterval(event.target.value as typeof collectorInterval)} disabled={collectorMode === "once" || collectorMode === "uninstall"}>
                        <option value="minute">Minütlich für Verlauf</option>
                        <option value="hourly">Stündlich</option>
                        <option value="daily">Täglich nachts</option>
                      </select>
                    </label>
                  </div>
                  <div className="modal-command">
                    <code>{collectorCommand}</code>
                    <button type="button" onClick={() => void copyCollectorCommand()}>Kopieren</button>
                  </div>
                  {collectorCommandPreview && (
                    <label className="script-preview">
                      Shell-Befehl zum manuellen Kopieren
                      <textarea readOnly value={collectorCommandPreview} onFocus={(event) => event.target.select()} />
                    </label>
                  )}
                  <p className="modal-note">
                    Installieren speichert den Cronjob auf OpenCCU/RaspberryMatic dauerhaft unter <code>/usr/local/crontabs/root</code>.
                    Entfernen löscht nur den markierten Homematic-Analyzer-Eintrag.
                  </p>
                </div>
                {collectorStatus?.available && collectorStatus.state !== "stale" ? (
                  <>
                    <p className="modal-note">Wenn Systemwerte sichtbar sind, aber Logzeilen fehlen, prüfe die Logquellen direkt auf der CCU:</p>
                    <ol className="action-modal-steps">
                      <li>Per SSH anmelden: <code>ssh root@{form.ccuHost.trim() || "CCU-IP"}</code></li>
                      <li>Logquellen prüfen: <code>ls -l /var/log/messages /var/log/syslog 2&gt;/dev/null</code></li>
                      <li>Falls vorhanden, einen Auszug testen: <code>tail -n 20 /var/log/messages</code></li>
                    </ol>
                  </>
                ) : (
                  <>
                    <ol className="action-modal-steps">
                      <li>Per SSH anmelden: <code>ssh root@{form.ccuHost.trim() || "CCU-IP"}</code></li>
                      <li>Den Befehl kopieren und im SSH-Fenster einfügen.</li>
                      <li>Nach der Erfolgsmeldung kurz warten; Logs werden automatisch neu geladen.</li>
                    </ol>
                  </>
                )}
              </>
            )}

            {actionModal === "duty" && (
              <>
                <p className="eyebrow">Funklast</p>
                <h2 id="action-modal-title">Welche Geräte senden am meisten?</h2>
                <p>
                  Der CCU-Wert und die Sniffer-Messung sind getrennte Quellen: Das Diagramm zeigt den Anteil an der vom Sniffer
                  gemessenen Funkzeit der letzten 60 Minuten. Es erklärt mögliche Verursacher, teilt den CCU-Duty-Cycle aber nicht mathematisch exakt auf.
                </p>
                {snifferSnapshot?.devices.length ? (() => {
                  const colors = ["#3478f6", "#20a783", "#f59e0b", "#8b5cf6", "#ec4899", "#64748b"];
                  const devices = snifferSnapshot.devices.slice(0, 6);
                  const measuredTotal = devices.reduce((sum, device) => sum + device.dutyShare, 0) || 1;
                  let currentPosition = 0;
                  const gradient = devices.map((device, index) => {
                    const start = currentPosition;
                    currentPosition += (device.dutyShare / measuredTotal) * 100;
                    return `${colors[index]} ${start}% ${Math.min(100, currentPosition)}%`;
                  }).join(", ");
                  return (
                    <div className="action-duty-layout">
                      <div className="action-duty-donut" style={{ background: `conic-gradient(${gradient})` }}>
                        <div><strong>{snifferSnapshot.summary.telegrams}</strong><span>Telegramme</span><small>60 Minuten</small></div>
                      </div>
                      <div className="action-duty-list">
                        {devices.map((device, index) => (
                          <div key={device.address}>
                            <i style={{ background: colors[index] }} />
                            <span><strong>{device.name}</strong><small>{device.telegrams} Telegramme · {device.dutyCycle}% Sniffer-Funkzeit</small></span>
                            <b>{device.dutyShare}%</b>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })() : (
                  <div className="modal-empty">
                    <strong>Noch keine Sniffer-Aufteilung vorhanden</strong>
                    <span>Sniffer mindestens einige Minuten verbunden lassen und anschließend erneut analysieren.</span>
                  </div>
                )}
              </>
            )}

            {actionModal === "signal" && (
              <>
                <p className="eyebrow">Signalqualität</p>
                <h2 id="action-modal-title">Gemessene Geräte und Messqualität</h2>
                <p>
                  Standardmäßig siehst du nur Geräte mit Beobachtungs- oder Handlungsbedarf. Werte mit weniger als 3 Sniffer-Telegrammen bleiben vorläufig und lösen keine harte Fehleraussage aus.
                </p>
                <SignalQualityDeviceList
                  devices={allSignalQualityDevices}
                  source={signalSourceFilter}
                  onSourceChange={setSignalSourceFilter}
                  receiverOptions={signalReceiverOptions}
                  focusDeviceName={signalFocusDeviceName}
                />
              </>
            )}

            {actionModal === "check" && actionModalCheck && (
              <>
                <p className="eyebrow">{actionModalCheck.category}</p>
                <h2 id="action-modal-title">{actionModalCheck.title}</h2>
                <p>{actionModalCheck.summary}</p>
                <div className={`recommendation-banner status-${actionModalCheck.status}`}>
                  <div className="banner-icon">{getStatusIcon(actionModalCheck.status, "banner-svg")}</div>
                  <div className="banner-content">
                    <strong>Empfehlung</strong>
                    <p>{actionModalCheck.recommendation}</p>
                  </div>
                </div>
                <div className="action-evidence-list">
                  {actionModalCheck.evidence.map((item, index) => (
                    <article key={`${item.source}-${index}`}>
                      <strong><SourceBadge source={item.source} />{item.source}</strong>
                      <EvidenceDetail item={item} />
                    </article>
                  ))}
                  {actionModalCheck.evidence.length === 0 && <p className="muted">Noch keine einzelnen Belege vorhanden.</p>}
                </div>
              </>
            )}

            <div className="confirm-dialog__actions">
              {actionModal === "duty" && (
                <button type="button" className="ghost-button" onClick={() => { closeActionModal(); setCurrentPage("dc"); }}>
                  DC-Analyzer öffnen
                </button>
              )}
              {actionModal === "collector" && (
                <button type="button" className="ghost-button" onClick={() => { closeActionModal(); setCurrentPage("logs"); }}>
                  Logseite öffnen
                </button>
              )}
              <button type="button" className="primary-button" onClick={closeActionModal}>Schließen</button>
            </div>
          </section>
        </div>
      )}

      {showBackupModal && (
        <div className="confirm-backdrop" role="presentation" onMouseDown={() => setShowBackupModal(false)}>
          <section className="confirm-dialog backup-modal" role="dialog" aria-modal="true" aria-labelledby="backup-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="eyebrow">Backups</p>
            <h2 id="backup-modal-title">Gefundene CCU-Backups</h2>
            <p>{backupItems.length} Backup-Dateien gefunden. Angezeigt werden maximal {backupPageSize} pro Seite.</p>
            <div className="backup-list">
              {visibleBackupItems.map((backup) => (
                <article className="backup-list-item" key={backup.path}>
                  <strong>{backup.name}</strong>
                  <span>{backup.size || "Größe unbekannt"} · {formatBackupDate(backup.modifiedAt) || backup.modifiedAt || "Zeit unbekannt"}</span>
                  <code>{backup.path}</code>
                </article>
              ))}
              {visibleBackupItems.length === 0 && <p>Keine Backup-Details verfügbar. Bitte Shell-Collector nach dem Update erneut ausführen.</p>}
            </div>
            <div className="confirm-dialog__actions backup-modal__actions">
              <button type="button" className="ghost-button" onClick={() => setBackupPage((page) => Math.max(0, page - 1))} disabled={backupPage === 0}>
                Zurück
              </button>
              <span>Seite {backupPage + 1} von {backupPageCount}</span>
              <button type="button" className="ghost-button" onClick={() => setBackupPage((page) => Math.min(backupPageCount - 1, page + 1))} disabled={backupPage >= backupPageCount - 1}>
                Mehr
              </button>
              <button type="button" className="primary-button" onClick={() => setShowBackupModal(false)}>
                Schließen
              </button>
            </div>
          </section>
        </div>
      )}

      <footer className="app-footer">
        <div>
          <strong>Homematic Analyzer</strong>
          <span>Version {appVersion}</span>
        </div>
        <a href={repositoryUrl} target="_blank" rel="noreferrer">
          GitHub Repository
        </a>
        <a className={`update-badge update-${updateStatus.state}`} href={updateStatus.url} target="_blank" rel="noreferrer">
          <span>{updateStatus.label}</span>
          <small>{updateStatus.detail}</small>
        </a>
        {centralUpdateStatus?.state === "update" && (
          <a className="update-badge update-update" href={centralUpdateStatus.url} target="_blank" rel="noreferrer">
            <span>{centralUpdateStatus.label}</span>
            <small>{centralUpdateStatus.detail}</small>
          </a>
        )}
        {updateStatus.state === "update" && (
          <button type="button" className="footer-update-button" onClick={requestAppUpdate} disabled={isUpdateRunning}>
            {isUpdateRunning ? "Update läuft …" : "Update starten"}
          </button>
        )}
        {updateRunStatus && updateRunStatus.status !== "idle" && (
          <div className={`update-run update-run-${updateRunStatus.status}`}>
            <strong>
              {updateRunStatus.status === "running"
                ? "Update läuft im Hintergrund"
                : updateRunStatus.status === "completed"
                  ? "Update abgeschlossen"
                  : "Update fehlgeschlagen"}
            </strong>
            <span>
              {updateRunStatus.status === "running"
                ? "Bitte warten. GitHub wird geladen, Abhängigkeiten werden installiert und die App wird gebaut."
                : updateRunStatus.status === "completed"
                  ? "Die App wurde aktualisiert. Die Seite lädt automatisch neu; der Button bleibt als Fallback."
                  : updateRunStatus.error ?? "Bitte Log prüfen oder per SSH aktualisieren."}
            </span>
            {updateRunStatus.status === "completed" && (
              <button type="button" className="primary-button" onClick={() => window.location.reload()}>
                Seite neu laden
              </button>
            )}
            {updateRunStatus.log && (
              <details>
                <summary>Update-Log anzeigen</summary>
                <pre>{updateRunStatus.log}</pre>
              </details>
            )}
          </div>
        )}
      </footer>
    </main>
  );
}

export default App;
