import cors from "cors";
import express from "express";
import { spawn } from "node:child_process";
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createAiLogAnalysis } from "./aiLogAnalyzer.js";
import { createAnalysis } from "./analyzer.js";
import { readCcuSnapshot } from "./ccuClient.js";
import { readLocalDatabase, updateLocalDatabase } from "./localDatabase.js";
import { sendNotificationSummaries, sendTestNotification } from "./notifications.js";
import { checkRepositoryRelease } from "./releases.js";
import packageInfo from "../package.json" with { type: "json" };
import type { CcuMasterdataPayload, CollectorHistoryPoint, CollectorPayload, NotificationSettings } from "./types.js";

const app = express();
const appVersion = packageInfo.version;
const port = Number(process.env.PORT ?? 3001);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const frontendDist = join(root, "dist");
const dataDir = join(root, ".data");
const localDatabaseFile = join(dataDir, "homematic-analyzer-db.json");
const ccuMasterdataFile = join(dataDir, "ccu-masterdata.json");
const notificationSettingsFile = join(dataDir, "notification-settings.json");
const updateLogFile = join(dataDir, "update.log");

let latestCollector: CollectorPayload | undefined;
let latestCcuMasterdata: CcuMasterdataPayload | undefined;
let persistedNotificationSettings: NotificationSettings | undefined;
let collectorHistory: CollectorHistoryPoint[] = [];
let updateRun: {
  running: boolean;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  error?: string;
} = { running: false };

const defaultNotificationSettings: NotificationSettings = {
  telegram: { enabled: false },
  email: { enabled: false, port: 587, secure: false },
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
    openaiModel: "gpt-4o-mini",
    geminiModel: "gemini-1.5-flash"
  }
};

const notificationSettingsSchema = z.object({
  telegram: z.object({
    enabled: z.boolean().optional(),
    botToken: z.string().max(300).optional(),
    chatId: z.string().max(120).optional()
  }).optional(),
  email: z.object({
    enabled: z.boolean().optional(),
    host: z.string().max(200).optional(),
    port: z.number().int().positive().max(65535).optional(),
    secure: z.boolean().optional(),
    user: z.string().max(200).optional(),
    password: z.string().max(300).optional(),
    from: z.string().max(300).optional(),
    to: z.string().max(300).optional()
  }).optional(),
  events: z.object({
    critical: z.boolean().optional(),
    warning: z.boolean().optional(),
    dutyCycle: z.boolean().optional(),
    battery: z.boolean().optional(),
    unreachable: z.boolean().optional(),
    configPending: z.boolean().optional(),
    externalAccess: z.boolean().optional(),
    sniffer: z.boolean().optional(),
    releases: z.boolean().optional()
  }).optional(),
  ai: z.object({
    enabled: z.boolean().optional(),
    provider: z.enum(["openai", "gemini"]).optional(),
    openaiApiKey: z.string().max(300).optional(),
    openaiModel: z.string().max(120).optional(),
    geminiApiKey: z.string().max(300).optional(),
    geminiModel: z.string().max(120).optional()
  }).optional()
});

const analyzeSchema = z.object({
  ccuHost: z.string().optional(),
  ccuUser: z.string().optional(),
  ccuPassword: z.string().optional(),
  xmlApiToken: z.string().optional(),
  hasCcuPassword: z.boolean().optional(),
  sshHost: z.string().optional(),
  sshUser: z.string().optional(),
  sshPassword: z.string().optional(),
  hasSshPassword: z.boolean().optional(),
  snifferPort: z.string().optional(),
  telegramEnabled: z.boolean().optional(),
  externalSystems: z.array(z.string()).optional(),
  notificationSettings: notificationSettingsSchema.optional(),
  notify: z.boolean().optional()
});

const notificationTestSchema = z.object({
  channel: z.enum(["telegram", "email"]),
  settings: notificationSettingsSchema.optional()
});

