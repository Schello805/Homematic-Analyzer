import type { AnalysisCheck, CheckStatus, CollectorPayload, NotificationSettings } from "./types.js";

type AiLogResponse = {
  severity?: CheckStatus;
  summary?: string;
  recommendation?: string;
  evidence?: string[];
  details?: string[];
};

export type AiLogMode = "issues" | "full";

const defaultOpenAiModel = "gpt-4o-mini";
const defaultGeminiModel = "gemini-1.5-flash";
const allowedStatuses = new Set<CheckStatus>(["ok", "improvement", "warning", "critical", "unavailable"]);
const maxAiLogLines = 500;
const maxAiLogCharacters = 120000;
const issuePattern = /\b(error|errors|warn|warning|fatal|critical|failed|failure|exception|timeout|unreach|unreachable|lowbat|low battery|not reachable|communication error|config pending|overheat|corrupt|denied)\b|fehler|warnung|kritisch|gestört|störung|nicht erreichbar|batterie schwach|konfiguration ausstehend/i;

export function prepareLogLines(logs: string[], mode: AiLogMode) {
  const cleanedLines = logs
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(-maxAiLogLines)
    .map((line) => line.slice(0, 1000));
  const selectedLines = mode === "issues"
    ? cleanedLines.filter((line) => issuePattern.test(line))
    : cleanedLines;
  const limitedLines: string[] = [];
  let characterCount = 0;

  for (const line of selectedLines.slice().reverse()) {
    if (characterCount + line.length > maxAiLogCharacters) break;
    limitedLines.push(line);
    characterCount += line.length;
  }

  return {
    totalLines: cleanedLines.length,
    matchedLines: selectedLines.length,
    lines: limitedLines.reverse(),
    truncated: limitedLines.length < selectedLines.length
  };
}

function buildPrompt(logLines: string[], mode: AiLogMode, totalLines: number) {
  return [
    "Du bist ein vorsichtiger Homematic/RaspberryMatic Log-Analyst.",
    "Analysiere ausschließlich die folgenden Logzeilen.",
    "Erfinde keine Ursachen, Geräte oder Lösungen, die nicht durch die Logzeilen belegt sind.",
    mode === "issues"
      ? `Die Zeilen wurden aus ${totalLines} übertragenen Logzeilen auf mögliche Fehler und Warnungen vorgefiltert.`
      : `Dies ist der vollständige vom Collector übertragene Logauszug mit ${totalLines} Zeilen.`,
    "Antworte nur als JSON mit diesen Feldern:",
    "{ \"severity\": \"ok|improvement|warning|critical\", \"summary\": string, \"recommendation\": string, \"evidence\": string[], \"details\": string[] }",
    "Schreibe für normale Anwender verständlich und kurz.",
    "",
    "Logzeilen:",
    logLines.map((line, index) => `${index + 1}. ${line}`).join("\n")
  ].join("\n");
}

function parseJsonObject(text: string): AiLogResponse {
  const cleanedText = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const start = cleanedText.indexOf("{");
  const end = cleanedText.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("KI-Antwort enthielt kein JSON-Objekt.");
  }

  return JSON.parse(cleanedText.slice(start, end + 1)) as AiLogResponse;
}

function normalizeAiResult(
  result: AiLogResponse,
  collector: CollectorPayload,
  mode: AiLogMode,
  totalLines: number,
  analyzedLines: number,
  truncated: boolean
): AnalysisCheck {
  const status = result.severity && allowedStatuses.has(result.severity) ? result.severity : "improvement";
  const evidence = Array.isArray(result.evidence) ? result.evidence.filter(Boolean).slice(0, 8) : [];
  const details = Array.isArray(result.details) ? result.details.filter(Boolean).slice(0, 8) : [];

  return {
    id: "ai-log-analysis",
    title: "KI-Logauswertung",
    category: "Belege",
    status,
    summary: result.summary?.trim() || "Die KI hat Logzeilen geprüft, aber keine klare Kurzfassung geliefert.",
    recommendation: result.recommendation?.trim() || "Prüfe die genannten Logbelege manuell, bevor du Änderungen vornimmst.",
    access: ["ssh"],
    evidence: evidence.map((detail) => ({
      source: "KI-Loganalyse",
      detail,
      timestamp: collector.collectedAt
    })),
    details: [
      `Analysiert: ${analyzedLines} von ${totalLines} übertragenen Logzeilen · Modus: ${mode === "issues" ? "Nur Fehler und Warnungen" : "Gesamter übertragener Log"}.`,
      ...(truncated ? ["Der Auszug wurde wegen der maximalen KI-Eingabegröße gekürzt; die neuesten passenden Zeilen wurden berücksichtigt."] : []),
      ...(details.length > 0
        ? details
        : ["Die KI-Auswertung basiert nur auf den übermittelten Logzeilen.", "Sie ersetzt keine belegte Analyse, sondern übersetzt Logmeldungen in verständliche Hinweise."])
    ].slice(0, 10)
  };
}

