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

export function shouldNotifyCheck(check: AnalysisCheck, settings: NotificationSettings): boolean {
  const events = settings.events ?? { critical: true };

  if (check.status === "critical" && events.critical !== false) return true;
  if (check.status === "warning" && events.warning) return true;
  if (check.id === "duty-cycle" && events.dutyCycle && (check.status === "critical" || check.status === "warning")) return true;
  if (check.id === "batteries" && events.battery && check.status !== "ok" && check.status !== "unavailable") return true;
  if (check.id === "reachability" && events.unreachable && check.status !== "ok" && check.status !== "unavailable") return true;
  if (check.id === "config-pending" && events.configPending && check.status !== "ok" && check.status !== "unavailable") return true;
  if (check.id === "external-access" && events.externalAccess && check.status !== "ok" && check.status !== "unavailable") return true;
  if (check.id === "signal-strength" && events.sniffer && check.status === "critical") return true;
  if (check.id === "app-release" && events.releases && check.status === "warning") return true;

  return false;
}

function relevantChecks(checks: AnalysisCheck[], settings: NotificationSettings) {
  return checks.filter((check) => shouldNotifyCheck(check, settings));
}

function buildMessage(checks: AnalysisCheck[], settings: NotificationSettings) {
  const selectedChecks = relevantChecks(checks, settings);
  const warningChecks = checks.filter((check) => check.status === "warning");

  return [
    "Homematic Analyzer: Benachrichtigung",
    "",
    ...selectedChecks.slice(0, 8).map((check) => `• ${check.title}: ${check.summary}`),
    warningChecks.length > 0 ? "" : undefined,
    warningChecks.length > 0 ? `${warningChecks.length} weitere Hinweise/Warnungen vorhanden.` : undefined,
    "",
    "Bitte Analyzer öffnen und Belege prüfen."
  ].filter(Boolean).join("\n");
}

async function sendTelegramSummary(settings: NotificationSettings, checks: AnalysisCheck[]): Promise<NotificationChannelResult> {
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
        text: buildMessage(checks, settings),
        disable_web_page_preview: true
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

async function sendEmailSummary(settings: NotificationSettings, checks: AnalysisCheck[]): Promise<NotificationChannelResult> {
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
      text: buildMessage(checks, settings)
    });

    return { state: "sent", message: `${selectedChecks.length} Ereignis(se) per E-Mail gemeldet.` };
  } catch {
    return { state: "failed", message: "E-Mail konnte nicht gesendet werden. Bitte SMTP-Daten prüfen." };
  }
}

export async function sendNotificationSummaries(settings: NotificationSettings, checks: AnalysisCheck[]): Promise<NotificationResult> {
  const [telegram, email] = await Promise.all([
    sendTelegramSummary(settings, checks),
    sendEmailSummary(settings, checks)
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