const collectorSchema = z.object({
  token: z.coerce.string().max(300).optional(),
  host: z.coerce.string().max(220).optional(),
  collectedAt: z.coerce.string().max(120).optional(),
  system: z.record(z.unknown()).optional(),
  logs: z.array(z.coerce.string().max(2000)).max(200).optional(),
  network: z.object({
    connections: z.array(z.coerce.string().max(2000)).max(250).optional()
  }).optional(),
  backups: z.record(z.unknown()).optional()
});

const ccuMasterdataSchema = z.object({
  token: z.string().max(200).optional(),
  source: z.string().max(80).optional(),
  collectedAt: z.string().max(80).optional(),
  deviceCount: z.number().int().nonnegative().optional(),
  system: z.record(z.unknown()).optional(),
  backups: z.record(z.unknown()).optional(),
  devices: z.array(z.object({
    name: z.string().max(200).optional(),
    address: z.string().max(80).optional(),
    type: z.string().max(120).optional(),
    firmware: z.string().max(80).optional()
  })).max(1000).optional()
});

function replacementCount(value: string) {
  return (value.match(/\uFFFD/g) ?? []).length;
}

function decodeJsonBuffer(buffer: Buffer): unknown {
  const utf8Text = buffer.toString("utf8");
  const latin1Text = buffer.toString("latin1");
  const preferredText = replacementCount(latin1Text) < replacementCount(utf8Text) ? latin1Text : utf8Text;
  return JSON.parse(preferredText);
}

function stringFromRecord(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return value === undefined || value === null ? undefined : String(value);
}

function stringArrayFromRecord(record: Record<string, unknown> | undefined, key: string): string[] | undefined {
  const value = record?.[key];
  if (!Array.isArray(value)) return undefined;
  return value.map((entry) => String(entry)).filter(Boolean);
}

async function readUpdateLogTail() {
  try {
    const log = await readFile(updateLogFile, "utf8");
    return log.split("\n").slice(-80).join("\n").trim();
  } catch {
    return "";
  }
}

async function createUpdateRunStatus() {
  const log = await readUpdateLogTail();
  const logFailed = /\bfatal:|npm ERR!|\[ERROR\]|error Command failed/i.test(log);
  const logCompleted = /\[OK\] Update abgeschlossen\./.test(log);
  const status = updateRun.running
    ? "running"
    : updateRun.error || updateRun.exitCode
      ? "failed"
      : logFailed
        ? "failed"
        : logCompleted
          ? "completed"
          : "idle";

  const statusPayload = {
    status,
    running: updateRun.running,
    startedAt: updateRun.startedAt,
    finishedAt: updateRun.finishedAt,
    exitCode: updateRun.exitCode,
    error: updateRun.error,
    log
  };

  console.log("[Homematic Analyzer][Update] status", {
    status: statusPayload.status,
    running: statusPayload.running,
    startedAt: statusPayload.startedAt,
    finishedAt: statusPayload.finishedAt,
    exitCode: statusPayload.exitCode,
    error: statusPayload.error,
    logLines: statusPayload.log ? statusPayload.log.split("\n").length : 0
  });

  return statusPayload;
}

