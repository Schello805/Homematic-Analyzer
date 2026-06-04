import { FormEvent, useEffect, useMemo, useState } from "react";

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
  checks: AnalysisCheck[];
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

type UpdateStatus = {
  state: "checking" | "current" | "update" | "unknown";
  label: string;
  detail: string;
  url: string;
};

type Toast = {
  id: number;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message?: string;
};

type MasterdataStatus = {
  available: boolean;
  collectedAt?: string;
  deviceCount: number;
};

type SetupDefaults = Partial<Pick<SetupForm, "ccuHost" | "ccuUser" | "xmlApiToken" | "snifferPort">>;

type CollectorStatus = {
  available: boolean;
  collectedAt?: string;
  host?: string;
  logs: number;
  connections: number;
};

const appVersion = "0.1.0";
const repositoryUrl = "https://github.com/Schello805/Homematic-Analyzer";
const releasesApiUrl = "https://api.github.com/repos/Schello805/Homematic-Analyzer/releases?per_page=1";
const commitsApiUrl = "https://api.github.com/repos/Schello805/Homematic-Analyzer/commits?per_page=1";
const setupStorageKey = "homematic-analyzer.setup.v1";

const statusLabel: Record<CheckStatus, string> = {
  ok: "OK",
  improvement: "Verbesserung",
  warning: "Hinweis",
  critical: "Kritisch",
  unavailable: "Nicht möglich"
};

const statusOrder: CheckStatus[] = ["critical", "warning", "improvement", "ok", "unavailable"];

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
  snifferPort: ""
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
    return {
      ccuHost: parsedSetup.ccuHost ?? "",
      ccuUser: parsedSetup.ccuUser ?? "",
      ccuPassword: parsedSetup.ccuPassword ?? "",
      xmlApiToken: parsedSetup.xmlApiToken ?? "",
      sshUser: parsedSetup.sshUser ?? "root",
      sshPassword: parsedSetup.sshPassword ?? "",
      snifferPort: parsedSetup.snifferPort ?? ""
    };
  } catch {
    return initialForm;
  }
}

function getApiBaseUrl() {
  if (typeof window === "undefined") return "http://127.0.0.1:3001";

  const { protocol, hostname, port, origin } = window.location;
  if (port === "5173") return `${protocol}//${hostname}:3001`;
  return origin;
}