async function analyzeWithOpenAi(settings: Required<NonNullable<NotificationSettings["ai"]>>, prompt: string): Promise<AiLogResponse> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.openaiApiKey}`
    },
    body: JSON.stringify({
      model: settings.openaiModel || defaultOpenAiModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Du antwortest ausschließlich mit gültigem JSON." },
        { role: "user", content: prompt }
      ],
      temperature: 0.1
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API Fehler ${response.status}`);
  }

  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI lieferte keine auswertbare Antwort.");

  return parseJsonObject(content);
}

async function analyzeWithGemini(settings: Required<NonNullable<NotificationSettings["ai"]>>, prompt: string): Promise<AiLogResponse> {
  const model = encodeURIComponent(settings.geminiModel || defaultGeminiModel);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(settings.geminiApiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API Fehler ${response.status}`);
  }

  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const content = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();
  if (!content) throw new Error("Gemini lieferte keine auswertbare Antwort.");

  return parseJsonObject(content);
}

export async function createAiLogAnalysis(settings: NotificationSettings, collector?: CollectorPayload, mode: AiLogMode = "issues"): Promise<AnalysisCheck | undefined> {
  const aiSettings = settings.ai;
  const preparedLogs = prepareLogLines(collector?.logs ?? [], mode);
  const logLines = preparedLogs.lines;

  if (!aiSettings?.enabled || preparedLogs.totalLines === 0) return undefined;

  if (mode === "issues" && preparedLogs.matchedLines === 0) {
    return {
      id: "ai-log-analysis",
      title: "KI-Logauswertung",
      category: "Belege",
      status: "ok",
      summary: `In den ${preparedLogs.totalLines} übertragenen Logzeilen wurden keine Fehler oder Warnungen gefunden.`,
      recommendation: "Keine Maßnahme erforderlich. Für eine breitere inhaltliche Prüfung kannst du optional den gesamten übertragenen Log analysieren lassen.",
      access: ["ssh"],
      evidence: [{
        source: "Lokaler Logfilter",
        detail: `${preparedLogs.totalLines} Zeilen wurden auf typische Fehler- und Warnbegriffe geprüft.`,
        timestamp: collector?.collectedAt
      }],
      details: [
        "Es wurden keine Logdaten an OpenAI oder Gemini gesendet, weil der lokale Filter keine Fehler- oder Warnzeile gefunden hat.",
        "Die Aussage gilt nur für den aktuell vom Collector übertragenen Logauszug."
      ]
    };
  }

  const provider = aiSettings.provider ?? "openai";
  const hasOpenAi = provider === "openai" && Boolean(aiSettings.openaiApiKey);
  const hasGemini = provider === "gemini" && Boolean(aiSettings.geminiApiKey);

  if (!hasOpenAi && !hasGemini) {
    return {
      id: "ai-log-analysis",
      title: "KI-Logauswertung",
      category: "Belege",
      status: "improvement",
      summary: "KI-Logauswertung ist aktiviert, aber der API-Key fehlt.",
      recommendation: "Trage in den Settings einen API-Key für den gewählten Anbieter ein oder deaktiviere die KI-Loganalyse.",
      access: ["ssh"],
      evidence: [{ source: "Settings", detail: `Gewählter Anbieter: ${provider}.`, timestamp: collector?.collectedAt }],
      details: ["Es werden nur Logzeilen an den gewählten KI-Anbieter gesendet.", "CCU-Login, SSH-Passwort und Telegram-/SMTP-Zugangsdaten werden dafür nicht übertragen."]
    };
  }

  try {
    const prompt = buildPrompt(logLines, mode, preparedLogs.totalLines);
    const normalizedSettings = {
      enabled: Boolean(aiSettings.enabled),
      provider,
      openaiApiKey: aiSettings.openaiApiKey ?? "",
      openaiModel: aiSettings.openaiModel ?? defaultOpenAiModel,
      geminiApiKey: aiSettings.geminiApiKey ?? "",
      geminiModel: aiSettings.geminiModel ?? defaultGeminiModel
    } satisfies Required<NonNullable<NotificationSettings["ai"]>>;
    const aiResult = provider === "gemini"
      ? await analyzeWithGemini(normalizedSettings, prompt)
      : await analyzeWithOpenAi(normalizedSettings, prompt);

    return normalizeAiResult(
      aiResult,
      collector ?? {},
      mode,
      preparedLogs.totalLines,
      logLines.length,
      preparedLogs.truncated
    );
  } catch (error) {
    return {
      id: "ai-log-analysis",
      title: "KI-Logauswertung",
      category: "Belege",
      status: "improvement",
      summary: "KI-Logauswertung konnte nicht abgeschlossen werden.",
      recommendation: "Prüfe API-Key, Modellname und Internetzugang des Analyzer-Servers. Die normale Analyse läuft weiter.",
      access: ["ssh"],
      evidence: [{ source: "KI-Anbieter", detail: error instanceof Error ? error.message : "Unbekannter KI-Fehler.", timestamp: collector?.collectedAt }],
      details: ["Dieser Punkt ist kein Homematic-Fehler.", "Er bedeutet nur, dass die optionale KI-Erklärung der Logs nicht verfügbar war."]
    };
  }
}
