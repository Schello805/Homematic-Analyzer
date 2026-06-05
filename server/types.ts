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
  snifferPort?: string;
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
  lowBattery: boolean;
  unreachable: boolean;
  configPending: boolean;
  evidence: CcuEvidence[];
};

export type CcuSnapshot = {
  reachable: boolean;
  xmlApiInstalled: boolean;
  source: "xml-api";
  collectedAt: string;
  error?: string;
  devices: CcuDevice[];
  serviceMessages: CcuEvidence[];
  alarmMessages: CcuEvidence[];
  dutyCycle?: number;
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
  network?: {
    connections?: string[];
  };
  backups?: Record<string, unknown>;
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

export type ReleaseCheck = {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  source?: "release" | "tag" | "main";
  url?: string;
  checkedAt: string;
  error?: string;
};
