import { FormEvent, useEffect, useMemo, useState } from "react";

type CheckStatus = "ok" | "improvement" | "warning" | "critical" | "unavailable";

type Evidence = {
  source: string;
  detail: string;
  timestamp?: string;
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

const appVersion = "0.1.0";
const repositoryUrl = "https://github.com/Schello805/homematic-analyzer";
const latestReleaseApiUrl = "https://api.github.com/repos/Schello805/homematic-analyzer/releases/latest";
const commitsApiUrl = "https://api.github.com/repos/Schello805/homematic-analyzer/commits?per_page=1";

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
        const releaseResponse = await fetch(latestReleaseApiUrl);

        if (releaseResponse.ok) {
          const release = (await releaseResponse.json()) as { tag_name?: string; html_url?: string; name?: string };
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
      } catch {
        if (!isActive) return;

        setUpdateStatus({
          state: "unknown",
          label: "Update-Check nicht möglich",
          detail: "GitHub konnte gerade nicht geprüft werden. Die App funktioniert trotzdem.",
          url: repositoryUrl
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

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ccuHost: form.ccuHost.trim(),
          ccuUser: form.ccuUser.trim(),
          hasCcuPassword: Boolean(form.ccuPassword),
          sshHost: form.sshHost.trim() || form.ccuHost.trim(),
          sshUser: form.sshUser.trim(),
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
      setAnalysis(data);
      setActiveCheck(data.checks[0]?.id ?? null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <section className="hero">
        <div className="hero__content">
          <p className="eyebrow">Homematic Analyzer</p>
          <h1>Ein großer Analyse-Button. Klare Belege. Verständliche Empfehlungen.</h1>
          <p className="hero__text">
            Die App prüft dein Homematic-Smarthome modular: mit CCU-Zugang gibt es die Basisanalyse,
            mit SSH kommen Logs und Systemwerte dazu, mit AskSin Analyzer XS die Funk-Tiefenanalyse.
          </p>
          <div className="hero__badges">
            <span>Keine geratenen Fehler</span>
            <span>Sniffer optional</span>
            <span>Normaluser-freundlich</span>
          </div>
        </div>
        <div className="hero__card">
          <strong>Prinzip</strong>
          <p>Was nicht belegt werden kann, wird nicht als Problem behauptet. Fehlender Zugriff wird transparent angezeigt.</p>
        </div>
      </section>

      <form className="setup" onSubmit={runAnalysis}>
        <section className="panel">
          <div className="panel__header">
            <p className="eyebrow">Setup</p>
            <h2>Zugänge eintragen</h2>
            <p>Alles ist optional erweiterbar: je mehr Zugriff du gibst, desto genauer wird die Analyse.</p>
          </div>

          <div className="form-grid">
            <label>
              CCU / RaspberryMatic Host
              <input value={form.ccuHost} onChange={(event) => setForm({ ...form, ccuHost: event.target.value })} placeholder="192.168.178.50" />
            </label>
            <label>
              CCU Benutzer
              <input value={form.ccuUser} onChange={(event) => setForm({ ...form, ccuUser: event.target.value })} placeholder="Admin" />
            </label>
            <label>
              CCU Passwort
              <input type="password" value={form.ccuPassword} onChange={(event) => setForm({ ...form, ccuPassword: event.target.value })} placeholder="Wird nicht gespeichert" />
            </label>
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
            <label>
              AskSin Analyzer XS USB-Port
              <input value={form.snifferPort} onChange={(event) => setForm({ ...form, snifferPort: event.target.value })} placeholder="/dev/ttyUSB0" />
            </label>
            <label>
              Externe Systeme
              <input value={form.externalSystems} onChange={(event) => setForm({ ...form, externalSystems: event.target.value })} placeholder="ioBroker, Home Assistant" />
            </label>
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
        <div>
          <p className="eyebrow">Copy & Paste</p>
          <h2>Collector-Script für RaspberryMatic / CCU</h2>
          <p>
            Das Script sammelt messbare Systemwerte, Backup-Anzahl und relevante Logzeilen und sendet sie an den Analyzer.
          </p>
        </div>
        <pre><code>{`curl -fsSL "${scriptUrl}" | sh`}</code></pre>
        <p className="hint">
          Für Proxmox folgt später eine eigene Schritt-für-Schritt-Anleitung zur USB-Durchreichung. Priorität bleibt Raspberry.
        </p>
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
