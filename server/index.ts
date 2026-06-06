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
import type { CcuMasterdataPayload, CollectorHistoryPoint, CollectorPayload, NotificationSettings, SnifferSnapshot } from "./types.js";

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
const snifferEventsFile = join(dataDir, "sniffer-events.json");
const snifferLogFile = join(dataDir, "sniffer-lines.log");

let latestCollector: CollectorPayload | undefined;
let latestCcuMasterdata: CcuMasterdataPayload | undefined;
let latestSnifferSnapshot: SnifferSnapshot | undefined;
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

const snifferSnapshotSchema = z.object({
  port: z.string().max(300).optional()
});

const setupDefaultsSchema = z.object({
  ccuHost: z.string().max(300).optional(),
  ccuUser: z.string().max(120).optional(),
  xmlApiToken: z.string().max(300).optional(),
  snifferPort: z.string().max(300).optional()
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
    firmware: z.string().max(80).optional(),
    rfAddress: z.union([z.string().max(80), z.number()]).optional(),
    radioAddress: z.union([z.string().max(80), z.number()]).optional(),
    serial: z.string().max(80).optional()
  })).max(1000).optional(),
  askSinDevList: z.object({
    created_at: z.number().optional(),
    devices: z.array(z.object({
      name: z.string().max(200).optional(),
      serial: z.string().max(80).optional(),
      address: z.union([z.number(), z.string().max(80)]).optional()
    })).max(1500).optional()
  }).optional()
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

function recordArrayFromRecord(record: Record<string, unknown> | undefined, key: string): Array<Record<string, unknown>> | undefined {
  const value = record?.[key];
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
}

function backupItemsFromRecord(record: Record<string, unknown> | undefined) {
  return (recordArrayFromRecord(record, "items") ?? []).map((item) => ({
    name: stringFromRecord(item, "name") ?? "",
    path: stringFromRecord(item, "path") ?? "",
    size: stringFromRecord(item, "size") ?? "",
    modifiedAt: stringFromRecord(item, "modifiedAt") ?? ""
  })).filter((item) => item.path || item.name);
}

function numberFromText(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hexAddress(value: number | string | undefined): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") return value.toString(16).toUpperCase().padStart(6, "0");
  const trimmed = value.trim();
  const hex = trimmed.match(/^(?:0x)?([0-9a-f]{6})$/i)?.[1];
  if (hex) return hex.toUpperCase();
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric.toString(16).toUpperCase().padStart(6, "0") : undefined;
}

function buildSnifferDeviceNameMap() {
  const map = new Map<string, { name: string; serial?: string; type?: string }>();
  for (const device of latestCcuMasterdata?.askSinDevList?.devices ?? []) {
    const key = hexAddress(device.address);
    if (!key) continue;
    map.set(key, {
      name: device.name || device.serial || key,
      serial: device.serial
    });
  }

  for (const device of latestCcuMasterdata?.devices ?? []) {
    const name = device.name || device.address || "Unbenanntes Gerät";
    const serial = device.serial ?? device.address;
    const type = device.type;
    const keys = [
      device.address,
      device.serial,
      hexAddress(device.address),
      hexAddress((device as { rfAddress?: string | number }).rfAddress),
      hexAddress((device as { radioAddress?: string | number }).radioAddress)
    ].filter((key): key is string => Boolean(key));

    for (const key of keys) {
      map.set(key.toUpperCase(), { name, serial, type });
    }
  }
  return map;
}

function snifferFlags(flagsInt: number) {
  const flags: string[] = [];
  if (flagsInt & 0x01) flags.push("WKUP");
  if (flagsInt & 0x02) flags.push("WKMEUP");
  if (flagsInt & 0x04) flags.push("BCAST");
  if (flagsInt & 0x10) flags.push("BURST");
  if (flagsInt & 0x20) flags.push("BIDI");
  if (flagsInt & 0x40) flags.push("RPTED");
  if (flagsInt & 0x80) flags.push("RPTEN");
  if (flagsInt === 0) flags.push("HMIP_UNKNOWN");
  return flags.sort();
}