function normalizeCcuUiTarget(ccuHost?: string) {
  if (!ccuHost) return {};

  try {
    const url = new URL(/^https?:\/\//i.test(ccuHost) ? ccuHost : `http://${ccuHost}`);
    return {
      ccuHost: url.hostname,
      ccuUiUrl: `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}/`
    };
  } catch {
    const host = ccuHost.split("/")[0]?.split(":")[0];
    return host ? { ccuHost: host, ccuUiUrl: `http://${host}/` } : {};
  }
}

function createHistoryPoint(collector: CollectorPayload): CollectorHistoryPoint {
  return {
    collectedAt: collector.collectedAt ?? new Date().toISOString(),
    cpu: stringFromRecord(collector.system, "cpu"),
    memory: stringFromRecord(collector.system, "memory"),
    disk: stringFromRecord(collector.system, "disk"),
    temperature: stringFromRecord(collector.system, "temperatureRaw")
  };
}

function createSystemDashboard(masterdata: CcuMasterdataPayload | undefined, collector: CollectorPayload | undefined, ccuHost?: string) {
  const ccuSystem = masterdata?.system;
  const ccuBackups = masterdata?.backups;
  const hasCcuSystemData = Boolean(ccuSystem || ccuBackups);
  const ccuTarget = normalizeCcuUiTarget(ccuHost);

  if (!hasCcuSystemData && !collector) {
    return { available: false, logs: 0, connections: 0, ...ccuTarget };
  }

  return {
    available: true,
    host: stringFromRecord(ccuSystem, "host") ?? collector?.host,
    ...ccuTarget,
    collectedAt: masterdata?.collectedAt ?? collector?.collectedAt,
    uptime: stringFromRecord(collector?.system, "uptime") ?? stringFromRecord(ccuSystem, "uptime"),
    memory: stringFromRecord(collector?.system, "memory") ?? stringFromRecord(ccuSystem, "memory"),
    disk: stringFromRecord(collector?.system, "disk") ?? stringFromRecord(ccuSystem, "disk"),
    temperature: stringFromRecord(collector?.system, "temperatureRaw") ?? stringFromRecord(ccuSystem, "temperatureRaw"),
    cpu: stringFromRecord(collector?.system, "cpu") ?? stringFromRecord(ccuSystem, "cpu"),
    backups: stringFromRecord(collector?.backups, "count") ?? stringFromRecord(ccuBackups, "count"),
    backupPaths: stringArrayFromRecord(collector?.backups, "paths") ?? stringArrayFromRecord(ccuBackups, "paths"),
    backupLatestPath: stringFromRecord(collector?.backups, "latestPath") ?? stringFromRecord(ccuBackups, "latestPath"),
    backupLatestDirectory: stringFromRecord(collector?.backups, "latestDirectory") ?? stringFromRecord(ccuBackups, "latestDirectory"),
    backupLatestAt: stringFromRecord(collector?.backups, "latestAt") ?? stringFromRecord(ccuBackups, "latestAt"),
    backupDisk: stringFromRecord(collector?.backups, "disk") ?? stringFromRecord(ccuBackups, "disk"),
    logs: collector?.logs?.length ?? 0,
    connections: collector?.network?.connections?.length ?? 0,
    history: collectorHistory.slice(-120)
  };
}

async function readUsbSerialPorts() {
  const candidates: Array<{ path: string; label: string; stable: boolean; target?: string }> = [];
  const seenPaths = new Set<string>();

  async function addPort(path: string, stable: boolean, label?: string) {
    if (seenPaths.has(path)) return;
    seenPaths.add(path);

    let target: string | undefined;
    try {
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) {
        target = await realpath(path);
      }
    } catch {
    }

    candidates.push({
      path,
      label: label ?? (target ? `${path} → ${target}` : path),
      stable,
      target
    });
  }

  try {
    const byIdEntries = await readdir("/dev/serial/by-id");
    await Promise.all(byIdEntries.map((entry) => addPort(join("/dev/serial/by-id", entry), true)));
  } catch {
  }

  try {
    const devEntries = await readdir("/dev");
    const serialNamePattern = /^(ttyUSB|ttyACM|ttyAMA|serial|cu\.usb|tty\.usb|cu\.wchusb|tty\.wchusb|cu\.SLAB|tty\.SLAB)/i;
    await Promise.all(
      devEntries
        .filter((entry) => serialNamePattern.test(entry))
        .map((entry) => addPort(join("/dev", entry), false))
    );
  } catch {
  }

  return candidates.sort((left, right) => {
    if (left.stable !== right.stable) return left.stable ? -1 : 1;
    return left.path.localeCompare(right.path);
  });
}

async function loadPersistedCcuMasterdata() {
  const database = await readLocalDatabase(localDatabaseFile);
  const databaseMasterdata = ccuMasterdataSchema.safeParse(database.ccuMasterdata);
  if (databaseMasterdata.success) {
    latestCcuMasterdata = databaseMasterdata.data;
    return;
  }

  try {
    const parsed = ccuMasterdataSchema.safeParse(JSON.parse(await readFile(ccuMasterdataFile, "utf8")));
    if (parsed.success) {
      latestCcuMasterdata = parsed.data;
      await updateLocalDatabase(localDatabaseFile, (currentDatabase) => ({
        ...currentDatabase,
        ccuMasterdata: parsed.data
      }));
    }
  } catch {
  }
}

