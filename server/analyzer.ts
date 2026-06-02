import type { AnalysisCheck, AnalyzeRequest, CollectorPayload } from "./types.js";

const now = () => new Date().toISOString();

export function createAnalysis(config: AnalyzeRequest, collector?: CollectorPayload): AnalysisCheck[] {
  const hasCcu = Boolean(config.ccuHost && config.ccuUser && config.hasCcuPassword);
  const hasSsh = Boolean((config.sshHost || config.ccuHost || collector?.host) && (config.sshUser || collector));
  const hasSniffer = Boolean(config.snifferPort);
  const hasExternal = Boolean(config.externalSystems?.length);

  const checks: AnalysisCheck[] = [
    {
      id: "ccu-connection",
      title: "Zentrale erreichbar",
      category: "Grundlage",
      status: hasCcu ? "ok" : "unavailable",
      summary: hasCcu
        ? "Die Basisanalyse kann mit den angegebenen CCU-Zugangsdaten starten."
        : "Ohne CCU-Zugang kann die App keine Homematic-Geräte prüfen.",
      recommendation: hasCcu
        ? "Starte die Analyse regelmäßig und ergänze optional SSH für tiefere Belege."
        : "Trage Host, Benutzer und Passwort der CCU oder RaspberryMatic ein.",
      access: ["ccu"],
      evidence: hasCcu
        ? [{ source: "Setup", detail: `CCU-Ziel ${config.ccuHost} wurde angegeben.`, timestamp: now() }]
        : [],
      details: [
        "Über diesen Zugang werden Geräte, Servicemeldungen, Batterien, Duty Cycle und Firmwarestände geprüft.",
        "Passwörter werden in dieser MVP-Version nicht dauerhaft gespeichert."
      ]
    },
    {
      id: "duty-cycle",
      title: "Duty Cycle",
      category: "Funk",
      status: hasCcu ? "warning" : "unavailable",
      summary: hasCcu
        ? "Der Duty Cycle wird geprüft. In dieser Vorschau wird ein Warnzustand simuliert, bis echte CCU-Werte angebunden sind."
        : "Duty Cycle kann ohne CCU-Zugriff nicht belegt werden.",
      recommendation: hasCcu
        ? "Wenn der echte Wert dauerhaft hoch ist: häufig sendende Programme, Geräte mit Störung und externe Abfragen prüfen."
        : "CCU-Zugang einrichten, damit der echte Duty-Cycle-Wert gelesen werden kann.",
      access: ["ccu"],
      evidence: hasCcu
        ? [{ source: "CCU-Schnittstelle", detail: "Platzhalter für belegten Duty-Cycle-Messwert.", timestamp: now() }]
        : [],
      details: [
        "Status wird später direkt aus den CCU-/RaspberryMatic-Daten abgeleitet.",
        "Die Empfehlung wird nur kritisch, wenn ein echter Messwert den Schwellwert überschreitet."
      ]
    },
    {
      id: "batteries",
      title: "Batterien",
      category: "Geräte",
      status: hasCcu ? "ok" : "unavailable",
      summary: hasCcu
        ? "Batteriezustände können aus den Servicemeldungen und Gerätekanälen geprüft werden."
        : "Batteriezustände sind ohne CCU-Zugang nicht verfügbar.",
      recommendation: hasCcu
        ? "Geräte mit niedrigem Batteriestand werden später mit Raum, Name und Beleg angezeigt."
        : "CCU-Zugang einrichten, um niedrige Batterien nachweisbar zu erkennen.",
      access: ["ccu"],
      evidence: hasCcu
        ? [{ source: "Servicemeldungen", detail: "Prüfpunkt aktiviert.", timestamp: now() }]
        : [],
      details: [
        "Keine Vermutung: Ein Hinweis entsteht nur bei LOWBAT-/LOW_BAT-Status oder passender Servicemeldung.",
        "Aufgeklappte Details erklären, welches Gerät betroffen ist und was zu tun ist."
      ]
    },
    {
      id: "signal-strength",
      title: "Signalqualität",
      category: "Funk",
      status: hasCcu || hasSniffer ? "improvement" : "unavailable",
      summary: hasSniffer
        ? "Mit Sniffer können Funktelegramme und schwache Verbindungen genauer eingeordnet werden."
        : hasCcu
          ? "Signalwerte werden aus verfügbaren Geräte-/Kommunikationsdaten abgeleitet, wenn die CCU sie liefert."
          : "Signalqualität braucht CCU-Daten oder optional den AskSin Analyzer XS.",
      recommendation: hasSniffer
        ? "AskSin Analyzer XS verbunden lassen, um Funkprobleme zeitlich besser zuzuordnen."
        : "Für eine tiefere Funkanalyse optional AskSin Analyzer XS anschließen.",
      access: hasSniffer ? ["sniffer"] : ["ccu"],
      evidence: [
        {
          source: hasSniffer ? "Sniffer-Konfiguration" : "Setup",
          detail: hasSniffer ? `USB-Port ${config.snifferPort} angegeben.` : "Sniffer nicht eingerichtet.",
          timestamp: now()
        }
      ],
      details: [
        "Die UI zeigt später normale Begriffe wie „gute Verbindung“, „schwach“ oder „kritisch“.",
        "Technische Werte bleiben auf Wunsch in den Details sichtbar."
      ]
    },
    {
      id: "routing-topology",
      title: "HmIP Routing",
      category: "Topologie",
      status: hasCcu ? "improvement" : "unavailable",
      summary: hasCcu
        ? "Routing-Geräte und aktive Routen werden als verständliche Topologie vorbereitet."
        : "HmIP-Routing kann ohne CCU-Zugang nicht geprüft werden.",
      recommendation: hasCcu
        ? "Router sollten bewusst platziert sein; auffällige Geräte werden mit nachvollziehbarem Beleg markiert."
        : "CCU-Zugang einrichten, um Routing-Informationen auszulesen.",
      access: ["ccu"],
      evidence: hasCcu
        ? [{ source: "CCU-Gerätedaten", detail: "Routing-Prüfung aktiviert.", timestamp: now() }]
        : [],
      details: [
        "Diese Analyse erklärt, welche Geräte als Router dienen und wo Routing aktiv ist.",
        "Ein Problem wird nur markiert, wenn Daten oder Logs es stützen."
      ]
    },
    {
      id: "system-health",
      title: "Raspberry / Zentrale",
      category: "System",
      status: hasSsh ? "ok" : "unavailable",
      summary: hasSsh
        ? "Systemwerte wie RAM, CPU, Temperatur, Speicher und Backups können ausgewertet werden."
        : "Systemwerte brauchen SSH oder das Copy-Paste-Collector-Script.",
      recommendation: hasSsh
        ? "Behalte Temperatur, freien Speicher und Backup-Anzahl im Blick."
        : "SSH einrichten oder das Collector-Script auf der Zentrale ausführen.",
      access: ["ssh"],
      evidence: collector
        ? [{ source: "Collector-Script", detail: `Letzte Daten von ${collector.host ?? "unbekanntem Host"}.`, timestamp: collector.collectedAt ?? now() }]
        : hasSsh
          ? [{ source: "SSH-Setup", detail: `SSH-Ziel ${config.sshHost ?? config.ccuHost} wurde angegeben.`, timestamp: now() }]
          : [],
      details: [
        "Das Script sammelt nur messbare Werte und Logauszüge.",
        "Fehlende Befehle werden toleriert, damit auch CCU2/CCU3/RaspberryMatic möglichst sauber funktionieren."
      ]
    },
    {
      id: "logs",
      title: "Log-Auswertung",
      category: "Belege",
      status: collector?.logs?.length ? "warning" : hasSsh ? "improvement" : "unavailable",
      summary: collector?.logs?.length
        ? "Es liegen Logdaten vor. Auffälligkeiten können belegbar markiert werden."
        : hasSsh
          ? "Loganalyse ist vorbereitet und wartet auf echte Logdaten."
          : "Loganalyse ist ohne SSH oder Collector-Script nicht möglich.",
      recommendation: collector?.logs?.length
        ? "Kommunikationsfehler, Neustarts und Dienstprobleme werden in den Details mit Quelle angezeigt."
        : "Collector-Script ausführen, damit Logbelege in die Analyse einfließen.",
      access: ["ssh"],
      evidence: collector?.logs?.length
        ? collector.logs.slice(0, 5).map((line) => ({ source: "Log", detail: line, timestamp: collector.collectedAt ?? now() }))
        : [],
      details: [
        "Die App soll niemals aus Bauchgefühl urteilen: Jeder Fehler bekommt eine Quelle.",
        "Später werden bekannte Muster wie Kommunikationsstörung, Scriptfehler oder Dienstneustart automatisch gruppiert."
      ]
    },
    {
      id: "external-systems",
      title: "ioBroker / Home Assistant",
      category: "Anbindungen",
      status: hasExternal ? "improvement" : "unavailable",
      summary: hasExternal
        ? "Externe Systeme sind eingetragen und können später auf auffällige Zugriffe geprüft werden."
        : "Keine externen Systeme eingetragen.",
      recommendation: hasExternal
        ? "Bei Lastproblemen werden nur belegbare Hinweise aus Logs, Zugriffszahlen oder Systemlast angezeigt."
        : "Optional ioBroker oder Home Assistant eintragen, wenn sie mit der CCU sprechen.",
      access: ["external"],
      evidence: hasExternal
        ? [{ source: "Setup", detail: `Eingetragen: ${config.externalSystems?.join(", ")}`, timestamp: now() }]
        : [],
      details: [
        "Ziel ist: sichtbar machen, ob externe Systeme sehr häufig lesen oder schreiben.",
        "Ohne Beleg bleibt der Punkt neutral."
      ]
    },
    {
      id: "notifications",
      title: "Telegram Hinweise",
      category: "Benachrichtigung",
      status: config.telegramEnabled ? "ok" : "improvement",
      summary: config.telegramEnabled
        ? "Telegram-Benachrichtigungen sind für kritische Ereignisse vorgesehen."
        : "Telegram ist optional und noch nicht eingerichtet.",
      recommendation: "Sinnvolle Events: Duty Cycle kritisch, Batterie niedrig, Gerät nicht erreichbar, Konfiguration ausstehend, Sniffer getrennt, neue Releases.",
      access: ["telegram"],
      evidence: config.telegramEnabled
        ? [{ source: "Setup", detail: "Telegram aktiviert.", timestamp: now() }]
        : [],
      details: [
        "Benachrichtigungen sollten selten und relevant sein.",
        "Jede Meldung enthält den Grund und den Beleg, nicht nur einen Alarmtext."
      ]
    }
  ];

  return checks;
}