function snifferTelegramType(typeInt: number) {
  const knownTypes: Record<number, string> = {
    0x00: "DEVINFO",
    0x01: "CONFIG",
    0x02: "RESPONSE",
    0x03: "RESPONSE_AES",
    0x04: "KEY_EXCHANGE",
    0x10: "INFO",
    0x11: "ACTION",
    0x12: "HAVE_DATA",
    0x3e: "SWITCH_EVENT",
    0x3f: "TIMESTAMP",
    0x40: "REMOTE_EVENT",
    0x41: "SENSOR_EVENT",
    0x53: "SENSOR_DATA",
    0x58: "CLIMATE_EVENT",
    0x5a: "CLIMATECTRL_EVENT",
    0x5e: "POWER_EVENT",
    0x5f: "POWER_EVENT_CYCLIC",
    0x70: "WEATHER"
  };
  return typeInt >= 0x80 ? "HMIP_TYPE" : knownTypes[typeInt] ?? "";
}

function parseAskSinTelegram(line: string, deviceMap: Map<string, { name: string; serial?: string; type?: string }>) {
  const trimmed = line.trim();
  if (!/^:[0-9a-f]+;$/i.test(trimmed) || trimmed.length <= 23) return undefined;
  const tstamp = new Date().toISOString();

  const fromAddress = trimmed.substring(11, 17).toUpperCase();
  const toAddress = trimmed.substring(17, 23).toUpperCase();
  const fromDevice = deviceMap.get(fromAddress);
  const toDevice = deviceMap.get(toAddress);
  const length = parseInt(trimmed.substring(3, 5), 16);
  const flags = snifferFlags(parseInt(trimmed.substring(7, 9), 16));
  const type = snifferTelegramType(parseInt(trimmed.substring(9, 11), 16));
  const sendTimeMs = flags.includes("BURST")
    ? 360 + (length + 7) * 0.81
    : (length + 11) * 0.81;

  return {
    tstamp,
    raw: trimmed,
    rssi: -1 * parseInt(trimmed.substring(1, 3), 16),
    len: length,
    cnt: parseInt(trimmed.substring(5, 7), 16),
    flags,
    type,
    fromAddress,
    toAddress,
    fromName: fromDevice?.name,
    toName: toDevice?.name,
    fromSerial: fromDevice?.serial,
    toSerial: toDevice?.serial,
    fromType: fromDevice?.type,
    toType: toDevice?.type,
    dutyCycle: sendTimeMs / 360,
    sendTimeMs: Math.round(sendTimeMs * 10) / 10,
    payload: trimmed.substring(23, trimmed.length - 1)
  };
}

function parseRssiNoise(line: string) {
  const trimmed = line.trim();
  if (!/^:[0-9a-f]{2};$/i.test(trimmed)) return undefined;
  return {
    tstamp: new Date().toISOString(),
    raw: trimmed,
    rssi: -1 * parseInt(trimmed.substring(1, 3), 16)
  };
}

function isGatewaySnifferDevice(device: { name?: string; type?: string; serial?: string; address?: string }) {
  const haystack = [device.name, device.type, device.serial, device.address].filter(Boolean).join(" ").toLowerCase();
  return /\b(ccu-rf|hmrf|gateway|lan-gateway|lancfg|hap|drap|access point|access-point|hmip-hap|hmip-drap|hm-lgw)\b/i.test(haystack);
}

