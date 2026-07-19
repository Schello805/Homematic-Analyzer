import type { AnalysisResponse, RoutingTopology, CheckStatus, SystemDashboard } from "./types";
import packageInfo from "../package.json";

export const knownServiceTypeTokens = new Set<string>(["SABOTAGE", "SMOKE", "WATER", "LEAK"]);

export function loadSavedSetup() {
  return {
    ccuHost: "",
    ccuUser: "",
    ccuPassword: "",
    xmlApiToken: "",
    sshUser: "",
    sshPassword: "",
    snifferEnabled: false,
    snifferPort: "",
    hmipRoutingEnabled: false,
    hmipRoutingLogLevelSet: false,
    hmipRoutingRestarted: false
  };
}

export const initialForm = loadSavedSetup();

export type NotificationSettings = any;
export const initialNotificationSettings: NotificationSettings = {
  telegram: { enabled: false, token: "", chatId: "", botToken: "" },
  email: { enabled: false, to: "", host: "", port: undefined, user: "" },
  events: { enabled: false },
  ai: { enabled: false, apiKey: "" }
};

export function loadSavedAnalysis(): AnalysisResponse | null {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem("homematic-analyzer-analysis");
    return raw ? JSON.parse(raw) as AnalysisResponse : null;
  } catch {
    return null;
  }
}

export function loadSavedRoutingTopology(): RoutingTopology | null {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem("homematic-routing-topology");
    return raw ? JSON.parse(raw) as RoutingTopology : null;
  } catch {
    return null;
  }
}

export function firstRelevantCheckId(analysis?: AnalysisResponse | null): string | null {
  return analysis?.checks?.[0]?.id ?? null;
}

export function filterSnifferFromCheck(check: any, _mode: any) { return check; }
export function checkUsesSniffer(_check: any) { return false; }

export function getApiBaseUrl() { return "/api"; }
export function getAnalyzerBaseUrl() {
  if (typeof window === "undefined") return "http://127.0.0.1:3001";
  return window.location.origin.replace(/\/+$/, "");
}
export function getCcuUiUrl(host?: string) { return host ? `http://${host}` : ""; }

export const setupStorageKey = "homematic-analyzer-setup";
export function routingMeasurementCount(topology?: any) { return topology?.nodes?.length ?? 0; }

export async function saveRoutingTopology(topology: RoutingTopology | null) {
  try { if (typeof window !== "undefined") window.localStorage.setItem("homematic-routing-topology", JSON.stringify(topology)); } catch {}
}

export const repositoryUrl = "https://github.com/Schello805/Homematic-Analyzer";

export function saveAnalysisSnapshot(analysis: AnalysisResponse | null) {
  try { if (typeof window !== "undefined") window.localStorage.setItem("homematic-analyzer-analysis", JSON.stringify(analysis)); } catch {}
}

export const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

export const analysisSteps: any[] = [];

export function getSecretIcon(_visible?: boolean) { return "🔒"; }
export const statusLabel: Record<CheckStatus, string> = { ok: "OK", improvement: "Verbesserung", warning: "Warnung", critical: "Kritisch", unavailable: "Nicht verfügbar" };
export function getStatusIcon(_status?: CheckStatus, _className?: string) { return null; }
export const statusOrder: CheckStatus[] = ["ok", "improvement", "warning", "critical", "unavailable"];
export const checkThemes: Array<{ id: string; checkIds: string[]; title?: string; description?: string; checks?: any[] }> = [];

export function hasShellSystemData(dashboard?: SystemDashboard | null) { return Boolean(dashboard?.available); }

// Reuse helpers from routing view
export function polarPoint(center: number, radius: number, percent: number) {
  const angle = (percent * 3.6 - 90) * Math.PI / 180;
  return {
    x: center + Math.cos(angle) * radius,
    y: center + Math.sin(angle) * radius
  };
}

export function donutSegmentPath(startPercent: number, endPercent: number, outerRadius = 48, innerRadius = 25) {
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

export const appVersion = packageInfo.version ?? "0.0.0";

export default {};
