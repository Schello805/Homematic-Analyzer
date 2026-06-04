import type { AnalysisCheck, CheckStatus, CollectorPayload, NotificationSettings } from "./types.js";

type AiLogResponse = {
  severity?: CheckStatus;
  summary?: string;
  recommendation?: string;
  evidence?: string[];
  details?: string[];
};

const defaultOpenAiModel = "gpt-4o-mini";
const defaultGeminiModel = "gemini-1.5-flash";
const allowedStatuses = new Set<CheckStatus>(["ok", "improvement", "warning", "critical", "unavailable"]);

function cleanLogLines(logs: string[]) {
  return logs
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(-60)
    .map((line) => line.slice(0, 500));
}

function buildPrompt(logLines: string[]) {
  return [
    "Du bist ein vorsichtiger Homematic/RaspberryMatic Log-Analyst.",
    "Analysiere ausschließlich die folgenden Logzeilen.",
    "Erfinde keine Ursachen, Geräte oder Lösungen, die nicht durch die Logzeilen belegt sind.",
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

function normalizeAiResult(result: AiLogResponse, collector: CollectorPayload): AnalysisCheck {
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
    details: details.length > 0
      ? details
      : ["Die KI-Auswertung basiert nur auf den übermittelten Logzeilen.", "Sie ersetzt keine belegte Analyse, sondern übersetzt Logmeldungen in verständliche Hinweise."]
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

export async function createAiLogAnalysis(settings: NotificationSettings, collector?: CollectorPayload): Promise<AnalysisCheck | undefined> {
  const aiSettings = settings.ai;
  const logLines = cleanLogLines(collector?.logs ?? []);

  if (!aiSettings?.enabled || logLines.length === 0) return undefined;

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
    const prompt = buildPrompt(logLines);
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

    return normalizeAiResult(aiResult, collector ?? {});
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
