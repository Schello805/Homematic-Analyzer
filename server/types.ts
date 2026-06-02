export type AccessMode = "ccu" | "ssh" | "sniffer" | "telegram" | "external";

export type CheckStatus = "ok" | "improvement" | "warning" | "critical" | "unavailable";

export type Evidence = {
  source: string;
  detail: string;
  timestamp?: string;
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
  hasCcuPassword?: boolean;
  sshHost?: string;
  sshUser?: string;
  hasSshPassword?: boolean;
  snifferPort?: string;
  telegramEnabled?: boolean;
  externalSystems?: string[];
};

export type CollectorPayload = {
  token?: string;
  host?: string;
  collectedAt?: string;
  system?: Record<string, unknown>;
  logs?: string[];
  backups?: Record<string, unknown>;
};