async function loadPersistedCollector() {
  const database = await readLocalDatabase(localDatabaseFile);
  const parsed = collectorSchema.safeParse(database.latestCollector);
  if (parsed.success) {
    latestCollector = parsed.data;
  }
  collectorHistory = Array.isArray(database.collectorHistory) ? database.collectorHistory.slice(-120) : [];
}

async function persistCcuMasterdata(payload: CcuMasterdataPayload) {
  await updateLocalDatabase(localDatabaseFile, (currentDatabase) => ({
    ...currentDatabase,
    ccuMasterdata: payload
  }));
}

async function persistCollector(payload: CollectorPayload) {
  const point = createHistoryPoint(payload);
  collectorHistory = [...collectorHistory, point].slice(-120);
  await updateLocalDatabase(localDatabaseFile, (currentDatabase) => ({
    ...currentDatabase,
    latestCollector: payload,
    collectorHistory
  }));
}

function mergeNotificationSettings(settings?: NotificationSettings): NotificationSettings {
  return {
    telegram: { ...defaultNotificationSettings.telegram, ...settings?.telegram },
    email: { ...defaultNotificationSettings.email, ...settings?.email },
    events: { ...defaultNotificationSettings.events, ...settings?.events },
    ai: { ...defaultNotificationSettings.ai, ...settings?.ai }
  };
}

async function loadPersistedNotificationSettings() {
  const database = await readLocalDatabase(localDatabaseFile);
  const databaseSettings = notificationSettingsSchema.safeParse(database.notificationSettings);
  if (databaseSettings.success) {
    persistedNotificationSettings = mergeNotificationSettings(databaseSettings.data);
    return;
  }

  try {
    const parsed = notificationSettingsSchema.safeParse(JSON.parse(await readFile(notificationSettingsFile, "utf8")));
    persistedNotificationSettings = parsed.success ? mergeNotificationSettings(parsed.data) : defaultNotificationSettings;
    if (parsed.success) {
      await updateLocalDatabase(localDatabaseFile, (currentDatabase) => ({
        ...currentDatabase,
        notificationSettings: persistedNotificationSettings
      }));
    }
  } catch {
    persistedNotificationSettings = defaultNotificationSettings;
  }
}

async function persistNotificationSettings(settings: NotificationSettings) {
  persistedNotificationSettings = mergeNotificationSettings(settings);
  await updateLocalDatabase(localDatabaseFile, (currentDatabase) => ({
    ...currentDatabase,
    notificationSettings: persistedNotificationSettings
  }));
}

app.use(cors());

app.post("/api/ccu-masterdata", express.raw({ type: "*/*", limit: "2mb" }), async (request, response) => {
  let body: unknown;

  try {
    body = Buffer.isBuffer(request.body)
      ? decodeJsonBuffer(request.body)
      : request.body;
  } catch {
    response.status(400).json({ error: "Ungültige CCU-Stammdaten", issues: [{ message: "JSON konnte nicht gelesen werden." }] });
    return;
  }

  const parsed = ccuMasterdataSchema.safeParse(body);

  if (!parsed.success) {
    response.status(400).json({ error: "Ungültige CCU-Stammdaten", issues: parsed.error.issues });
    return;
  }

  const expectedCollectorToken = process.env.COLLECTOR_TOKEN;

  if (expectedCollectorToken && parsed.data.token !== expectedCollectorToken) {
    response.status(401).json({ error: "Collector-Token ist ungültig." });
    return;
  }

  latestCcuMasterdata = {
    ...parsed.data,
    collectedAt: parsed.data.collectedAt ?? new Date().toISOString()
  };
  await persistCcuMasterdata(latestCcuMasterdata);

  response.json({
    ok: true,
    receivedAt: new Date().toISOString(),
    deviceCount: parsed.data.deviceCount ?? parsed.data.devices?.length ?? 0
  });
});

