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

const appVersion = "0.1.0";
const repositoryUrl = "https://github.com/Schello805/Homematic-Analyzer";
const releasesApiUrl = "https://api.github.com/repos/Schello805/Homematic-Analyzer/releases?per_page=1";
const commitsApiUrl = "https://api.github.com/repos/Schello805/Homematic-Analyzer/commits?per_page=1";

const statusLabel: Record<CheckStatus, string> = {
  ok: "OK",
  improvement: "Verbesserung",
  warning: "Hinweis",
  critical: "Kritisch",
  unavailable: "Nicht möglich"
};

const statusOrder: CheckStatus[] = ["critical", "warning", "improvement", "ok", "unavailable"];

const initialForm = {
  ccuHost: "",
  ccuUser: "",
  ccuPassword: "",
  sshHost: "",
  sshUser: "",
  sshPassword: "",
  snifferPort: "",
  telegramEnabled: false,
  externalSystems: ""
};

function App() {
  const [form, setForm] = useState(initialForm);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeCheck, setActiveCheck] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    state: "checking",
    label: "Update wird geprüft",
    detail: "GitHub wird nach der neuesten Version gefragt.",
    url: repositoryUrl
  });

  const scriptUrl = useMemo(() => {
    const baseUrl = typeof window === "undefined" ? "http://127.0.0.1:3001" : window.location.origin.replace("5173", "3001");
    const params = new URLSearchParams({
      url: baseUrl,
      token: "homematic-analyzer-demo-token"
    });
    return `${baseUrl}/api/collector/script?${params.toString()}`;
  }, []);

  const ccuMasterdataScriptUrl = useMemo(() => {
    const baseUrl = typeof window === "undefined" ? "http://127.0.0.1:3001" : window.location.origin.replace("5173", "3001");
    const params = new URLSearchParams({
      url: baseUrl,
      token: "homematic-analyzer-demo-token"
    });
    return `${baseUrl}/api/ccu-masterdata/script?${params.toString()}`;
  }, []);

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

  const groupedChecks = useMemo(() => {
    if (!analysis) return [];

    return statusOrder
      .map((status) => ({
        status,
        checks: analysis.checks.filter((check) => check.status === status)
      }))
      .filter((group) => group.checks.length > 0);
  }, [analysis]);

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
    let isActive = true;

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

    void checkForUpdates();

    return () => {
      isActive = false;
    };
  }, []);

  async function runAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setAnalysis(null);
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
          hasCcuPassword: Boolean(form.ccuPassword),
          sshHost: form.sshHost.trim() || form.ccuHost.trim(),
          sshUser: form.sshUser.trim(),
          sshPassword: form.sshPassword,
          hasSshPassword: Boolean(form.sshPassword),
          snifferPort: form.snifferPort.trim(),
          telegramEnabled: form.telegramEnabled,
          externalSystems: form.externalSystems
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
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
    try {
      await navigator.clipboard.writeText(`curl -fsSL "${scriptUrl}" | sh`);
      showToast({
        type: "success",
        title: "Befehl kopiert",
        message: "Du kannst ihn jetzt auf der Zentrale einfügen."
      });
    } catch {
      showToast({
        type: "warning",
        title: "Kopieren nicht möglich",
        message: "Markiere den Befehl bitte manuell und kopiere ihn."
      });
    }
  }

  async function copyCcuMasterdataScript() {
    try {
      const response = await fetch(ccuMasterdataScriptUrl);

      if (!response.ok) {
        throw new Error("Script konnte nicht geladen werden.");
      }

      await navigator.clipboard.writeText(await response.text());
      showToast({
        type: "success",
        title: "CCU-Script kopiert",
        message: "In der WebUI als Programm-Script einfügen und täglich ausführen lassen."
      });
    } catch {
      showToast({
        type: "warning",
        title: "Kopieren nicht möglich",
        message: "Öffne den Script-Link und kopiere den Inhalt manuell."
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

      <form className="setup" onSubmit={runAnalysis}>
        <section className="panel">
          <div className="panel__header">
            <p className="eyebrow">Setup</p>
            <h2>Zugänge eintragen</h2>
            <p>Alles ist optional: je mehr Zugriff du gibst, desto genauer wird die Analyse.</p>
            <p className="setup-note">CCU-Daten werden aktuell über die XML-API gelesen. Passwörter werden nicht gespeichert.</p>
          </div>

          <div className="setup-sections">
            <fieldset className="setup-card">
              <legend>CCU / RaspberryMatic Login</legend>
              <p>Pflicht für Geräte, Servicemeldungen, Batterien, Duty Cycle und XML-API-Prüfung.</p>
              <p className="security-note">Bitte keine öffentliche CCU-Adresse oder Portweiterleitung verwenden. Von außen besser per VPN verbinden.</p>
              <div className="form-grid form-grid-3">
                <label>
                  Host oder IP
                  <input value={form.ccuHost} onChange={(event) => setForm({ ...form, ccuHost: event.target.value })} placeholder="192.168.178.50" />
                </label>
                <label>
                  Benutzer
                  <input value={form.ccuUser} onChange={(event) => setForm({ ...form, ccuUser: event.target.value })} placeholder="Admin" />
                </label>
                <label>
                  Passwort
                  <input type="password" value={form.ccuPassword} onChange={(event) => setForm({ ...form, ccuPassword: event.target.value })} placeholder="Wird nicht gespeichert" />
                </label>
              </div>
            </fieldset>

            <fieldset className="setup-card setup-card-optional">
              <legend>SSH Login</legend>
              <p>Optional für Logs, CPU/RAM, Temperatur, Speicher und Backups.</p>
              <div className="form-grid form-grid-3">
                <label>
                  SSH Host
                  <input value={form.sshHost} onChange={(event) => setForm({ ...form, sshHost: event.target.value })} placeholder="leer = CCU Host" />
                </label>
                <label>
                  SSH Benutzer
                  <input value={form.sshUser} onChange={(event) => setForm({ ...form, sshUser: event.target.value })} placeholder="root" />
                </label>
                <label>
                  SSH Passwort
                  <input type="password" value={form.sshPassword} onChange={(event) => setForm({ ...form, sshPassword: event.target.value })} placeholder="Optional" />
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
              <div className="form-grid form-grid-2">
                <label>
                  AskSin Analyzer XS USB-Port
                  <input value={form.snifferPort} onChange={(event) => setForm({ ...form, snifferPort: event.target.value })} placeholder="/dev/ttyUSB0" />
                </label>
                <label>
                  Externe Systeme
                  <input value={form.externalSystems} onChange={(event) => setForm({ ...form, externalSystems: event.target.value })} placeholder="ioBroker, Home Assistant" />
                </label>
              </div>
            </fieldset>
          </div>

          <label className="toggle">
            <input type="checkbox" checked={form.telegramEnabled} onChange={(event) => setForm({ ...form, telegramEnabled: event.target.checked })} />
            <span>Telegram-Benachrichtigungen für kritische Events vorbereiten</span>
          </label>

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
              Nur nötig, wenn zusätzlich CPU, RAM, Temperatur, Speicher, Backups oder Logs vom Raspberry geprüft werden sollen.
            </p>
            <div className="script-box">
              <pre><code>{`curl -fsSL "${scriptUrl}" | sh`}</code></pre>
              <button type="button" onClick={() => void copyCollectorCommand()}>
                Kopieren
              </button>
            </div>
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

          <div className="summary-grid">
            {statusOrder.map((status) => (
              <div className={`summary-card status-${status}`} key={status}>
                <strong>{summary[status]}</strong>
                <span>{statusLabel[status]}</span>
              </div>
            ))}
          </div>

          <div className="check-layout">
            <div className="check-list">
              {groupedChecks.map((group) => (
                <div key={group.status}>
                  <h3>{statusLabel[group.status]}</h3>
                  {group.checks.map((check) => (
                    <button
                      type="button"
                      className={`check-item status-${check.status} ${activeCheck === check.id ? "is-active" : ""}`}
                      onClick={() => setActiveCheck(check.id)}
                      key={check.id}
                    >
                      <span>{check.title}</span>
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
                      <span className={`pill status-${check.status}`}>{statusLabel[check.status]}</span>
                      <h3>{check.title}</h3>
                    </div>
                    <p className="lead">{check.summary}</p>
                    <h4>Empfehlung</h4>
                    <p>{check.recommendation}</p>
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
