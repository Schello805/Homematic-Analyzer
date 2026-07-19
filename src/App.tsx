import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import packageInfo from "../package.json";
import { EvidenceDetail, SourceBadge } from "./components/analysis/EvidenceDetail";
import { SignalQualityDeviceList, type SignalReceiverOption } from "./components/analysis/SignalQualityDeviceList";
import { InfoTooltip } from "./components/ui/InfoTooltip";
import { RadioInfrastructureView } from "./components/routing/RadioInfrastructureView";
import { RoutingTopologyView } from "./components/routing/RoutingTopologyView";
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
import type {
  ActionModal,
  AnalysisCheck,
  AnalysisHistoryPayload,
  AnalysisResponse,
  AnalysisSnifferMode,
  AppPage,
  BackupItem,
  CheckStatus,
  CollectorStatus,
  CcuTestResult,
  DiagnosticSource,
  DiagnosticsPayload,
  Evidence,
  LogPayload,
  MasterdataStatus,
  NotificationMonitorStatus,
  RoutingStatus,
  RoutingTopology,
  RoutingTopologyNode,
  SetupDefaults,
  SnifferHistoryPayload,
  SnifferSnapshot,
  Toast,
  UpdateRunStatus,
  UpdateStatus,
  UsbPort
  ,
  SetupForm,
  NotificationSettings
} from "./types";
import {
  knownServiceTypeTokens,
  loadSavedSetup,
  initialNotificationSettings,
  loadSavedAnalysis,
  loadSavedRoutingTopology,
  firstRelevantCheckId,
  filterSnifferFromCheck,
  checkUsesSniffer,
  getAnalyzerBaseUrl,
  getApiBaseUrl,
  getCcuUiUrl,
  setupStorageKey,
  routingMeasurementCount,
  saveRoutingTopology,
  repositoryUrl,
  saveAnalysisSnapshot,
  wait,
  analysisSteps,
  getSecretIcon,
  statusLabel,
  getStatusIcon,
  statusOrder,
  checkThemes,
  hasShellSystemData,
  polarPoint,
  donutSegmentPath
} from "./appHelpers";
import { initialForm, appVersion } from "./appHelpers";

function extractAdditionalServiceTypes(evidence: Evidence[]) {
  return [...new Set(evidence.flatMap(({ detail }) => (
    detail.match(/\b(?:[A-Z]+(?:_[A-Z0-9]+)+|SABOTAGE|SMOKE|WATER|LEAK)\b/g) ?? []
  )))]
    .filter((type) => !knownServiceTypeTokens.has(type))
    .sort()
    .slice(0, 12);
}

