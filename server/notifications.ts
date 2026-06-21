import nodemailer from "nodemailer";
import type { AnalysisCheck, NotificationSettings } from "./types.js";

export type TelegramNotificationResult = {
  state: "disabled" | "not-configured" | "skipped" | "sent" | "failed";
  message: string;
};

export type NotificationChannelResult = TelegramNotificationResult;

export type NotificationResult = {
  telegram: NotificationChannelResult;
  email: NotificationChannelResult;
};

function serviceNotificationCategory(detail: string) {
  if (/\b(?:ERROR_)?OVERHEAT\b/i.test(detail)) return "overheat";
  if (/\bSABOTAGE\b|\b(?:SMOKE|WATER|LEAK)(?:_[A-Z0-9]+)?\b/i.test(detail)) return "security";
  if (/\b(?:VALVE|HEAT|HEATING|CLIMATE|THERMAL)(?:_[A-Z0-9]+)?\b/i.test(detail)) return "heating";
  if (/\b(?:MOTOR|DRIVE|ACTUATOR|JAM|BLOCKED|OBSTRUCTION)(?:_[A-Z0-9]+)?\b/i.test(detail)) return "actuator";
  return undefined;
}

function shouldNotifyServiceMessage(check: AnalysisCheck, settings: NotificationSettings) {
  const events = settings.events ?? {};
  const selectedTypes = new Set(events.serviceTypes ?? []);

  return check.evidence.some(({ detail }) => {
    const category = serviceNotificationCategory(detail);
    if (category === "overheat" && events.serviceOverheat) return true;
    if (category === "security" && events.serviceSecurity) return true;
    if (category === "heating" && events.serviceHeating) return true;
    if (category === "actuator" && events.serviceActuator) return true;
    return [...selectedTypes].some((type) => detail.includes(type));
  });
}

export function shouldNotifyCheck(check: AnalysisCheck, settings: NotificationSettings): boolean {
  const events = settings.events ?? { critical: true };

  if (check.id === "service-messages") {
    return shouldNotifyServiceMessage(check, settings);
  }
  if (check.status === "critical" && events.critical !== false) return true;
  if (check.status === "warning" && events.warning) return true;
  if (check.id === "duty-cycle" && events.dutyCycle && (check.status === "critical" || check.status === "warning")) return true;
  if (check.id === "batteries" && events.battery && check.status !== "ok" && check.status !== "unavailable") return true;
  if (check.id === "reachability" && events.unreachable && check.status !== "ok" && check.status !== "unavailable") return true;
  if (check.id === "config-pending" && events.configPending && check.status !== "ok" && check.status !== "unavailable") return true;
  if (check.id === "external-access" && events.externalAccess && check.status !== "ok" && check.status !== "unavailable") return true;
  if (check.id === "signal-strength" && events.sniffer && check.status === "critical") return true;
  if (check.id === "app-release" && events.releases && check.status === "warning") return true;
  if (check.id === "central-release" && events.releases && check.status === "warning") return true;

  return false;
}

function relevantChecks(checks: AnalysisCheck[], settings: NotificationSettings) {
  return checks.filter((check) => shouldNotifyCheck(check, settings));
}

function escapeTelegramHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shorten(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1).trimEnd()}…` : compact;
}

function statusIcon(check: AnalysisCheck) {
  if (check.status === "critical") return "🔴";
  if (check.status === "warning") return "🟠";
  if (check.status === "improvement") return "🔵";
  return "⚪";
}

function dutyCycleChart(check: AnalysisCheck) {
  if (check.id !== "duty-cycle") return undefined;
  const rawPercent = check.summary.match(/(\d+(?:[.,]\d+)?)\s*%/)?.[1];
  const percent = rawPercent ? Number(rawPercent.replace(",", ".")) : undefined;
  if (percent === undefined || !Number.isFinite(percent)) return undefined;
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round(clamped / 10);
  return `📊 Funklast: <b>${Math.round(clamped)}%</b> <code>${"█".repeat(filled)}${"░".repeat(10 - filled)}</code>`;
}

function notificationRecommendation(check: AnalysisCheck) {
  if (check.id === "external-access") {
    const target = check.evidence[0]?.detail.match(/^(.+?):\s+\d+ Verbindung/)?.[1];
    return `Prüfe ${target ?? "die genannte Gegenstelle"}: Polling-Intervalle verlängern und unnötige Schreibzugriffe vermeiden.`;
  }
  return shorten(check.recommendation, 150);
}

function statusOverview(checks: AnalysisCheck[]) {
  const counts = {
    critical: checks.filter((check) => check.status === "critical").length,
    warning: checks.filter((check) => check.status === "warning").length,
    improvement: checks.filter((check) => check.status === "improvement").length
  };
  return [
    counts.critical ? `🔴 ${counts.critical} kritisch` : undefined,
    counts.warning ? `🟠 ${counts.warning} Hinweis` : undefined,
    counts.improvement ? `🔵 ${counts.improvement} Optimierung` : undefined
  ].filter(Boolean).join(" · ") || "✅ Keine kritischen Ereignisse";
}

export function buildTelegramMessage(checks: AnalysisCheck[], settings: NotificationSettings, analyzerUrl?: string) {
  const selectedChecks = relevantChecks(checks, settings);
  const visibleChecks = selectedChecks.slice(0, 5);
  const text = [
    "🏠 <b>Homematic Analyzer</b>",
    escapeTelegramHtml(statusOverview(checks)),
    "",
    "<b>Was jetzt wichtig ist</b>",
    ...visibleChecks.flatMap((check) => [
      `${statusIcon(check)} <b>${escapeTelegramHtml(check.title)}</b>`,
      escapeTelegramHtml(shorten(check.summary, 220)),
      dutyCycleChart(check),
      `➡️ ${escapeTelegramHtml(notificationRecommendation(check))}`,
      ""
    ]).filter(Boolean),
    selectedChecks.length > visibleChecks.length ? `… und ${selectedChecks.length - visibleChecks.length} weitere Meldung${selectedChecks.length - visibleChecks.length === 1 ? "" : "en"}.` : undefined,
    analyzerUrl ? `🔗 <a href="${escapeTelegramHtml(analyzerUrl)}">Analyzer öffnen und Belege ansehen</a>` : "🔎 Bitte Analyzer öffnen und Belege prüfen."
  ].filter(Boolean).join("\n");
  return text;
}

function buildEmailMessage(checks: AnalysisCheck[], settings: NotificationSettings, analyzerUrl?: string) {
  const selectedChecks = relevantChecks(checks, settings);
  return [
    "Homematic Analyzer: Benachrichtigung",
    statusOverview(checks),
    "",
    ...selectedChecks.slice(0, 8).flatMap((check) => [`${check.title}: ${check.summary}`, `Empfehlung: ${check.recommendation}`, ""]),
    analyzerUrl ? `Analyzer öffnen: ${analyzerUrl}` : "Bitte Analyzer öffnen und Belege prüfen."
  ].filter(Boolean).join("\n");
}

async function sendTelegramSummary(settings: NotificationSettings, checks: AnalysisCheck[], analyzerUrl?: string): Promise<NotificationChannelResult> {
  if (!settings.telegram?.enabled) {
    return { state: "disabled", message: "Telegram ist nicht aktiviert." };
  }

  const selectedChecks = relevantChecks(checks, settings);
  if (selectedChecks.length === 0) {
    return { state: "skipped", message: "Keine passenden Ereignisse, keine Telegram-Nachricht gesendet." };
  }

  const botToken = settings.telegram.botToken || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = settings.telegram.chatId || process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return { state: "not-configured", message: "Telegram ist aktiviert, aber Bot-Token oder Chat-ID fehlt." };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: buildTelegramMessage(checks, settings, analyzerUrl),
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: analyzerUrl ? {
          inline_keyboard: [[{ text: "🔎 Analyzer öffnen", url: analyzerUrl }]]
        } : undefined
      })
    });

    if (!response.ok) {
      return { state: "failed", message: `Telegram konnte nicht senden: HTTP ${response.status}.` };
    }

    return { state: "sent", message: `${selectedChecks.length} Ereignis(se) per Telegram gemeldet.` };
  } catch {
    return { state: "failed", message: "Telegram konnte nicht erreicht werden." };
  }
}

async function sendEmailSummary(settings: NotificationSettings, checks: AnalysisCheck[], analyzerUrl?: string): Promise<NotificationChannelResult> {
  if (!settings.email?.enabled) {
    return { state: "disabled", message: "E-Mail ist nicht aktiviert." };
  }

  const selectedChecks = relevantChecks(checks, settings);
  if (selectedChecks.length === 0) {
    return { state: "skipped", message: "Keine passenden Ereignisse, keine E-Mail gesendet." };
  }

  const email = settings.email;
  if (!email.host || !email.port || !email.from || !email.to) {
    return { state: "not-configured", message: "E-Mail ist aktiviert, aber SMTP-Host, Port, Absender oder Empfänger fehlt." };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: email.host,
      port: email.port,
      secure: Boolean(email.secure),
      auth: email.user || email.password
        ? {
          user: email.user,
          pass: email.password
        }
        : undefined
    });

    await transporter.sendMail({
      from: email.from,
      to: email.to,
      subject: `Homematic Analyzer: ${selectedChecks.length} Ereignis(se)`,
      text: buildEmailMessage(checks, settings, analyzerUrl)
    });

    return { state: "sent", message: `${selectedChecks.length} Ereignis(se) per E-Mail gemeldet.` };
  } catch {
    return { state: "failed", message: "E-Mail konnte nicht gesendet werden. Bitte SMTP-Daten prüfen." };
  }
}

export async function sendNotificationSummaries(settings: NotificationSettings, checks: AnalysisCheck[], analyzerUrl?: string): Promise<NotificationResult> {
  const [telegram, email] = await Promise.all([
    sendTelegramSummary(settings, checks, analyzerUrl),
    sendEmailSummary(settings, checks, analyzerUrl)
  ]);

  return { telegram, email };
}

export async function sendTestNotification(channel: "telegram" | "email", settings: NotificationSettings): Promise<NotificationChannelResult> {
  const testSettings: NotificationSettings = {
    ...settings,
    telegram: { ...settings.telegram, enabled: channel === "telegram" },
    email: { ...settings.email, enabled: channel === "email" },
    events: { ...settings.events, critical: true }
  };
  const testChecks: AnalysisCheck[] = [{
    id: "notification-test",
    title: "Testnachricht",
    category: "Benachrichtigung",
    status: "critical",
    summary: "Das ist eine Testnachricht vom Homematic Analyzer.",
    recommendation: "Wenn diese Nachricht angekommen ist, funktioniert der Kanal.",
    access: ["telegram"],
    evidence: [{ source: "Settings", detail: "Manuell ausgelöster Benachrichtigungstest." }],
    details: ["Dieser Test verändert keine Homematic-Daten."]
  }];

  const result = await sendNotificationSummaries(testSettings, testChecks);
  return channel === "telegram" ? result.telegram : result.email;
}