async function readSerialSnifferLines(port?: string): Promise<string[]> {
  const trimmedPort = port?.trim();
  if (!trimmedPort || !trimmedPort.startsWith("/dev/")) return [];

  try {
    const stats = await lstat(trimmedPort);
    if (!stats.isCharacterDevice() && !stats.isSymbolicLink()) return [];
  } catch {
    return [];
  }

  return new Promise((resolve) => {
    const command = [
      "stty -F \"$SNIFFER_PORT\" 57600 cs8 -cstopb -parenb -ixon -ixoff raw -echo 2>/dev/null || true",
      "timeout 1s cat \"$SNIFFER_PORT\" 2>/dev/null || true"
    ].join("; ");
    const child = spawn("bash", ["-lc", command], {
      env: { ...process.env, SNIFFER_PORT: trimmedPort },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";

    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", () => resolve([]));
    child.on("close", () => {
      resolve(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-300));
    });
  });
}

async function readSnifferSnapshot(port?: string): Promise<SnifferSnapshot> {
  const checkedAt = new Date().toISOString();
  let lines: string[] = [];
  let source = "Noch keine Snifferdaten empfangen.";

  lines = await readSerialSnifferLines(port);
  if (lines.length > 0) {
    source = port?.trim() ? `Serieller Port ${port.trim()}` : "Serieller Port";
  }

  try {
    if (lines.length === 0) {
      const parsed = JSON.parse(await readFile(snifferEventsFile, "utf8"));
      const parsedRecord = parsed && typeof parsed === "object" ? parsed as { events?: unknown[] } : {};
      const entries: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(parsedRecord.events) ? parsedRecord.events : [];
      lines = entries.map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry)).slice(-300);
      if (lines.length > 0) source = snifferEventsFile;
    }
  } catch {
  }

  if (lines.length === 0) {
    try {
      lines = (await readFile(snifferLogFile, "utf8")).split(/\r?\n/).filter(Boolean).slice(-300);
      if (lines.length > 0) source = snifferLogFile;
    } catch {
    }
  }

  const deviceMap = buildSnifferDeviceNameMap();
  const telegrams = lines.map((line) => parseAskSinTelegram(line, deviceMap)).filter((event): event is NonNullable<typeof event> => Boolean(event));
  const rssiNoises = lines.map(parseRssiNoise).filter((event): event is NonNullable<typeof event> => Boolean(event));
  const diagnostics = lines.filter((line) => !parseAskSinTelegram(line, deviceMap) && !parseRssiNoise(line)).slice(-20);
  const totalDutyCycle = telegrams.reduce((sum, event) => sum + event.dutyCycle, 0);
  const deviceRows = [...telegrams.reduce((map, telegram) => {
    const key = telegram.fromAddress;
    const current = map.get(key) ?? {
      address: key,
      name: telegram.fromName ?? key,
      serial: telegram.fromSerial,
      type: telegram.fromType,
      telegrams: 0,
      dutyCycle: 0,
      sendTimeMs: 0,
      rssiValues: [] as number[],
      lastSeen: checkedAt
    };
    current.telegrams += 1;
    current.dutyCycle += telegram.dutyCycle;
    current.sendTimeMs += telegram.sendTimeMs;
    current.rssiValues.push(telegram.rssi);
    current.lastSeen = checkedAt;
    map.set(key, current);
    return map;
  }, new Map<string, {
    address: string;
    name: string;
    serial?: string;
    type?: string;
    telegrams: number;
    dutyCycle: number;
    sendTimeMs: number;
    rssiValues: number[];
    lastSeen: string;
  }>()).values()].map((row) => ({
    address: row.address,
    name: row.name,
    serial: row.serial,
    type: row.type,
    telegrams: row.telegrams,
    dutyCycle: Math.round(row.dutyCycle * 10) / 10,
    dutyShare: totalDutyCycle > 0 ? Math.round((row.dutyCycle / totalDutyCycle) * 1000) / 10 : 0,
    sendTimeMs: Math.round(row.sendTimeMs),
    avgRssi: row.rssiValues.length ? Math.round(row.rssiValues.reduce((sum, value) => sum + value, 0) / row.rssiValues.length) : undefined,
    lastSeen: row.lastSeen
  })).sort((left, right) => right.dutyCycle - left.dutyCycle || right.telegrams - left.telegrams);
  const weakestTelegram = telegrams
    .filter((event) => Number.isFinite(event.rssi))
    .sort((left, right) => left.rssi - right.rssi)[0];
  const gatewayRows = deviceRows
    .filter(isGatewaySnifferDevice)
    .sort((left, right) => right.dutyCycle - left.dutyCycle || right.telegrams - left.telegrams);
  const carrierSenseValues = rssiNoises.map((noise) => noise.rssi).filter((value): value is number => value !== undefined);
  const carrierSenseAvg = carrierSenseValues.length
    ? Math.round(carrierSenseValues.reduce((sum, value) => sum + value, 0) / carrierSenseValues.length)
    : undefined;

  return {
    checkedAt,
    port: port?.trim() || undefined,
    configured: Boolean(port?.trim()),
    connected: lines.length > 0,
    source,
    summary: {
      rawLines: lines.length,
      telegrams: telegrams.length,
      devices: deviceRows.length,
      dutyCycle: Math.round(totalDutyCycle * 10) / 10,
      carrierSense: carrierSenseValues.at(-1),
      carrierSenseAvg,
      weakestRssi: weakestTelegram?.rssi,
      weakestRssiDevice: weakestTelegram
        ? deviceRows.find((device) => device.address === weakestTelegram.fromAddress)
        : undefined,
      gateways: gatewayRows
    },
    devices: deviceRows,
    events: telegrams.slice(-40).reverse(),
    rssiNoise: rssiNoises.slice(-80),
    diagnostics
  };
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
  const collectorBackupItems = backupItemsFromRecord(collector?.backups);
  const ccuBackupItems = backupItemsFromRecord(ccuBackups);

  if (!hasCcuSystemData && !collector) {
    return { available: false, logs: 0, connections: 0, ...ccuTarget };
  }

  return {
    available: true,
    host: stringFromRecord(ccuSystem, "host") ?? collector?.host,
    ...ccuTarget,
    collectedAt: collector?.collectedAt ?? masterdata?.collectedAt,
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
    backupItems: collectorBackupItems.length > 0 ? collectorBackupItems : ccuBackupItems,
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
    ...latestCcuMasterdata,
    ...parsed.data,
    collectedAt: parsed.data.collectedAt ?? new Date().toISOString(),
    system: parsed.data.system ?? latestCcuMasterdata?.system,
    backups: parsed.data.backups ?? latestCcuMasterdata?.backups,
    devices: parsed.data.devices ?? latestCcuMasterdata?.devices,
    askSinDevList: parsed.data.askSinDevList ?? latestCcuMasterdata?.askSinDevList,
    deviceCount: parsed.data.deviceCount ?? latestCcuMasterdata?.deviceCount ?? parsed.data.devices?.length ?? latestCcuMasterdata?.devices?.length
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

app.post("/api/sniffer/snapshot", async (request, response) => {
  const parsed = snifferSnapshotSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "Ungültige Sniffer-Anfrage", issues: parsed.error.issues });
    return;
  }

  latestSnifferSnapshot = await readSnifferSnapshot(parsed.data.port);
  response.json(latestSnifferSnapshot);
});