app.use(express.json({ limit: "2mb" }));

app.use((error: unknown, request: express.Request, response: express.Response, next: express.NextFunction) => {
  if (!request.path.startsWith("/api")) {
    next(error);
    return;
  }

  console.warn("[Homematic Analyzer][API] Bad Request", {
    path: request.path,
    method: request.method,
    contentType: request.headers["content-type"],
    message: error instanceof Error ? error.message : String(error)
  });

  response.status(400).json({
    error: "Ungültige Anfrage",
    hint: "Die gesendeten Daten konnten nicht als JSON gelesen werden. Bitte Shell-Collector-Script aktualisieren und erneut ausführen.",
    message: error instanceof Error ? error.message : "Bad Request"
  });
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "Homematic Analyzer API" });
});

app.get("/api/system/usb-ports", async (_request, response) => {
  response.json({
    checkedAt: new Date().toISOString(),
    ports: await readUsbSerialPorts()
  });
});

app.get("/api/setup/defaults", async (_request, response) => {
  const database = await readLocalDatabase(localDatabaseFile);
  response.json(database.setupDefaults ?? {});
});

app.post("/api/analyze", async (request, response) => {
  try {
    const parsed = analyzeSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({ error: "Ungültige Analyse-Konfiguration", issues: parsed.error.issues });
      return;
    }

    const ccuSnapshot = await readCcuSnapshot(parsed.data);
    const notificationSettings = mergeNotificationSettings(parsed.data.notificationSettings ?? persistedNotificationSettings ?? {
      telegram: { enabled: parsed.data.telegramEnabled },
      events: { critical: true }
    });
    const releaseCheck = notificationSettings.events?.releases ? await checkRepositoryRelease(appVersion) : undefined;

    const checks = createAnalysis({ ...parsed.data, notificationSettings }, latestCollector, ccuSnapshot, latestCcuMasterdata, releaseCheck);
    const aiLogAnalysis = await createAiLogAnalysis(notificationSettings, latestCollector);
    if (aiLogAnalysis) {
      checks.push(aiLogAnalysis);
    }
    const analyzerUrl = `${request.protocol}://${request.get("host") ?? `127.0.0.1:${port}`}`;
    const notificationResult = parsed.data.notify === false
      ? {
        telegram: { state: "skipped" as const, message: "Automatische Aktualisierung: keine Benachrichtigung gesendet." },
        email: { state: "skipped" as const, message: "Automatische Aktualisierung: keine Benachrichtigung gesendet." }
      }
      : await sendNotificationSummaries(notificationSettings, checks, analyzerUrl);

    response.json({
      generatedAt: new Date().toISOString(),
      checks,
      systemDashboard: createSystemDashboard(latestCcuMasterdata, latestCollector, parsed.data.ccuHost),
      notifications: {
        telegram: notificationResult.telegram,
        email: notificationResult.email
      }
    });
  } catch (error) {
    console.error("Analyse Fehler:", error);
    response.status(500).json({
      error: "Interner Serverfehler bei der Analyse",
      message: error instanceof Error ? error.message : "Ein unbekannter Fehler ist aufgetreten."
    });
  }
});

