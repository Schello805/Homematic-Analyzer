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
  hasCcuPassword?: boolean;
  sshHost?: string;
  sshUser?: string;
  sshPassword?: string;
  hasSshPassword?: boolean;
  snifferPort?: string;
  telegramEnabled?: boolean;
  externalSystems?: string[];
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
  dutyCycle?: number;
  counters: {
    devices: number;
    lowBattery: number;
    unreachable: number;
    configPending: number;
    serviceMessages: number;
  };
};

export type CollectorPayload = {
  token?: string;
  host?: string;
  collectedAt?: string;
  system?: Record<string, unknown>;
  logs?: string[];
  backups?: Record<string, unknown>;
};

export type CcuMasterdataPayload = {
  token?: string;
  source?: string;
  collectedAt?: string;
  deviceCount?: number;
  devices?: Array<{
    name?: string;
    address?: string;
    type?: string;
    firmware?: string;
  }>;
};