app.get("/api/setup/defaults", async (_request, response) => {
  const database = await readLocalDatabase(localDatabaseFile);
  response.json(database.setupDefaults ?? {});
});

app.post("/api/setup/defaults", async (request, response) => {
  const parsed = setupDefaultsSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "Ungültige Setup-Daten", issues: parsed.error.issues });
    return;
  }

  const cleanDefaults = Object.fromEntries(
    Object.entries(parsed.data)
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
  await updateLocalDatabase(localDatabaseFile, (currentDatabase) => {
    const nextSetupDefaults = { ...currentDatabase.setupDefaults };
    for (const [key, value] of Object.entries(cleanDefaults)) {
      if (value) {
        nextSetupDefaults[key as keyof typeof nextSetupDefaults] = value;
      } else {
        delete nextSetupDefaults[key as keyof typeof nextSetupDefaults];
      }
    }
    return {
      ...currentDatabase,
      setupDefaults: nextSetupDefaults
    };
  });
  response.json({ ok: true, setupDefaults: cleanDefaults });
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
    const snifferSnapshot = parsed.data.snifferPort
      ? await readSnifferSnapshot(parsed.data.snifferPort)
      : latestSnifferSnapshot;
    latestSnifferSnapshot = snifferSnapshot;

    const checks = createAnalysis({ ...parsed.data, notificationSettings }, latestCollector, ccuSnapshot, latestCcuMasterdata, releaseCheck, snifferSnapshot);
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
    systemAvailable: Boolean(latestCcuMasterdata?.system || latestCcuMasterdata?.backups),
    askSinDevListAvailable: Boolean(latestCcuMasterdata?.askSinDevList?.devices?.length),
    askSinDevListCount: latestCcuMasterdata?.askSinDevList?.devices?.length ?? 0
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

app.get("/api/asksin-devlist/script", async (request, response) => {
  const analyzerUrl = String(request.query.url ?? `http://127.0.0.1:${port}`);
  const token = String(request.query.token ?? "bitte-token-aendern");
  const scriptPath = join(root, "scripts", "ccu", "asksin-devlist.rega");
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