app.post("/api/collector", async (request, response) => {
  const parsed = collectorSchema.safeParse(request.body);

  if (!parsed.success) {
    console.warn("Ungültige Collector-Daten", JSON.stringify(parsed.error.issues));
    response.status(400).json({
      error: "Ungültige Collector-Daten",
      hint: "Bitte aktualisiere das Shell-Collector-Script in der Web-App und führe es erneut auf der CCU aus.",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
    return;
  }

  const expectedCollectorToken = process.env.COLLECTOR_TOKEN;

  if (expectedCollectorToken && parsed.data.token !== expectedCollectorToken) {
    response.status(401).json({ error: "Collector-Token ist ungültig." });
    return;
  }

  latestCollector = {
    ...parsed.data,
    collectedAt: parsed.data.collectedAt ?? new Date().toISOString()
  };
  await persistCollector(latestCollector);

  response.json({ ok: true, receivedAt: new Date().toISOString() });
});

app.get("/api/collector/latest", (_request, response) => {
  response.json({
    available: Boolean(latestCollector),
    collectedAt: latestCollector?.collectedAt,
    host: latestCollector?.host,
    logs: latestCollector?.logs?.length ?? 0,
    connections: latestCollector?.network?.connections?.length ?? 0
  });
});

app.get("/api/ccu-masterdata/latest", (_request, response) => {
  response.json({
    available: Boolean(latestCcuMasterdata),
    collectedAt: latestCcuMasterdata?.collectedAt,
    deviceCount: latestCcuMasterdata?.deviceCount ?? latestCcuMasterdata?.devices?.length ?? 0,
    systemAvailable: Boolean(latestCcuMasterdata?.system || latestCcuMasterdata?.backups)
  });
});

app.get("/api/settings/notifications", (_request, response) => {
  response.json(mergeNotificationSettings(persistedNotificationSettings));
});

app.get("/api/system/update-status", async (_request, response) => {
  const releaseCheck = await checkRepositoryRelease(appVersion);
  const sourceLabel = releaseCheck.source === "tag" ? "Tag" : releaseCheck.source === "main" ? "main" : "Release";
  response.json({
    state: releaseCheck.error ? "unknown" : releaseCheck.available ? "update" : "current",
    label: releaseCheck.error ? "Update-Check nicht möglich" : releaseCheck.available ? "Update verfügbar" : "Aktuell",
    detail: releaseCheck.error
      ? `${releaseCheck.error} Die App funktioniert trotzdem.`
      : releaseCheck.available
        ? `Installiert: ${releaseCheck.currentVersion}. Neu auf GitHub (${sourceLabel}): ${releaseCheck.latestVersion}.`
        : releaseCheck.latestVersion
          ? `Installierte Version ${releaseCheck.currentVersion} ist aktuell (${sourceLabel} geprüft).`
          : `Installierte Version ${releaseCheck.currentVersion}. Keine neuere Version auf GitHub gefunden.`,
    url: releaseCheck.url ?? "https://github.com/Schello805/Homematic-Analyzer",
    checkedAt: releaseCheck.checkedAt
  });
});

app.get("/api/system/update-run", async (_request, response) => {
  console.log("[Homematic Analyzer][Update] status requested");
  response.json(await createUpdateRunStatus());
});

app.post("/api/settings/notifications", async (request, response) => {
  const parsed = notificationSettingsSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: "Ungültige Benachrichtigungs-Settings", issues: parsed.error.issues });
    return;
  }

  await persistNotificationSettings(parsed.data);
  response.json({ ok: true, settings: persistedNotificationSettings });
});

app.post("/api/settings/notifications/test", async (request, response) => {
  const parsed = notificationTestSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: "Ungültiger Benachrichtigungstest", issues: parsed.error.issues });
    return;
  }

  const settings = mergeNotificationSettings(parsed.data.settings ?? persistedNotificationSettings);
  const result = await sendTestNotification(parsed.data.channel, settings);
  response.json(result);
});

