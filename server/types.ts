export type AccessMode = "ccu" | "ssh" | "sniffer" | "telegram" | "external";

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
  access: AccessMode[];
  evidence: Evidence[];
  details: string[];
};

export type AnalyzeRequest = {
  ccuHost?: string;
  ccuUser?: string;
  ccuPassword?: string;
  xmlApiToken?: string;
  hasCcuPassword?: boolean;
  sshHost?: string;
  sshUser?: string;
  sshPassword?: string;
  hasSshPassword?: boolean;
  snifferEnabled?: boolean;
  snifferPort?: string;
  hmipRoutingEnabled?: boolean;
  telegramEnabled?: boolean;
  externalSystems?: string[];
  notificationSettings?: NotificationSettings;
};

export type NotificationSettings = {
  telegram?: {
    enabled?: boolean;
    botToken?: string;
    chatId?: string;
  };
  email?: {
    enabled?: boolean;
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    password?: string;
    from?: string;
    to?: string;
  };
  events?: {
    critical?: boolean;
    warning?: boolean;
    serviceOverheat?: boolean;
    dutyCycle?: boolean;
    battery?: boolean;
    unreachable?: boolean;
    configPending?: boolean;
    externalAccess?: boolean;
    sniffer?: boolean;
    releases?: boolean;
  };
  ai?: {
    enabled?: boolean;
    provider?: "openai" | "gemini";
    openaiApiKey?: string;
    openaiModel?: string;
    geminiApiKey?: string;
    geminiModel?: string;
  };
};

export type CcuEvidence = {
  source: string;
  detail: string;
  timestamp?: string;
};

export type CcuDevice = {
  name: string;
  address?: string;
  type?: string;
  firmware?: string;
  rssiDevice?: number;
  rssiPeer?: number;
  lowBattery: boolean;
  unreachable: boolean;
  configPending: boolean;
  evidence: CcuEvidence[];
};

export type CcuSnapshot = {
  reachable: boolean;
  xmlApiInstalled: boolean;
  webUiReachable?: boolean;
  xmlApiReachable?: boolean;
  authentication?: "ok" | "failed" | "not-tested";
  errorCode?: "dns" | "timeout" | "connection-refused" | "network" | "tls" | "http" | "xml-api-missing" | "authentication" | "empty-data" | "unknown";
  diagnostics?: Array<{
    step: string;
    status: "ok" | "failed" | "skipped";
    detail: string;
  }>;
  source: "xml-api";
  collectedAt: string;
  error?: string;
  devices: CcuDevice[];
  serviceMessages: CcuEvidence[];
  alarmMessages: CcuEvidence[];
  dutyCycle?: number;
  centralVersion?: string;
  centralProduct?: string;
  counters: {
    devices: number;
    lowBattery: number;
    unreachable: number;
    configPending: number;
    serviceMessages: number;
    alarmMessages: number;
  };
};

export type CollectorPayload = {
  token?: string;
  host?: string;
  collectedAt?: string;
  system?: Record<string, unknown>;
  logs?: string[];
  hmipLogs?: string[];
  hmipRoutingLogs?: string[];
  hmipRoutingConfig?: string[];
  deviceFirmware?: string[];
  radioGateways?: string[];
  network?: {
    connections?: string[];
  };
  backups?: Record<string, unknown>;
};

export type RadioGateway = {
  protocol: "hmip" | "bidcos";
  name: string;
  type?: string;
  serial?: string;
  address?: string;
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

export type RoutingTopologyEdge = {
  id: string;
  source: string;
  target: string;
  kind: "confirmed-route";
  evidence: string;
};

export type RoutingTopology = {
  generatedAt: string;
  collectedAt?: string;
  sourceHost?: string;
  state: "ready" | "partial" | "missing";
  nodes: RoutingTopologyNode[];
  edges: RoutingTopologyEdge[];
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

export type CollectorHistoryPoint = {
  collectedAt: string;
  cpu?: string;
  memory?: string;
  disk?: string;
  temperature?: string;
};

export type CcuMasterdataPayload = {
  token?: string;
  source?: string;
  collectedAt?: string;
  receivedAt?: string;
  deviceCount?: number;
  system?: Record<string, unknown>;
  backups?: Record<string, unknown>;
  devices?: Array<{
    name?: string;
    address?: string;
    type?: string;
    firmware?: string;
    rfAddress?: string | number;
    radioAddress?: string | number;
    serial?: string;
  }>;
  askSinDevList?: {
    created_at?: number;
    devices?: Array<{
      name?: string;
      serial?: string;
      address?: number | string;
    }>;
  };
};

export type SnifferTelegram = {
  tstamp: string;
  raw: string;
  rssi: number;
  len: number;
  cnt: number;
  flags: string[];
  type: string;
  fromAddress: string;
  toAddress: string;
  fromName?: string;
  toName?: string;
  fromSerial?: string;
  toSerial?: string;
  fromType?: string;
  toType?: string;
  dutyCycle: number;
  sendTimeMs: number;
  payload: string;
};

export type SnifferDeviceSummary = {
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
    weakestRssiDevice?: SnifferDeviceSummary;
    gateways?: SnifferDeviceSummary[];
  };
  devices: SnifferDeviceSummary[];
  events: SnifferTelegram[];
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

export type AnalysisHistoryEntry = {
  generatedAt: string;
  summary: Record<CheckStatus, number>;
  checks: Array<{
    id: string;
    title: string;
    status: CheckStatus;
    summary: string;
  }>;
  sources: {
    ccu?: string;
    collector?: string;
    masterdata?: string;
    sniffer?: string;
  };
};

export type SnifferHistoryPoint = {
  collectedAt: string;
  dutyCycle?: number;
  carrierSense?: number;
  carrierSenseAvg?: number;
  telegrams: number;
  devices: number;
  weakestRssi?: number;
};

export type ReleaseCheck = {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  source?: "release" | "tag" | "main";
  url?: string;
  checkedAt: string;
  error?: string;
};

export type CentralReleaseCheck = {
  available: boolean;
  installedVersion?: string;
  latestVersion?: string;
  product?: string;
  source: "openccu" | "ccu3";
  url: string;
  checkedAt: string;
  error?: string;
};
