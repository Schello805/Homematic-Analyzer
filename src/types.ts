export type CheckStatus = "ok" | "improvement" | "warning" | "critical" | "unavailable";

export type Evidence = {
  source: string;
  detail: string;
  timestamp?: string;
  url?: string;
};

export type AnalysisCheck = {
  id: string;
  title: string;
  category: string;
  status: CheckStatus;
  summary: string;
  recommendation: string;
  evidence: Evidence[];
  details: string[];
};

export type SystemDashboard = {
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
  history?: Array<{ collectedAt: string; cpu?: string; memory?: string; disk?: string; temperature?: string }>;
};

export type BackupItem = {
  name: string;
  path: string;
  size: string;
  modifiedAt: string;
};

export type AnalysisResponse = {
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
    ntfy?: {
      state: "disabled" | "not-configured" | "skipped" | "sent" | "failed";
      message: string;
    };
  };
};

export type AnalysisSnifferMode = "base" | "with-sniffer";
export type SettingsSaveState = "ready" | "pending" | "saving" | "saved" | "failed";
export type AppPage = "analysis" | "dc" | "logs" | "diagnostics" | "setup" | "settings";

export type NotificationMonitorStatus = {
  enabled: boolean;
  intervalSeconds: number;
  running: boolean;
  initialized: boolean;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastNotificationAt?: string;
  lastError?: string;
};

export type DiagnosticSource = {
  id: string;
  label: string;
  status: "ok" | "fresh" | "stale" | "error" | "missing" | "optional";
  detail: string;
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  ageMinutes?: number;
  diagnostics?: Array<{ step: string; status: "ok" | "failed" | "skipped"; detail: string }>;
};

export type DiagnosticsPayload = {
  checkedAt: string;
  sources: DiagnosticSource[];
};

export type AnalysisHistoryPayload = {
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
  changes: Array<{ id: string; title: string; from: CheckStatus; to: CheckStatus }>;
};

export type CcuTestResult = {
  checkedAt: string;
  reachable: boolean;
  webUiReachable?: boolean;
  xmlApiReachable?: boolean;
  authentication?: "ok" | "failed" | "not-tested";
  devices: number;
  centralVersion?: string;
  centralProduct?: string;
  errorCode?: string;
  error?: string;
  diagnostics: Array<{ step: string; status: "ok" | "failed" | "skipped"; detail: string }>;
};

export type SnifferHistoryPayload = {
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

export type UpdateStatus = {
  state: "checking" | "current" | "update" | "unknown";
  label: string;
  detail: string;
  url: string;
};

export type UpdateRunStatus = {
  status: "idle" | "running" | "completed" | "failed";
  running: boolean;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  error?: string;
  log?: string;
};

export type LogPayload = {
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

export type Toast = {
  id: number;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message?: string;
};

export type ActionModal = "collector" | "duty" | "signal" | "check" | null;

export type MasterdataStatus = {
  available: boolean;
  collectedAt?: string;
  receivedAt?: string;
  deviceCount: number;
  systemAvailable?: boolean;
  askSinDevListAvailable?: boolean;
  askSinDevListCount?: number;
};

export type UsbPort = {
  path: string;
  label: string;
  stable: boolean;
  target?: string;
};

export type SnifferSnapshot = {
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
  rssiNoise: Array<{ tstamp: string; raw: string; rssi?: number }>;
  timeline?: Array<{ minute: string; telegrams: number; dutyCycle: number; noiseSamples: number; noiseAverage?: number; noiseMinimum?: number; noiseMaximum?: number }>;
  diagnostics: string[];
};


export type SetupForm = {
  ccuHost: string;
  ccuUser: string;
  ccuPassword: string;
  xmlApiToken?: string | null;
  sshUser: string;
  sshPassword: string;
  snifferEnabled: boolean;
  snifferPort: string;
  hmipRoutingEnabled: boolean;
  hmipRoutingLogLevelSet: boolean;
  hmipRoutingRestarted: boolean;
};

export type SetupDefaults = Partial<Pick<SetupForm, "ccuHost" | "ccuUser" | "ccuPassword" | "xmlApiToken" | "sshUser" | "sshPassword" | "snifferEnabled" | "snifferPort" | "hmipRoutingEnabled" | "hmipRoutingLogLevelSet" | "hmipRoutingRestarted">>;

export type NotificationSettings = {
  telegram: { enabled: boolean; [key: string]: any };
  email: { enabled: boolean; [key: string]: any };
  ntfy: { enabled: boolean; [key: string]: any };
  events: { enabled: boolean; serviceTypes?: string[]; [key: string]: any };
  ai: { enabled: boolean; [key: string]: any };
};

export type CollectorStatus = {
  available: boolean;
  state?: "missing" | "fresh" | "stale";
  ageMinutes?: number;
  collectedAt?: string;
  host?: string;
  logs: number;
  hmipLogs?: number;
  connections: number;
};

export type RoutingStatus = {
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

export type RoutingTopologyNode = {
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

export type RoutingTopology = {
  generatedAt: string;
  collectedAt?: string;
  sourceHost?: string;
  state: "ready" | "partial" | "missing";
  nodes: RoutingTopologyNode[];
  edges: Array<{ id: string; source: string; target: string; kind: "confirmed-route"; evidence: string }>;
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

export type SignalReceiverOption = {
  id: string;
  name: string;
  type?: string;
  protocol: "hmip" | "bidcos";
  role: "gateway" | "router" | "candidate";
  routerEnabled: boolean;
  routingEnabled: boolean;
};