app.post("/api/system/update", async (_request, response) => {
  console.log("[Homematic Analyzer][Update] start requested", {
    root,
    updateLogFile,
    alreadyRunning: updateRun.running
  });

  if (updateRun.running) {
    console.warn("[Homematic Analyzer][Update] start rejected because update is already running");
    response.status(409).json({
      ok: false,
      message: "Ein Update läuft bereits.",
      status: await createUpdateRunStatus()
    });
    return;
  }

  try {
    const updateScript = join(root, "scripts", "install", "update-local.sh");
    await readFile(updateScript, "utf8");
    await mkdir(dataDir, { recursive: true });
    await writeFile(updateLogFile, [
      `[${new Date().toISOString()}] Update per Footer gestartet`,
      `[INFO] Root: ${root}`,
      `[INFO] Script: ${updateScript}`,
      `[INFO] Node PID: ${process.pid}`,
      ""
    ].join("\n"));
    updateRun = {
      running: true,
      startedAt: new Date().toISOString()
    };

    const child = spawn("bash", [updateScript], {
      cwd: root,
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        ANALYZER_PID: String(process.pid),
        UPDATE_LOG_FILE: updateLogFile
      }
    });

    child.on("exit", (code) => {
      console.log("[Homematic Analyzer][Update] child exited", { code });
      updateRun = {
        ...updateRun,
        running: false,
        finishedAt: new Date().toISOString(),
        exitCode: code
      };
    });

    child.on("error", (error) => {
      console.error("[Homematic Analyzer][Update] child error", error);
      updateRun = {
        ...updateRun,
        running: false,
        finishedAt: new Date().toISOString(),
        error: error.message
      };
    });

    child.unref();

    console.log("[Homematic Analyzer][Update] child started", {
      pid: child.pid,
      script: updateScript,
      log: updateLogFile
    });

    response.json({
      ok: true,
      message: "Update wurde gestartet. Der Analyzer lädt GitHub-Änderungen, baut neu und startet danach neu.",
      log: ".data/update.log",
      fallbackCommand: "sudo bash /opt/homematic-analyzer/scripts/install/install-linux.sh"
    });
  } catch (error) {
    console.error("[Homematic Analyzer][Update] start failed", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    updateRun = {
      running: false,
      finishedAt: new Date().toISOString(),
      error: errorMessage
    };
    response.status(500).json({
      ok: false,
      message: "Update konnte nicht gestartet werden.",
      error: errorMessage,
      hint: "Der Analyzer-Prozess konnte das lokale Update-Script nicht starten. Häufige Ursachen sind Dateirechte in /opt/homematic-analyzer, fehlendes bash oder ein nicht beschreibbares .data-Verzeichnis.",
      log: ".data/update.log",
      fallbackCommand: "sudo bash /opt/homematic-analyzer/scripts/install/install-linux.sh"
    });
  }
});

app.get("/api/collector/script", async (request, response) => {
  const analyzerUrl = String(request.query.url ?? `http://127.0.0.1:${port}`);
  const token = String(request.query.token ?? "bitte-token-aendern");
  const mode = String(request.query.mode ?? "once");
  const interval = String(request.query.interval ?? "daily");
  const onceParams = new URLSearchParams({
    url: analyzerUrl,
    token,
    mode: "once",
    interval
  });
  const collectorScriptUrl = `${analyzerUrl}/api/collector/script?${onceParams.toString()}`;
  const scriptPath = join(root, "scripts", "system-snapshot-collector.sh");
  const script = await readFile(scriptPath, "utf8");

  response.type("text/plain").send(
    script
      .replaceAll("__ANALYZER_URL__", analyzerUrl)
      .replaceAll("__ANALYZER_TOKEN__", token)
      .replaceAll("__COLLECTOR_MODE__", mode)
      .replaceAll("__COLLECTOR_INTERVAL__", interval)
      .replaceAll("__COLLECTOR_SCRIPT_URL__", collectorScriptUrl)
  );
});

app.get("/api/ccu-masterdata/script", async (request, response) => {
  const analyzerUrl = String(request.query.url ?? `http://127.0.0.1:${port}`);
  const token = String(request.query.token ?? "bitte-token-aendern");
  const scriptPath = join(root, "scripts", "ccu", "daily-masterdata.rega");
  const script = await readFile(scriptPath, "utf8");

  response.type("text/plain").send(
    script
      .replaceAll("__ANALYZER_URL__", analyzerUrl)
      .replaceAll("__ANALYZER_TOKEN__", token)
  );
});

app.use(express.static(frontendDist));

app.use((request, response, next) => {
  if (request.path.startsWith("/api")) {
    next();
    return;
  }

  response.sendFile(join(frontendDist, "index.html"));
});

await loadPersistedCcuMasterdata();
await loadPersistedCollector();
await loadPersistedNotificationSettings();

app.listen(port, () => {
  console.log(`Homematic Analyzer API läuft auf http://127.0.0.1:${port}`);
});