function App() {
  const [form, setForm] = useState<SetupForm>(loadSavedSetup);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(initialNotificationSettings);
  const [currentPage, setCurrentPage] = useState<"analysis" | "settings">("analysis");
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeCheck, setActiveCheck] = useState<string | null>(null);
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<CheckStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ccuScriptPreview, setCcuScriptPreview] = useState("");
  const [collectorCommandPreview, setCollectorCommandPreview] = useState("");
  const [masterdataStatus, setMasterdataStatus] = useState<MasterdataStatus | null>(null);
  const [collectorStatus, setCollectorStatus] = useState<CollectorStatus | null>(null);
  const [collectorMode, setCollectorMode] = useState<"once" | "install" | "uninstall">("once");
  const [collectorInterval, setCollectorInterval] = useState<"daily" | "hourly">("daily");
  const [savingSettings, setSavingSettings] = useState(false);
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    state: "checking",
    label: "Update wird geprüft",
    detail: "GitHub wird nach der neuesten Version gefragt.",
    url: repositoryUrl
  });

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

  const collectorCommand = useMemo(() => `curl -fsSL "${scriptUrl}" | sh`, [scriptUrl]);

  const usesLocalAnalyzerUrl = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
  }, []);

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
      window.localStorage.setItem(setupStorageKey, JSON.stringify(nextForm));
    } catch {
      showToast({
        type: "warning",
        title: "Speichern nicht möglich",
        message: "Der Browser lässt lokale Speicherung gerade nicht zu."
      });
    }
  }

  function toggleSecret(name: string) {
    setVisibleSecrets((current) => ({ ...current, [name]: !current[name] }));
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

      if (!response.ok) throw new Error("Settings konnten nicht gespeichert werden.");
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
        title: "Settings gespeichert",
        message: "Settings wurden dauerhaft in der lokalen Datenbank gespeichert."
      });
    } catch {
      showToast({
        type: "error",
        title: "Settings nicht gespeichert",
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
        message: "Bitte Settings und lokale API prüfen."
      });
    }
  }

  function resetNotificationSettings() {
    setNotificationSettings(initialNotificationSettings);
    showToast({
      type: "info",
      title: "Benachrichtigungen zurückgesetzt",
      message: "Klicke Speichern, um die serverseitigen Settings ebenfalls zurückzusetzen."
    });
  }

  function resetSavedSetup() {
    setForm(initialForm);
    try {
      window.localStorage.removeItem(setupStorageKey);
    } catch {
    }
    showToast({
      type: "info",
      title: "Zugangsdaten gelöscht",
      message: "Die gespeicherten Eingaben wurden aus diesem Browser entfernt."
    });
  }

  const groupedChecks = useMemo(() => {
    if (!analysis) return [];

    const base = statusOrder
      .map((status) => ({
        status,
        checks: analysis.checks.filter((check) => check.status === status)
      }))
      .filter((group) => group.checks.length > 0);

    if (selectedStatusFilter) {
      return base.filter((group) => group.status === selectedStatusFilter);
    }
    return base;
  }, [analysis, selectedStatusFilter]);

  const summary = useMemo(() => {
    if (!analysis) return null;

    return analysis.checks.reduce<Record<CheckStatus, number>>(
      (accumulator, check) => {
        accumulator[check.status] += 1;
        return accumulator;
      },
      { ok: 0, improvement: 0, warning: 0, critical: 0, unavailable: 0 }
    );
  }, [analysis]);

  useEffect(() => {
    if (!analysis) return;

    const visibleChecks = selectedStatusFilter
      ? analysis.checks.filter((check) => check.status === selectedStatusFilter)
      : analysis.checks;

    if (visibleChecks.length > 0) {
      const isActiveVisible = visibleChecks.some((check) => check.id === activeCheck);
      if (!isActiveVisible) {
        setActiveCheck(visibleChecks[0].id);
      }
    } else {
      setActiveCheck(null);
    }
  }, [selectedStatusFilter, analysis, activeCheck]);

  useEffect(() => {
    let isActive = true;

    async function loadSetupDefaults() {
      try {
        if (window.localStorage.getItem(setupStorageKey)) return;

        const response = await fetch("/api/setup/defaults");
        if (!response.ok) return;

        const defaults = (await response.json()) as SetupDefaults;
        if (!isActive || Object.keys(defaults).length === 0) return;

        setForm((currentForm) => {
          const nextForm = {
            ...currentForm,
            ccuHost: currentForm.ccuHost || defaults.ccuHost || "",
            ccuUser: currentForm.ccuUser || defaults.ccuUser || "",
            xmlApiToken: currentForm.xmlApiToken || defaults.xmlApiToken || "",
            snifferPort: currentForm.snifferPort || defaults.snifferPort || ""
          };
          try {
            window.localStorage.setItem(setupStorageKey, JSON.stringify(nextForm));
          } catch {
          }
          return nextForm;
        });
        showToast({
          type: "success",
          title: "Setup übernommen",
          message: "Installer-Vorgaben wurden aus der lokalen Datenbank geladen."
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
      try {
        const releaseResponse = await fetch(releasesApiUrl);

        if (releaseResponse.ok) {
          const releases = (await releaseResponse.json()) as Array<{ tag_name?: string; html_url?: string; name?: string }>;
          const release = releases[0];

          if (!release) {
            throw new Error("Noch keine Release-Version vorhanden");
          }

          const latestVersion = release.tag_name?.replace(/^v/i, "");

          if (!latestVersion) {
            throw new Error("Release ohne Versionsnummer");
          }

          if (!isActive) return;

          setUpdateStatus({
            state: latestVersion === appVersion ? "current" : "update",
            label: latestVersion === appVersion ? "Aktuell" : "Update verfügbar",
            detail:
              latestVersion === appVersion
                ? `Installierte Version ${appVersion} ist die neueste Release-Version.`
                : `Installiert: ${appVersion}. Neu auf GitHub: ${release.tag_name}${release.name ? ` (${release.name})` : ""}.`,
            url: release.html_url ?? repositoryUrl
          });
          if (latestVersion !== appVersion) {
            showToast({
              type: "warning",
              title: "Update verfügbar",
              message: `Auf GitHub liegt ${release.tag_name}.`
            });
          }
          return;
        }

        const commitResponse = await fetch(commitsApiUrl);

        if (!commitResponse.ok) {
          throw new Error("GitHub nicht erreichbar");
        }

        const commits = (await commitResponse.json()) as Array<{ html_url?: string; sha?: string; commit?: { message?: string; author?: { date?: string } } }>;
        const latestCommit = commits[0];

        if (!isActive) return;

        setUpdateStatus({
          state: "unknown",
          label: "Keine Release-Version gefunden",
          detail: latestCommit?.commit?.author?.date
            ? `Letzter Repository-Stand: ${new Date(latestCommit.commit.author.date).toLocaleDateString("de-DE")}.`
            : "Das Repository ist erreichbar, aber es gibt noch keine Release-Version zum Vergleichen.",
          url: latestCommit?.html_url ?? repositoryUrl
        });
        showToast({
          type: "info",
          title: "Update-Check erledigt",
          message: "Repository erreichbar, aber noch ohne Release-Version."
        });
      } catch {
        if (!isActive) return;

        setUpdateStatus({
          state: "unknown",
          label: "Update-Check nicht möglich",
          detail: "GitHub konnte gerade nicht geprüft werden. Die App funktioniert trotzdem.",
          url: repositoryUrl
        });
        showToast({
          type: "warning",
          title: "Update-Check nicht möglich",
          message: "GitHub konnte gerade nicht geprüft werden."
        });
      }
    }

    void loadSetupDefaults();
    void loadNotificationSettings();
    void checkForUpdates();

    return () => {
      isActive = false;
    };
  }, []);

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

  async function runAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setSelectedStatusFilter(null);
    showToast({
      type: "info",
      title: "Analyse gestartet",
      message: form.ccuHost.trim() ? "CCU, XML-API und verfügbare Zusatzdaten werden geprüft." : "Ohne CCU-Zugang werden nur mögliche Prüfpunkte vorbereitet."
    });

    try {
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
          snifferPort: form.snifferPort.trim(),
          externalSystems: [],
          notificationSettings
        })
      });

      if (!response.ok) {
        throw new Error("Die Analyse konnte nicht gestartet werden.");
      }

      const data = (await response.json()) as AnalysisResponse;
      const criticalCount = data.checks.filter((check) => check.status === "critical").length;
      const unavailableCount = data.checks.filter((check) => check.status === "unavailable").length;
      setAnalysis(data);
      setActiveCheck(data.checks[0]?.id ?? null);
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

      <section className="hero">
        <div className="hero__content">
          <p className="eyebrow">Homematic Analyzer</p>
          <h1>Smarthome prüfen. Belegbar. Verständlich.</h1>
          <p className="hero__text">
            Eine Analyse für Homematic-Installationen — ohne Rätselraten, mit klaren Handlungsempfehlungen.
          </p>
          <div className="hero__badges">
            <span>Belege statt Vermutungen</span>
            <span>Sniffer optional</span>
          </div>
        </div>
        <div className="hero__card">
          <span className="hero__status">MVP</span>
          <strong>Je mehr Zugriff, desto genauer.</strong>
          <p>CCU reicht für den Start. SSH, Collector und AskSin Analyzer XS liefern mehr Details.</p>
        </div>
      </section>

      <nav className="page-tabs" aria-label="Bereiche">
        <button type="button" className={currentPage === "analysis" ? "is-active" : ""} onClick={() => setCurrentPage("analysis")}>
          Analyse
        </button>
        <button type="button" className={currentPage === "settings" ? "is-active" : ""} onClick={() => setCurrentPage("settings")}>
          Settings
        </button>
      </nav>

      {currentPage === "analysis" && (
        <>
      <form className="setup" onSubmit={runAnalysis}>
        <section className="panel">
          <div className="panel__header">
            <p className="eyebrow">Setup</p>
            <h2>Zugänge eintragen</h2>
            <p>Alles ist optional: je mehr Zugriff du gibst, desto genauer wird die Analyse.</p>
            <p className="setup-note">Zugangsdaten werden lokal in diesem Browser gespeichert. Die CCU bleibt im LAN oder VPN.</p>
            <button type="button" className="ghost-button" onClick={resetSavedSetup}>
              Gespeicherte Daten löschen
            </button>
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
            </fieldset>

            <fieldset className="setup-card setup-card-optional">
              <legend>SSH Login</legend>
              <p>Optional für Logs, CPU/RAM, Temperatur, Speicher und Backups. Host ist automatisch die CCU-IP.</p>
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
              <p>Nur ausfüllen, wenn vorhanden.</p>
              <div className="form-grid form-grid-1">
                <label>
                  AskSin Analyzer XS USB-Port
                  <input value={form.snifferPort} onChange={(event) => updateForm({ ...form, snifferPort: event.target.value })} placeholder="/dev/ttyUSB0" />
                </label>
              </div>
            </fieldset>
          </div>

          <button className="analyze-button" disabled={loading}>
            {loading ? "Analyse läuft ..." : "Analyse starten"}
          </button>
          {error && <p className="error">{error}</p>}
        </section>
      </form>

      <section className="collector panel">
        <details>
          <summary>
            <span>
              <small>Einmaliges Setup</small>
              CCU-Stammdaten täglich melden
            </span>
            <strong>Script anzeigen</strong>
          </summary>
          <div className="setup-script-content">
            <p>
              Dieses WebUI-Script legt die Variablen `HomematicAnalyzer_LastRun`, `HomematicAnalyzer_Status`,
              `HomematicAnalyzer_DeviceInventory` und `HomematicAnalyzer_Error` an und sendet Gerätenamen,
              Adressen und Typen täglich an den Analyzer.
            </p>
            <p className={`setup-note ${masterdataStatus?.available ? "setup-note-ok" : ""}`}>
              {masterdataStatus?.available
                ? `Empfangen: ${masterdataStatus.deviceCount} Geräte, zuletzt ${masterdataStatus.collectedAt ? new Date(masterdataStatus.collectedAt).toLocaleString("de-DE") : "gerade eben"}.`
                : "Noch keine CCU-Stammdaten empfangen."}
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
              <li>Programm erstellen, z. B. täglich nachts ausführen.</li>
              <li>Als Aktion `Script` wählen und den kopierten Inhalt einfügen.</li>
              <li>Einmal manuell ausführen; danach stört es nicht mehr.</li>
            </ol>
          </div>
        </details>

        <details className="secondary-details">
          <summary>
            <span>
              <small>Optional</small>
              Systemwerte per Shell sammeln
            </span>
            <strong>Details</strong>
          </summary>
          <div className="setup-script-content">
            <p>
              Nur nötig, wenn zusätzlich CPU, RAM, Temperatur, Speicher, Backups, Logs oder aktive CCU-Verbindungen geprüft werden sollen.
            </p>
            <p className={`setup-note ${collectorStatus?.available ? "setup-note-ok" : ""}`}>
              {collectorStatus?.available
                ? `Empfangen: ${collectorStatus.host ?? "Zentrale"}, zuletzt ${collectorStatus.collectedAt ? new Date(collectorStatus.collectedAt).toLocaleString("de-DE") : "gerade eben"} · ${collectorStatus.logs} Logzeilen · ${collectorStatus.connections} Verbindungen.`
                : "Noch kein System-Snapshot empfangen. Einmalig ausführen oder regelmäßige Übertragung einrichten."}
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
                  <option value="daily">Täglich nachts</option>
                  <option value="hourly">Stündlich</option>
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
              Einmalig sendet nur einen Snapshot. „Regelmäßig einrichten“ legt auf der Zentrale einen Cronjob an, der die Daten automatisch erneut überträgt.
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

      {analysis && summary && (
        <section className="results">
          <div className="results__header">
            <div>
              <p className="eyebrow">Ergebnis</p>
              <h2>Analyse vom {new Date(analysis.generatedAt).toLocaleString("de-DE")}</h2>
            </div>
            <div className="score">
              <strong>{analysis.checks.length}</strong>
              <span>Prüfpunkte</span>
            </div>
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
                    const firstMatchingCheck = analysis.checks.find((check) => check.status === status);
                    if (firstMatchingCheck) {
                      setActiveCheck(firstMatchingCheck.id);
                    }
                  }}
                  aria-pressed={isActive}
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

          <div className="check-layout">
            <div className="check-list">
              {groupedChecks.map((group) => (
                <div key={group.status} className="check-group">
                  <h3>{statusLabel[group.status]}</h3>
                  {group.checks.map((check) => (
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
                  ))}
                </div>
              ))}
            </div>

            <div className="check-detail">
              {analysis.checks
                .filter((check) => check.id === activeCheck)
                .map((check) => (
                  <article key={check.id}>
                    <div className="detail-title">
                      <span className={`pill status-${check.status}`}>
                        {getStatusIcon(check.status, "status-icon-inline")}
                        {statusLabel[check.status]}
                      </span>
                      <h3>{check.title}</h3>
                    </div>
                    <p className="lead">{check.summary}</p>
                    
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
                            <strong>{item.source}</strong>
                            <span>{item.detail}</span>
                            {item.url && (
                              <a href={item.url} target="_blank" rel="noreferrer">
                                Anleitung öffnen
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">Noch kein Beleg verfügbar. Deshalb wird hier kein Fehler behauptet.</p>
                    )}
                    <h4>Details</h4>
                    <ul>
                      {check.details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  </article>
                ))}
            </div>
          </div>
        </section>
      )}
        </>
      )}

      {currentPage === "settings" && (
        <section className="panel settings-page">
          <div className="panel__header">
            <p className="eyebrow">Settings</p>
            <h2>Benachrichtigungen</h2>
            <p>Telegram, E-Mail und KI-Settings werden serverseitig in der lokalen Analyzer-Datenbank gespeichert und bei jeder Analyse verwendet.</p>
            <p className="setup-note">Für lokale Nutzung okay. Für öffentliche Deployments später bitte verschlüsselte Secret-Verwaltung nutzen.</p>
            <div className="script-actions">
              <button type="button" onClick={() => void saveNotificationSettings()} disabled={savingSettings}>
                {savingSettings ? "Speichert ..." : "Settings speichern"}
              </button>
              <button type="button" className="light-button" onClick={resetNotificationSettings}>
                Zurücksetzen
              </button>
            </div>
          </div>

          <div className="settings-grid">
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
          </div>
        </section>
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
      </footer>
    </main>
  );
}

export default App;