function readSessionValue(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

type SettingsSaveState = "ready" | "pending" | "saving" | "saved" | "failed";

function App() {
  const [form, setForm] = useState<SetupForm>(loadSavedSetup);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(initialNotificationSettings);
  const [currentPage, setCurrentPage] = useState<AppPage>(() => {
    const stored = readSessionValue("homematic-analyzer-page");
    return ["analysis", "dc", "logs", "diagnostics", "setup", "settings"].includes(stored ?? "") ? stored as AppPage : "analysis";
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const updateReloadStarted = useRef(false);
  const snifferAutoRefreshInFlight = useRef(false);
  const analysisAutoRefreshInFlight = useRef(false);
  const setupDefaultsSyncTimer = useRef<number | undefined>(undefined);
  const notificationSettingsSaveTimer = useRef<number | undefined>(undefined);
  const notificationSettingsHydrated = useRef(false);
  const savedNotificationSettings = useRef(JSON.stringify(initialNotificationSettings));
  const aiLogResultRef = useRef<HTMLElement | null>(null);
  const ccuTestProgressRef = useRef<HTMLDivElement | null>(null);
  const ccuTestResultRef = useRef<HTMLDivElement | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(loadSavedAnalysis);
  const [loading, setLoading] = useState(false);
  const [analysisAutoRefreshing, setAnalysisAutoRefreshing] = useState(false);
  const [activeAnalysisStep, setActiveAnalysisStep] = useState(0);
  const [activeCheck, setActiveCheck] = useState<string | null>(() => readSessionValue("homematic-analyzer-active-check") ?? firstRelevantCheckId(loadSavedAnalysis()));
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
  const [routingTopology, setRoutingTopology] = useState<RoutingTopology | null>(loadSavedRoutingTopology);
  const [routingTopologyLoading, setRoutingTopologyLoading] = useState(false);
  const [collectorMode, setCollectorMode] = useState<"once" | "install" | "uninstall">("once");
  const [collectorInterval, setCollectorInterval] = useState<"daily" | "hourly" | "minute">("minute");
  const [settingsSaveState, setSettingsSaveState] = useState<SettingsSaveState>("ready");
  const [settingsSavedAt, setSettingsSavedAt] = useState<Date | null>(null);
  const [notificationMonitorStatus, setNotificationMonitorStatus] = useState<NotificationMonitorStatus | null>(null);
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

  useEffect(() => {
    const target = ccuTestLoading ? ccuTestProgressRef.current : ccuTestResult ? ccuTestResultRef.current : null;
    if (!target) return;
    const timeout = window.setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    return () => window.clearTimeout(timeout);
  }, [ccuTestLoading, ccuTestResult]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem("homematic-analyzer-page", currentPage);
      if (activeCheck) window.sessionStorage.setItem("homematic-analyzer-active-check", activeCheck);
      else window.sessionStorage.removeItem("homematic-analyzer-active-check");
    } catch {
    }
  }, [currentPage, activeCheck]);

  const pageLabels = {
    analysis: "Analyse",
    dc: "DC-Analyzer",
    logs: "Logs",
    diagnostics: "Status",
    settings: "Einstellungen",
    setup: "Setup"
  } satisfies Record<typeof currentPage, string>;

  function navigateTo(page: AppPage) {
    setCurrentPage(page);
    setMobileMenuOpen(false);
  }

  function navigateHome() {
    navigateTo("analysis");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const hasAnalysis = Boolean(analysis);
  const analysisDataRefreshing = loading || analysisAutoRefreshing;
  const startupDataSources = [
    { id: "ccu", label: "CCU & XML-API", detail: "Geräte, Meldungen und Livewerte" },
    { id: "masterdata", label: "CCU-Stammdaten", detail: "Namen und vorbereitete Zusatzdaten" },
    { id: "collector", label: "System-Collector", detail: "Logs, Backups und Systemwerte" },
    { id: "sniffer", label: "AskSin-Sniffer", detail: "Optional: Funklast und zweite Messposition", optional: true }
  ];
  const displayedChecks = useMemo(() => (
    analysis?.checks
      .map((check) => filterSnifferFromCheck(check, analysisSnifferMode))
      .filter((check): check is AnalysisCheck => Boolean(check)) ?? []
  ), [analysis, analysisSnifferMode]);
  const displayedAnalysis = useMemo(() => (
    analysis ? { ...analysis, checks: displayedChecks } : null
  ), [analysis, displayedChecks]);
  const detectedAdditionalServiceTypes = useMemo(() => {
    const serviceMessages = analysis?.checks.find((check) => check.id === "service-messages");
    return extractAdditionalServiceTypes(serviceMessages?.evidence ?? []);
  }, [analysis]);
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
    const diagnosticSource = (id: string) => diagnostics?.sources.find((source) => source.id === id);
    const ccuDiagnostic = diagnosticSource("ccu");
    const masterdataDiagnostic = diagnosticSource("masterdata");
    const collectorDiagnostic = diagnosticSource("collector");
    const snifferDiagnostic = diagnosticSource("sniffer");
    return [
      {
        id: "ccu",
        label: "CCU Live",
        time: diagnostics ? ccuDiagnostic?.lastSuccessAt : analysis.sources?.ccu,
        diagnosticState: ccuDiagnostic?.status,
        diagnosticDetail: ccuDiagnostic?.detail,
        required: true,
        purpose: "Geräte, Servicemeldungen, Batterien, Duty Cycle und RSSI der Zentrale.",
        action: "Status öffnen",
        actionType: "diagnostics" as const
      },
      {
        id: "masterdata",
        label: "CCU Add-on",
        time: diagnostics ? masterdataDiagnostic?.lastSuccessAt : masterdataStatus?.receivedAt ?? masterdataStatus?.collectedAt ?? analysis.sources?.masterdata,
        diagnosticState: masterdataDiagnostic?.status,
        diagnosticDetail: masterdataDiagnostic?.detail,
        required: false,
        purpose: "Stammdaten, Gerätenamen, Systemwerte, Backups, Logs und Verbindungen.",
        action: "Add-on laden",
        actionType: "masterdata" as const
      },
      {
        id: "collector",
        label: "Add-on Collector",
        time: diagnostics ? collectorDiagnostic?.lastSuccessAt : collectorStatus?.collectedAt ?? analysis.sources?.collector,
        diagnosticState: collectorDiagnostic?.status,
        diagnosticDetail: collectorDiagnostic?.detail,
        required: false,
        purpose: "Automatische Übertragung aus dem CCU Add-on.",
        action: "Add-on öffnen",
        actionType: "collector" as const
      },
      {
        id: "sniffer",
        label: "AskSin-Sniffer",
        time: diagnostics ? snifferDiagnostic?.lastSuccessAt : analysis.sources?.sniffer,
        diagnosticState: snifferDiagnostic?.status,
        diagnosticDetail: snifferDiagnostic?.detail,
        required: false,
        hidden: !form.snifferEnabled || analysisSnifferMode === "base",
        purpose: "Telegramme, Funklast, Rauschpegel und RSSI am Standort des Sniffers.",
        action: "DC öffnen",
        actionType: "dc" as const
      }
    ].filter((item) => !item.hidden);
  }, [analysis, analysisSnifferMode, collectorStatus?.collectedAt, diagnostics, form.snifferEnabled, masterdataStatus?.collectedAt, masterdataStatus?.receivedAt]);
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
    const apiBaseUrl = getApiBaseUrl();
    const analyzerUrl = getAnalyzerBaseUrl();
    const params = new URLSearchParams({
      url: analyzerUrl,
      mode: collectorMode,
      interval: collectorInterval
    });
    return `${analyzerUrl}${apiBaseUrl}/collector/script?${params.toString()}`;
  }, [collectorMode, collectorInterval]);

  const addonDownloadUrl = useMemo(() => {
    const apiBaseUrl = getApiBaseUrl();
    const analyzerUrl = getAnalyzerBaseUrl();
    const params = new URLSearchParams({ url: analyzerUrl });
    return `${apiBaseUrl}/addon/download?${params.toString()}`;
  }, []);

  const ccuMasterdataScriptUrl = useMemo(() => {
    const apiBaseUrl = getApiBaseUrl();
    const analyzerUrl = getAnalyzerBaseUrl();
    const params = new URLSearchParams({
      url: analyzerUrl
    });
    return `${apiBaseUrl}/ccu-masterdata/script?${params.toString()}`;
  }, []);

  const askSinDevListScriptUrl = useMemo(() => {
    const apiBaseUrl = getApiBaseUrl();
    const analyzerUrl = getAnalyzerBaseUrl();
    const params = new URLSearchParams({
      url: analyzerUrl
    });
    return `${apiBaseUrl}/asksin-devlist/script?${params.toString()}`;
  }, []);

  const collectorCommand = useMemo(() => `curl -fsSL "${scriptUrl}" | sh`, [scriptUrl]);
  const recommendedCollectorCommand = useMemo(() => {
    const apiBaseUrl = getApiBaseUrl();
    const analyzerUrl = getAnalyzerBaseUrl();
    const params = new URLSearchParams({
      url: analyzerUrl,
      mode: "install",
      interval: "minute"
    });
    return `curl -fsSL "${analyzerUrl}${apiBaseUrl}/collector/script?${params.toString()}" | sh`;
  }, []);
  const collectorUninstallCommand = useMemo(() => {
    const apiBaseUrl = getApiBaseUrl();
    const analyzerUrl = getAnalyzerBaseUrl();
    const params = new URLSearchParams({
      url: analyzerUrl,
      mode: "uninstall",
      interval: "minute"
    });
    return `curl -fsSL "${analyzerUrl}${apiBaseUrl}/collector/script?${params.toString()}" | sh`;
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
        text: "CCU Add-on",
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
      const keepExistingMeasurements = routingMeasurementCount(result) === 0 && routingMeasurementCount(routingTopology) > 0;
      const nextTopology = keepExistingMeasurements ? routingTopology : result;
      if (!keepExistingMeasurements) saveRoutingTopology(result);
      setRoutingTopology(nextTopology);
      if (showResultToast) {
        showToast({
          type: result.state === "ready" ? "success" : result.state === "partial" ? "info" : "warning",
          title: result.state === "ready" ? "Funk-Infrastruktur aktualisiert" : "Funk-Infrastruktur geladen",
          message: `${result.metrics.gateways} Gateway${result.metrics.gateways === 1 ? "" : "s"}, ${result.metrics.confirmedRouters} bestätigte HmIP-Router und ${result.metrics.routerCandidates} mögliche Router-Kandidaten erkannt.`
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

  function runDiagnosticAction(sourceId: string) {
    if (sourceId === "setup") {
      navigateTo("setup");
      return;
    }
    if (sourceId === "ccu") {
      navigateTo("setup");
      if (!form.ccuHost.trim()) {
        showToast({ type: "warning", title: "CCU-Adresse fehlt", message: "Trage zuerst im Setup die Adresse der Zentrale ein." });
        return;
      }
      void testCcuConnection();
      return;
    }
    if (sourceId === "masterdata") {
      navigateTo("setup");
      return;
    }
    if (sourceId === "collector") {
      openActionModal("collector");
      return;
    }
    if (sourceId === "sniffer") {
      navigateTo("dc");
      return;
    }
    navigateTo("analysis");
  }

  function diagnosticActionLabel(sourceId: string) {
    if (sourceId === "setup") return "Setup öffnen";
    if (sourceId === "ccu") return "CCU Live-Test starten";
    if (sourceId === "masterdata") return "CCU Add-on öffnen";
    if (sourceId === "collector") return "Add-on Collector öffnen";
    if (sourceId === "sniffer") return "DC-Analyzer öffnen";
    return "Analyse öffnen";
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

  async function saveNotificationSettings(settingsToSave: NotificationSettings) {
    setSettingsSaveState("saving");
    try {
      const response = await fetch("/api/settings/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsToSave)
      });

      if (!response.ok) throw new Error("Einstellungen konnten nicht gespeichert werden.");
      savedNotificationSettings.current = JSON.stringify(settingsToSave);
      setSettingsSavedAt(new Date());
      setSettingsSaveState("saved");
    } catch {
      setSettingsSaveState("failed");
      showToast({
        type: "error",
        title: "Einstellungen nicht gespeichert",
        message: "Bitte lokale API prüfen."
      });
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
      message: "Die zurückgesetzten Einstellungen werden automatisch gespeichert."
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
            : allChecks.filter((check) => check.status !== "ok");
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
  const healthyCheckCount = displayedAnalysis?.checks.filter((check) => check.status === "ok").length ?? 0;

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
        button: primaryRadioCheck.id === "duty-cycle"
          ? "Verursacher prüfen"
          : primaryRadioCheck.id === "signal-strength" ? "Signalwerte öffnen" : "Funkdetails öffnen",
        modal: primaryRadioCheck.id === "duty-cycle"
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
          ? "CCU Add-on sendet nicht mehr"
          : collectorWasSeen
            ? "CCU Add-on liefert keine Logs"
            : "CCU Add-on installieren",
        detail: collectorIsStale
          ? `Das Add-on war bereits eingerichtet, hat aber seit ${lastCollectorAt ?? "längerer Zeit"} keine Daten mehr gesendet.`
          : collectorWasSeen
            ? "Das Add-on sendet Systemwerte, aber aktuell keine lesbaren Logzeilen."
            : "Logs fehlen noch. Das verhindert die belegbare Erkennung von Scriptfehlern, Dienstneustarts und auffälligen externen Zugriffen.",
        button: collectorWasSeen ? "Add-on prüfen" : "Add-on installieren",
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
        : displayedAnalysis.checks.filter((check) => check.status !== "ok");

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
          const nextSettings = {
            telegram: { ...initialNotificationSettings.telegram, ...settings.telegram },
            email: { ...initialNotificationSettings.email, ...settings.email },
            events: { ...initialNotificationSettings.events, ...settings.events },
            ai: { ...initialNotificationSettings.ai, ...settings.ai }
          };
          savedNotificationSettings.current = JSON.stringify(nextSettings);
          notificationSettingsHydrated.current = true;
          setSettingsSaveState("ready");
          setNotificationSettings(nextSettings);
        }
      } catch {
      } finally {
        notificationSettingsHydrated.current = true;
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
    if (!notificationSettingsHydrated.current) return;

    const serializedSettings = JSON.stringify(notificationSettings);
    if (serializedSettings === savedNotificationSettings.current) return;

    setSettingsSaveState("pending");

    if (notificationSettingsSaveTimer.current) {
      window.clearTimeout(notificationSettingsSaveTimer.current);
    }
    notificationSettingsSaveTimer.current = window.setTimeout(() => {
      void saveNotificationSettings(notificationSettings);
    }, 650);

    return () => {
      if (notificationSettingsSaveTimer.current) {
        window.clearTimeout(notificationSettingsSaveTimer.current);
      }
    };
  }, [notificationSettings]);

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
    if (currentPage !== "settings") return;
    let isActive = true;

    async function loadNotificationMonitorStatus() {
      try {
        const response = await fetch("/api/notifications/monitor-status", { cache: "no-store" });
        if (!response.ok) return;
        const status = (await response.json()) as NotificationMonitorStatus;
        if (isActive) setNotificationMonitorStatus(status);
      } catch {
      }
    }

    void loadNotificationMonitorStatus();
    const interval = window.setInterval(() => void loadNotificationMonitorStatus(), 15000);
    return () => {
      isActive = false;
      window.clearInterval(interval);
    };
  }, [currentPage, notificationSettings.telegram.enabled, notificationSettings.email.enabled]);

  useEffect(() => {
    if (!analysis || currentPage !== "analysis" || !form.snifferEnabled || !form.snifferPort.trim()) return;
    void loadSnifferSnapshot(false, false);
  }, [analysis?.generatedAt, currentPage, form.snifferEnabled, form.snifferPort]);

  useEffect(() => {
    if (currentPage !== "diagnostics") return;
    void loadDiagnostics(false);
  }, [currentPage]);

  useEffect(() => {
    if (currentPage !== "analysis") return;
    void loadDiagnostics(false);
    const interval = window.setInterval(() => void loadDiagnostics(false), 15000);
    return () => window.clearInterval(interval);
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
      const payload = await response.json().catch(() => null) as { error?: string; issues?: Array<{ path?: Array<string | number>; message?: string }> } | null;
      const issue = payload?.issues?.[0];
      const issuePath = issue?.path?.length ? ` (${issue.path.join(".")})` : "";
      throw new Error(`${payload?.error ?? "Die Analyse konnte nicht gestartet werden."}${issue?.message ? `: ${issue.message}${issuePath}` : ""}`);
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
        title: copied ? "Legacy-Script kopiert" : "Kopieren blockiert",
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
            <p>Empfohlene Reihenfolge: CCU verbinden, XML-API prüfen, dann das Homematic Analyzer Add-on auf der Zentrale installieren. Sniffer bleibt optional.</p>
            <p className="setup-note">Zugangsdaten werden lokal in diesem Browser gespeichert. Die CCU bleibt im LAN oder VPN.</p>
            <button type="button" className="ghost-button" onClick={resetSavedSetup}>
              Gespeicherte Daten löschen
            </button>
          </div>

          <div className="setup-roadmap" aria-label="Empfohlene Einrichtung">
            {[
              ["1", "CCU Login", "Host, Benutzer, Passwort und XML-API Token eintragen."],
              ["2", "Analyse testen", "Einmal Analyse starten und prüfen, ob Geräte gelesen werden."],
              ["3", "CCU Add-on", "Add-on herunterladen und unter Zusatzsoftware installieren."],
              ["4", "Optional", "Sniffer und Benachrichtigungen nur bei Bedarf ergänzen."]
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
              <InfoTooltip label="Wofür braucht die App das?">
                Für Geräte, Servicemeldungen, Batterien, Duty Cycle und die XML-API-Prüfung. Bei XML-API v2 wird zusätzlich ein XML-API-Token (`sid`) benötigt.
              </InfoTooltip>
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
              {ccuTestLoading && (
                <div className="ccu-test-progress" ref={ccuTestProgressRef} role="status" aria-live="polite">
                  <span className="loading-spinner" aria-hidden="true" />
                  <div>
                    <strong>CCU-Live-Test läuft</strong>
                    <span>Netzwerk, WebUI, Anmeldung, XML-API und Geräteliste werden nacheinander geprüft. Das kann bei größeren Zentralen einige Sekunden dauern.</span>
                  </div>
                </div>
              )}
              {ccuTestResult && (
                <div className={`ccu-test-result ${ccuTestResult.reachable ? "is-ok" : "has-error"}`} ref={ccuTestResultRef} tabIndex={-1}>
                  <div>
                    <strong>{ccuTestResult.reachable ? "CCU-Daten vollständig lesbar" : ccuTestResult.webUiReachable ? "WebUI erreichbar, XML-API noch nicht nutzbar" : "CCU vom Analyzer aus nicht erreichbar"}</strong>
                    <span>{ccuTestResult.reachable ? `${ccuTestResult.devices} Geräte gelesen.` : ccuTestResult.error ?? "Siehe Prüfschritte."}</span>
                    {ccuTestResult.centralVersion && <small>{ccuTestResult.centralProduct ? `${ccuTestResult.centralProduct} ` : ""}{ccuTestResult.centralVersion}</small>}
                  </div>
                  <ol>
                    {ccuTestResult.diagnostics.map((diagnostic) => (
                      <li className={`diagnostic-${diagnostic.status}`} key={`${diagnostic.step}-${diagnostic.detail}`}>
                        <strong>{diagnostic.step}</strong>
                        <span>{diagnostic.detail}</span>
                      </li>
                    ))}
                  </ol>
                  {ccuTestResult.reachable && (
                    <button type="button" className="light-button" onClick={() => void runAnalysis(undefined, "ccu-connection")}>
                      Analyse mit CCU-Daten starten
                    </button>
                  )}
                </div>
              )}
            </fieldset>

            <fieldset className="setup-card setup-card-optional">
              <legend>SSH Login</legend>
              <InfoTooltip label="Wann ist SSH sinnvoll?">
                Nur als Fallback für Logauszüge und aktive Verbindungen. Das CCU Add-on ist der empfohlene Weg.
              </InfoTooltip>
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
              <InfoTooltip label="Was bringt der Sniffer?">
                Die Basisanalyse funktioniert ohne Löten: Die Zentrale liefert Geräte, Meldungen, Batterien, Duty Cycle und Zentralen-RSSI. Der Sniffer ergänzt tiefere Funkdetails.
              </InfoTooltip>
              <details className="inline-help">
                <summary>Brauche ich den AskSin-Sniffer überhaupt?</summary>
                <ul>
                  <li><strong>Ohne Sniffer:</strong> Geräte- und Alarmmeldungen, Batterien, Erreichbarkeit, Konfiguration, CCU-Duty-Cycle, RSSI der Zentrale sowie Router- und Gateway-Konfiguration.</li>
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
          {error && <p className="error">{error}</p>}
        </section>
      </form>

      <section className="collector panel">
        <details>
          <summary>
            <span>
              <small>Empfohlen</small>
              CCU Add-on installieren
            </span>
            <strong>Add-on laden</strong>
          </summary>
          <div className="setup-script-content">
            <p>
              Das Add-on übernimmt die regelmäßige Übergabe von CCU-Systemwerten, Backups, Logs, Verbindungen und Gerätenamen an den Analyzer.
            </p>
            <p className="setup-note">Empfehlung: erst oben CCU-Login eintragen und eine Analyse testen, danach das Add-on herunterladen und installieren.</p>
            <p className={`setup-note ${masterdataStatus?.available ? "setup-note-ok" : ""}`}>
              {masterdataStatus?.available
                ? `Empfangen: ${masterdataStatus.deviceCount} Geräte${masterdataStatus.systemAvailable ? " · CCU-Systemwerte" : ""}, am Analyzer zuletzt ${masterdataStatus.receivedAt ? new Date(masterdataStatus.receivedAt).toLocaleString("de-DE") : masterdataStatus.collectedAt ? new Date(masterdataStatus.collectedAt).toLocaleString("de-DE") : "gerade eben"}.`
                : "Noch keine Add-on-Daten empfangen."}
            </p>
            {usesLocalAnalyzerUrl && (
              <p className="setup-warning">
                Wichtig: Die CCU kann `127.0.0.1` nicht erreichen, wenn der Analyzer auf deinem Rechner läuft.
                Öffne die App für das Script besser über deine Netzwerk-IP, z. B. `http://192.168.x.x:5173`.
              </p>
            )}
            <div className="script-actions">
              <a className="button-link" href={addonDownloadUrl} download>
                Homematic Analyzer Add-on herunterladen
              </a>
            </div>
            <ol>
              <li>CCU WebUI öffnen.</li>
              <li>`Einstellungen` → `Systemsteuerung` → `Zusatzsoftware` öffnen.</li>
              <li>Die heruntergeladene Add-on-Datei hochladen und installieren.</li>
              <li>Nach kurzer Zeit liefert die Zentrale automatisch neue Daten.</li>
            </ol>
            <details className="secondary-details">
              <summary>Erweiterte Fallback-Scripts anzeigen</summary>
              <div className="script-actions">
                <button type="button" onClick={() => void copyCcuMasterdataScript()}>
                  Legacy-CCU-Legacy-Script kopieren
                </button>
                <a href={ccuMasterdataScriptUrl} target="_blank" rel="noreferrer">
                  Script im Browser öffnen
                </a>
              </div>
              {ccuScriptPreview && (
                <label className="script-preview">
                  Legacy-Script zum manuellen Kopieren
                  <textarea readOnly value={ccuScriptPreview} onFocus={(event) => event.target.select()} />
                </label>
              )}
            </details>
          </div>
        </details>

        <details className="secondary-details">
          <summary>
            <span>
              <small>Optional</small>
              Erweiterter Fallback
            </span>
            <strong>Details</strong>
          </summary>
          <div className="setup-script-content">
            <p>
              Nur als Fallback, falls das Add-on auf deiner Zentrale nicht installiert werden kann.
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
              <InfoTooltip label="Was misst der Sniffer?">
                Live-Messwerte vom AskSin-Sniffer. Er ergänzt die CCU um Telegramme, Funkzeit, Carrier Sense und RSSI am Standort des Sniffers.
              </InfoTooltip>
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
                  Legacy-Script kopieren
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
                <InfoTooltip label="USB-Port erklären">
                  Der Sniffer steckt am Analyzer-System. Bei Proxmox muss der Port vorher an den LXC durchgereicht werden.
                </InfoTooltip>
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
                <InfoTooltip label="Messwert erklären" className="dc-metric-tooltip">{hint}</InfoTooltip>
              </div>
            ))}
          </div>

          <div className="dc-chart-card">
            <div>
              <p className="eyebrow">Verlauf</p>
              <h3>Telegramme und gemessener Rauschpegel</h3>
              <InfoTooltip label="Diagramm erklären">
                Blau = empfangene Homematic-Telegramme. Orange = regelmäßige Rauschpegel-Messpunkte des Sniffers, nicht einzelne Störsignale.
              </InfoTooltip>
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
                      Legacy-Script kopieren
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
                <button type="button" className="diagnostic-card__action" onClick={() => runDiagnosticAction(source.id)}>
                  {diagnosticActionLabel(source.id)}
                </button>
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
              <InfoTooltip label="Datenschutz bei KI-Analyse">
                Hier stehen die zuletzt vom Collector übertragenen Logs 1:1. Erst nach deinem Klick auf „Fehler prüfen“ oder „Gesamten Log analysieren“ werden die gewählten Logzeilen an den konfigurierten KI-Anbieter gesendet.
              </InfoTooltip>
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
                    ? "CCU Add-on sendet nicht mehr"
                    : logPayload?.collectorAvailable
                      ? "CCU Add-on findet keine Logdatei"
                      : "Noch keine Logdaten empfangen"}
                </h3>
                <p>
                  {logPayload?.collectorState === "stale"
                    ? `Das Add-on war bereits verbunden, der letzte Snapshot ist aber ${logPayload.collectorAgeMinutes ?? "viele"} Minuten alt. Installiere das Add-on erneut oder öffne den Status.`
                    : logPayload?.collectorAvailable
                      ? "Systemdaten kommen an, aber auf der CCU wurde keine lesbare Logquelle gefunden. Prüfe /var/log/messages, /var/log/syslog oder journalctl."
                      : "Installiere das CCU Add-on, damit Logs hier 1:1 angezeigt werden."}
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
          <h2>{form.ccuHost.trim() ? "Analyse starten" : "Zuerst die CCU verbinden"}</h2>
          <p>
            {form.ccuHost.trim()
              ? "Ein Klick prüft die verfügbaren Datenquellen. Fehlende Setup-Punkte begrenzen nur die Tiefe der Analyse."
              : "Für eine aussagekräftige Analyse brauchst du CCU-Adresse, Login und XML-API-Token. Das dauert nur wenige Minuten."}
          </p>
          {!setupProgress.complete && (
            <p className="setup-note">Setup {setupProgress.percent}% eingerichtet · fehlende Punkte bei Bedarf ergänzen.</p>
          )}
        </div>
        <div className="analysis-start__actions">
          {!form.ccuHost.trim() ? (
            <button type="button" className="analyze-button analyze-button-compact" onClick={() => setCurrentPage("setup")}>Setup beginnen</button>
          ) : (
            <button className="analyze-button analyze-button-compact" disabled={loading}>
              {loading ? "Analyse läuft ..." : "Analyse starten"}
            </button>
          )}
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
            <div className="loader-data-sources" aria-label="Fortschritt der Datenquellen">
              {startupDataSources.filter((source) => !source.optional || form.snifferEnabled).map((source) => {
                const sourceStep = source.id === "ccu" ? 1 : source.id === "masterdata" ? 2 : source.id === "collector" ? 7 : 5;
                const isCurrent = activeAnalysisStep >= sourceStep;
                return (
                  <div className={isCurrent ? "is-checking" : ""} key={source.id}>
                    <span aria-hidden="true">{isCurrent ? "↻" : "◌"}</span>
                    <div><strong>{source.label}</strong><small>{isCurrent ? "wird geprüft – noch keine Nullwerte ableiten" : "wartet auf Prüfung"}</small></div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {analysis && summary && (
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
              {!analysisDataRefreshing && (
                <div className="auto-refresh-pill" aria-live="polite">
                  <span aria-hidden="true">↻</span>
                  <div>
                    <strong>Auto-Refresh</strong>
                    <small>CCU-Werte in {dashboardRefreshSecondsLeft}s</small>
                  </div>
                </div>
              )}
              <div className="score">
                <strong>{displayedAnalysis?.checks.length ?? analysis.checks.length}</strong>
                <span>Prüfpunkte</span>
              </div>
            </div>
          </div>

          {analysisDataRefreshing && (
            <div className="analysis-data-progress" aria-live="polite">
              <span aria-hidden="true">↻</span>
              <div>
                <strong>Neue Daten werden gerade eingelesen</strong>
                <p>{loading ? `${analysisSteps[activeAnalysisStep]?.detail ?? "Datenquellen werden geprüft."} Die bisherigen Ergebnisse bleiben sichtbar.` : "Die letzten bestätigten Werte bleiben sichtbar, bis die nächste Antwort vollständig eingetroffen ist."}</p>
              </div>
              <small>Keine „0“-Werte, bevor eine Quelle tatsächlich geantwortet hat.</small>
            </div>
          )}

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
                const state = source.diagnosticState ?? (source.time ? age.state : analysisDataRefreshing ? "loading" : source.required ? "missing" : "optional");
                const statusText = source.diagnosticState && ["error", "missing", "optional"].includes(source.diagnosticState)
                  ? source.diagnosticDetail ?? "Serverstatus noch nicht verfügbar"
                  : source.time
                  ? analysisDataRefreshing ? `letzter Stand ${age.label}` : age.label
                  : analysisDataRefreshing ? "wird gerade abgefragt"
                  : source.required ? "noch nicht empfangen" : "optional";
                return (
                  <article className={`source-hub-card source-hub-card-${state}`} key={source.id}>
                    <div>
                      <strong>{source.label}</strong>
                      <small className={`data-age data-age-${state}`}>
                        {statusText}
                      </small>
                    </div>
                    <InfoTooltip label="Datenquelle erklärt" className="source-hub-tooltip">{source.purpose}</InfoTooltip>
                    <button
                      type="button"
                      onClick={() => {
                        if (source.actionType === "diagnostics") navigateTo("diagnostics");
                        if (source.actionType === "collector") openActionModal("collector");
                        if (source.actionType === "masterdata") openActionModal("collector");
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
                <InfoTooltip label={analysisSnifferMode === "base" ? "Ohne Snifferwerte" : "Mit Snifferwerten"}>
                  {analysisSnifferMode === "base"
                    ? "Empfohlen für die meisten Nutzer: CCU-, XML-API-, Collector- und Systemdaten. Sniffer-Belege bleiben ausgeblendet."
                    : "Ergänzt die Basisanalyse um Telegramme, Funklast und Messwerte am Standort des Sniffers."}
                </InfoTooltip>
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
                  <InfoTooltip label="So verwendest du die Liste">
                    Nach Priorität sortiert. Öffne nur den Schritt, den du gerade bearbeiten möchtest.
                  </InfoTooltip>
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
                    Add-on öffnen
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
                    <h3>CPU, RAM, Temperatur, Speicher und Backups brauchen das CCU Add-on</h3>
                    <p>
                      Die Homematic-Analyse funktioniert bereits. Für das System-Dashboard muss die CCU/RaspberryMatic
                      aber regelmäßig Messwerte an den Analyzer senden.
                    </p>
                  </div>
                  <ol>
                    <li>Setup öffnen und das Homematic Analyzer Add-on herunterladen.</li>
                    <li>In der CCU unter Zusatzsoftware installieren.</li>
                    <li>Danach die Analyse neu starten oder kurz warten — die Werte aktualisieren sich minütlich.</li>
                  </ol>
                  <div className="script-copy-row">
                    <a className="button-link" href={addonDownloadUrl} download>Add-on herunterladen</a>
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
                    help: "Wenn CPU nicht verfügbar ist: Setup öffnen und das CCU Add-on installieren. Der Verlauf zeigt 0–100% CPU-Auslastung der CCU.",
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
                    help: "Wenn RAM nicht verfügbar ist: Setup öffnen und das CCU Add-on installieren. Der Verlauf zeigt 0–100% RAM-Belegung.",
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
                    hint: analysis.systemDashboard.temperature ? "CPU-/Systemtemperatur der Zentrale." : "Das CCU Add-on installieren oder aktualisieren.",
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
                    help: "Wenn lokaler Speicher nicht verfügbar ist: Setup öffnen und das CCU Add-on installieren. Geprüft wird `df -h /usr/local`. Gelb ab 80%, rot ab 95% Belegung.",
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
                    help: "Der Wert kommt vom Dateisystem, auf dem das neueste Backup liegt. Wenn nicht verfügbar: CCU Add-on nach dem Update erneut installieren oder abwarten und prüfen, ob der Stick unter `/media`, `/mnt` oder `/run/media` gemountet ist.",
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
                    help: "Wenn nicht verfügbar: CCU Add-on erneut installieren. Es liest `uptime` direkt auf der Zentrale."
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
                  <article key={check.id} data-check-id={check.id}>
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
                        <button type="button" onClick={() => openActionModal("collector")}>Add-on öffnen</button>
                      )}
                      {check.id === "duty-cycle" && (
                        <button type="button" onClick={() => setCurrentPage("dc")}>DC-Analyzer öffnen</button>
                      )}
                      {check.id === "signal-strength" && form.snifferEnabled && analysisSnifferMode === "with-sniffer" && (
                        <button type="button" onClick={() => setCurrentPage("dc")}>DC-Analyzer öffnen</button>
                      )}
                      {check.id === "signal-strength" && (
                        <button type="button" onClick={() => openSignalImprovement()}>Empfang verbessern</button>
                      )}
                      {check.id === "logs" && (
                        <button type="button" onClick={() => setCurrentPage("logs")}>Logs und KI-Auswertung öffnen</button>
                      )}
                      {check.id === "notifications" && (
                        <button type="button" onClick={() => setCurrentPage("settings")}>Benachrichtigungen einstellen</button>
                      )}
                    </div>

                    {check.id === "routing-topology" && (
                      <RadioInfrastructureView
                        topology={routingTopology}
                        loading={routingTopologyLoading}
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
            <InfoTooltip label="Optionale Funktionen">
              Aktiviere nur Funktionen, die du wirklich nutzen möchtest. Benachrichtigungen, KI und HmIP-Routing bleiben sonst vollständig außen vor.
            </InfoTooltip>
            <p className="setup-note">Secrets werden lokal verschlüsselt gespeichert. Die App bleibt trotzdem für Heimnetz oder VPN gedacht und sollte nicht öffentlich ins Internet gestellt werden.</p>
            <p className={`notification-monitor-status ${notificationMonitorStatus?.lastError ? "has-error" : ""}`}>
              {notificationMonitorStatus === null && "Benachrichtigungs-Überwachung wird geprüft ..."}
              {notificationMonitorStatus && !notificationMonitorStatus.enabled && "Für Ereignisbenachrichtigungen Telegram oder E-Mail aktivieren."}
              {notificationMonitorStatus?.enabled && notificationMonitorStatus.lastError && `Überwachung wartet: ${notificationMonitorStatus.lastError}`}
              {notificationMonitorStatus?.enabled && !notificationMonitorStatus.lastError && !notificationMonitorStatus.initialized && "Überwachung startet: Der erste CCU-Abgleich bildet still eine Basis."}
              {notificationMonitorStatus?.enabled && !notificationMonitorStatus.lastError && notificationMonitorStatus.initialized && `Überwachung aktiv · neue Ereignisse werden innerhalb von ${notificationMonitorStatus.intervalSeconds} Sekunden geprüft.`}
            </p>
            <div className="script-actions">
              <span className={`settings-autosave ${settingsSaveState}`} aria-live="polite">
                {settingsSaveState === "pending" && "Änderungen werden vorbereitet ..."}
                {settingsSaveState === "saving" && "Speichert Änderungen ..."}
                {settingsSaveState === "saved" && `✓ Automatisch gespeichert · ${settingsSavedAt?.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`}
                {settingsSaveState === "failed" && "Speichern fehlgeschlagen – lokale API prüfen"}
                {settingsSaveState === "ready" && "Automatisches Speichern ist aktiv"}
              </span>
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
                <span>Funk-Infrastruktur</span>
                <small>{form.hmipRoutingEnabled ? "Aktiv · Router und Gateways" : "Optional · ausgeschaltet"}</small>
              </summary>
              <div className="settings-block__body">
                <label className="toggle routing-master-toggle">
                  <input
                    type="checkbox"
                    checked={form.hmipRoutingEnabled}
                    onChange={(event) => updateForm({ ...form, hmipRoutingEnabled: event.target.checked })}
                  />
                  <span>Router und Funk-Gateways erfassen</span>
                </label>

                {!form.hmipRoutingEnabled ? (
                  <div className="routing-disabled-note">
                    <strong>Der Infrastruktur-Prüfpunkt ist ausgeblendet.</strong>
                    <span>Aktiviere ihn, wenn Router-Schalter und klassische Funk-Gateways ausgewertet werden sollen.</span>
                  </div>
                ) : (
                  <div className="routing-guide">
                    <div className="routing-guide__intro">
                      <div>
                        <strong>Router und Gateways aus der CCU lesen</strong>
                        <span>Der Collector überträgt die Konfiguration der bekannten Funkgeräte. Einen live verwendeten nächsten Empfänger pro Gerät stellt die CCU nicht als Tabelle bereit.</span>
                      </div>
                      <span className={`routing-readiness ${routingStatus?.collectorState === "fresh" ? "is-ready" : ""}`}>
                        {routingStatus?.collectorState === "fresh" ? "Collector bereit" : "Collector prüfen"}
                      </span>
                    </div>

                    <ol className="routing-checklist">
                      <li className="is-complete">
                        <input type="checkbox" checked readOnly aria-label="Routing-Analyse aktiviert" />
                        <div>
                          <strong>Funk-Infrastruktur aktiviert</strong>
                          <span>Der Prüfpunkt erscheint ab der nächsten Analyse.</span>
                        </div>
                      </li>
                      <li className={routingStatus?.collectorState === "fresh" ? "is-complete" : ""}>
                        <input type="checkbox" checked={routingStatus?.collectorState === "fresh"} readOnly aria-label="Collector sendet aktuell" />
                        <div>
                          <strong>Aktuellen Collector auf der CCU ausführen</strong>
                          <span>
                            {routingStatus?.collectorState === "fresh"
                              ? `Letzte Daten: ${routingStatus.collectedAt ? new Date(routingStatus.collectedAt).toLocaleString("de-DE") : "soeben"}.`
                              : "Führe den Collector auf der CCU aus oder warte auf seine nächste regelmäßige Übertragung."}
                          </span>
                          {routingStatus?.collectorState !== "fresh" && (
                            <div className="routing-command">
                              <code>{recommendedCollectorCommand}</code>
                              <button type="button" onClick={() => void copyText(recommendedCollectorCommand)}>Kopieren</button>
                            </div>
                          )}
                        </div>
                      </li>
                    </ol>

                    <div className={`routing-finish ${routingStatus?.collectorState === "fresh" ? "is-ready" : ""}`}>
                      <div>
                        <strong>{routingStatus?.collectorState === "fresh" ? "Infrastruktur wird übertragen" : "Collector-Verbindung prüfen"}</strong>
                        <span>
                          {routingStatus?.collectorState === "fresh"
                            ? "Die Router- und Gateway-Konfiguration erscheint in der Analyse unter „Funk-Infrastruktur“."
                            : "Sobald der Collector Daten liefert, wird die Übersicht automatisch aktualisiert."}
                        </span>
                      </div>
                      <div className="routing-actions">
                        <button type="button" className="light-button" onClick={() => void loadRoutingStatus(true)} disabled={routingStatusLoading}>
                          {routingStatusLoading ? "Status wird geprüft …" : "Status aktualisieren"}
                        </button>
                      </div>
                    </div>

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
                  ["serviceOverheat", "Überhitzung am Gerät (ERROR_OVERHEAT)"],
                  ["serviceSecurity", "Sicherheitsmeldung (Sabotage, Rauch, Wasser)"],
                  ["serviceHeating", "Heizungs-/Ventilfehler"],
                  ["serviceActuator", "Motor-/Antriebsfehler"],
                  ["dutyCycle", "Duty Cycle kritisch/hoch"],
                  ["battery", "Batterie niedrig"],
                  ["unreachable", "Gerätekommunikation gestört / Gerät nicht erreichbar"],
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
              {detectedAdditionalServiceTypes.length > 0 && (
                <details className="recognized-service-types">
                  <summary>Weitere in deiner CCU erkannte Meldungstypen ({detectedAdditionalServiceTypes.length})</summary>
                  <p className="muted">Nur tatsächlich empfangene, noch nicht zugeordnete Meldungstypen. Sie lösen erst nach deiner Auswahl eine Benachrichtigung aus.</p>
                  <div className="event-grid">
                    {detectedAdditionalServiceTypes.map((type) => {
                      const selectedTypes = notificationSettings.events.serviceTypes ?? [];
                      const selected = selectedTypes.includes(type);
                      return (
                        <label className="toggle event-toggle" key={type}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={(event) => {
                              const nextTypes = event.target.checked
                                ? [...new Set([...selectedTypes, type])]
                                : selectedTypes.filter((item) => item !== type);
                              updateNotificationSettings({
                                ...notificationSettings,
                                events: { ...notificationSettings.events, serviceTypes: nextTypes }
                              });
                            }}
                          />
                          <span>{type}</span>
                        </label>
                      );
                    })}
                  </div>
                </details>
              )}
              <p className="muted">Kommunikationsstörungen werden über „Gerätekommunikation gestört / Gerät nicht erreichbar“ gesteuert. Sicherheits-, Heizungs- und Antriebsfehler werden nur bei einer passenden CCU-Meldung benachrichtigt. Neue Releases werden als eigener Hinweis verarbeitet, sobald der Release-Check ein Update belegt.</p>
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
                    ? "Das CCU Add-on war eingerichtet, sendet aber nicht mehr"
                    : collectorStatus?.available
                      ? "CCU Add-on ist eingerichtet"
                      : "CCU Add-on installieren"}
                </h2>
                <p>
                  {collectorStatus?.state === "stale"
                    ? `Der Analyzer hat das Add-on früher erkannt. Der letzte Snapshot kam am ${collectorStatus.collectedAt ? new Date(collectorStatus.collectedAt).toLocaleString("de-DE") : "unbekannten Zeitpunkt"}. Nach einem CCU-Neustart oder Update bitte das Add-on prüfen.`
                    : collectorStatus?.available
                      ? "Das Add-on sendet Systemwerte, Backups, Speicherinfos, Verbindungen und — wenn vorhanden — Logzeilen an diesen Analyzer."
                      : "Das Add-on läuft auf der CCU/RaspberryMatic und sendet Systemwerte, Backups, Verbindungen und Logdaten an diesen Analyzer. Dein PC oder Smartphone spielt dabei keine Rolle."}
                </p>
                <div className="collector-command-panel">
                  <div>
                    <strong>Add-on herunterladen und in der CCU installieren</strong>
                    <span>
                      {collectorStatus?.available && collectorStatus.state !== "stale"
                        ? `Aktuell empfangen: ${collectorStatus.host ?? "Zentrale"} · ${collectorStatus.collectedAt ? new Date(collectorStatus.collectedAt).toLocaleString("de-DE") : "gerade eben"}`
                        : "Die Datei in der CCU unter Einstellungen → Systemsteuerung → Zusatzsoftware hochladen."}
                    </span>
                  </div>
                  <a className="button-link" href={addonDownloadUrl} download>Homematic Analyzer Add-on herunterladen</a>
                  <p className="modal-note">
                    Das Add-on richtet die regelmäßige Übertragung selbst ein und kann über die CCU-Zusatzsoftware wieder entfernt werden.
                  </p>
                  <details className="secondary-details">
                    <summary>Fallback per SSH anzeigen</summary>
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
                  </details>
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
                      <li>Add-on-Datei herunterladen.</li>
                      <li>CCU WebUI öffnen: <code>Einstellungen → Systemsteuerung → Zusatzsoftware</code>.</li>
                      <li>Datei hochladen, installieren und kurz warten.</li>
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
                    <span>Die CCU liefert nur den Gesamt-Duty-Cycle. Geräte-Verursacher werden erst sichtbar, wenn ein AskSin-Sniffer einige Minuten Funktelegramme gemessen hat.</span>
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
              {visibleBackupItems.length === 0 && <p>Keine Backup-Details verfügbar. Bitte CCU Add-on nach dem Update erneut installieren oder den nächsten Lauf abwarten.</p>}
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
