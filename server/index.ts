import cors from "cors";
import express from "express";
import { spawn } from "node:child_process";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
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
import type { CcuMasterdataPayload, CollectorPayload, NotificationSettings } from "./types.js";

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

let latestCollector: CollectorPayload | undefined;
let latestCcuMasterdata: CcuMasterdataPayload | undefined;
let persistedNotificationSettings: NotificationSettings | undefined;

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
  notificationSettings: notificationSettingsSchema.optional()
});

const notificationTestSchema = z.object({
  channel: z.enum(["telegram", "email"]),
  settings: notificationSettingsSchema.optional()
});

const collectorSchema = z.object({
  token: z.string().max(200).optional(),
  host: z.string().max(160).optional(),
  collectedAt: z.string().max(80).optional(),
  system: z.record(z.unknown()).optional(),
  logs: z.array(z.string().max(700)).max(80).optional(),
  network: z.object({
    connections: z.array(z.string().max(700)).max(120).optional()
  }).optional(),
  backups: z.record(z.unknown()).optional()
});

const ccuMasterdataSchema = z.object({
  token: z.string().max(200).optional(),
  source: z.string().max(80).optional(),
  collectedAt: z.string().max(80).optional(),
  deviceCount: z.number().int().nonnegative().optional(),
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

function createSystemDashboard(collector: CollectorPayload | undefined) {
  if (!collector) {
    return { available: false, logs: 0, connections: 0 };
  }

  return {
    available: true,
    host: collector.host,
    collectedAt: collector.collectedAt,
    uptime: stringFromRecord(collector.system, "uptime"),
    memory: stringFromRecord(collector.system, "memory"),
    disk: stringFromRecord(collector.system, "disk"),
    temperature: stringFromRecord(collector.system, "temperatureRaw"),
    cpu: stringFromRecord(collector.system, "cpu"),
    backups: stringFromRecord(collector.backups, "count"),
    backupPaths: stringArrayFromRecord(collector.backups, "paths"),
    logs: collector.logs?.length ?? 0,
    connections: collector.network?.connections?.length ?? 0
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
}

async function persistCcuMasterdata(payload: CcuMasterdataPayload) {
  await updateLocalDatabase(localDatabaseFile, (currentDatabase) => ({
    ...currentDatabase,
    ccuMasterdata: payload
  }));
}

async function persistCollector(payload: CollectorPayload) {
  await updateLocalDatabase(localDatabaseFile, (currentDatabase) => ({
    ...currentDatabase,
    latestCollector: payload
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
    const notificationResult = await sendNotificationSummaries(notificationSettings, checks);

    response.json({
      generatedAt: new Date().toISOString(),
      checks,
      systemDashboard: createSystemDashboard(latestCollector),
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
    response.status(400).json({ error: "Ungültige Collector-Daten", issues: parsed.error.issues });
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
    deviceCount: latestCcuMasterdata?.deviceCount ?? latestCcuMasterdata?.devices?.length ?? 0
  });
});

app.get("/api/settings/notifications", (_request, response) => {
  response.json(mergeNotificationSettings(persistedNotificationSettings));
});

app.get("/api/system/update-status", async (_request, response) => {
  const releaseCheck = await checkRepositoryRelease(appVersion);
  response.json({
    state: releaseCheck.error ? "unknown" : releaseCheck.available ? "update" : "current",
    label: releaseCheck.error ? "Update-Check nicht möglich" : releaseCheck.available ? "Update verfügbar" : "Aktuell",
    detail: releaseCheck.error
      ? `${releaseCheck.error} Die App funktioniert trotzdem.`
      : releaseCheck.available
        ? `Installiert: ${releaseCheck.currentVersion}. Neu auf GitHub: ${releaseCheck.latestVersion}.`
        : releaseCheck.latestVersion
          ? `Installierte Version ${releaseCheck.currentVersion} ist aktuell.`
          : `Installierte Version ${releaseCheck.currentVersion}. Es wurde noch kein GitHub-Release gefunden.`,
    url: releaseCheck.url ?? "https://github.com/Schello805/Homematic-Analyzer",
    checkedAt: releaseCheck.checkedAt
  });
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

app.post("/api/system/update", (_request, response) => {
  const updateScript = join(root, "scripts", "install", "update-local.sh");
  const child = spawn("bash", [updateScript], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ANALYZER_PID: String(process.pid)
    }
  });

  child.unref();

  response.json({
    ok: true,
    message: "Update wurde gestartet. Der Analyzer lädt GitHub-Änderungen, baut neu und startet danach neu.",
    log: ".data/update.log"
  });
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
