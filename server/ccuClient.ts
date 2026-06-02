import { XMLParser } from "fast-xml-parser";
import type { AnalyzeRequest, CcuDevice, CcuEvidence, CcuSnapshot } from "./types.js";

type UnknownRecord = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text",
  parseAttributeValue: false,
  trimValues: true
});

const requestTimeoutMs = 6000;
const xmlApiInstallUrl = "https://github.com/homematic-community/XML-API";

class CcuRequestError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "CcuRequestError";
    this.status = status;
  }
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : {};
}

function stringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function booleanValue(value: unknown): boolean {
  const normalized = String(value ?? "").toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeHost(host: string): string {
  const trimmed = host.trim().replace(/\/$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

async function fetchXml(baseUrl: string, path: string, config: AnalyzeRequest): Promise<UnknownRecord> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const headers: Record<string, string> = {};

  if (config.ccuUser && config.ccuPassword) {
    headers.Authorization = `Basic ${Buffer.from(`${config.ccuUser}:${config.ccuPassword}`).toString("base64")}`;
  }

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new CcuRequestError(`${path} antwortet mit HTTP ${response.status}`, response.status);
    }

    return asRecord(parser.parse(await response.text()));
  } finally {
    clearTimeout(timeout);
  }
}

function collectDatapoints(parsedStateList: UnknownRecord): UnknownRecord[] {
  const stateList = asRecord(parsedStateList.stateList);
  const devices = asArray(asRecord(stateList.devices).device);

  return devices.flatMap((device) => {
    const channels = asArray(asRecord(device).channel);
    return channels.flatMap((channel) => asArray(asRecord(channel).datapoint).map((datapoint) => asRecord(datapoint)));
  });
}

function collectDevices(parsedStateList: UnknownRecord): CcuDevice[] {
  const stateList = asRecord(parsedStateList.stateList);
  const devices = asArray(asRecord(stateList.devices).device);

  return devices.map((deviceValue) => {
    const device = asRecord(deviceValue);
    const name = stringValue(device.name) ?? stringValue(device.address) ?? "Unbenanntes Gerät";
    const channels = asArray(device.channel);
    const datapoints = channels.flatMap((channel) => asArray(asRecord(channel).datapoint).map((datapoint) => asRecord(datapoint)));
    const evidence: CcuEvidence[] = [];

    const lowBatteryDatapoint = datapoints.find((datapoint) => {
      const marker = `${datapoint.type ?? ""} ${datapoint.name ?? ""}`.toUpperCase();
      return /(LOWBAT|LOW_BAT|BATTERY_LOW)/.test(marker) && booleanValue(datapoint.value);
    });

    if (lowBatteryDatapoint) {
      evidence.push({
        source: "CCU Gerätekanal",
        detail: `${name}: Batteriestatus meldet niedrig.`,
        timestamp: stringValue(lowBatteryDatapoint.timestamp)
      });
    }

    const unreachableDatapoint = datapoints.find((datapoint) => {
      const marker = `${datapoint.type ?? ""} ${datapoint.name ?? ""}`.toUpperCase();
      return /(UNREACH|STICKY_UNREACH)/.test(marker) && booleanValue(datapoint.value);
    });

    if (unreachableDatapoint) {
      evidence.push({
        source: "CCU Gerätekanal",
        detail: `${name}: Gerät meldet nicht erreichbar.`,
        timestamp: stringValue(unreachableDatapoint.timestamp)
      });
    }

    const configPendingDatapoint = datapoints.find((datapoint) => {
      const marker = `${datapoint.type ?? ""} ${datapoint.name ?? ""}`.toUpperCase();
      return /(CONFIG_PENDING|PENDING_CONFIG)/.test(marker) && booleanValue(datapoint.value);
    });

    const readyConfigValue = stringValue(device.ready_config);
    const readyConfigPending = readyConfigValue !== undefined && booleanValue(readyConfigValue);

    if (configPendingDatapoint || readyConfigPending) {
      evidence.push({
        source: configPendingDatapoint ? "CCU Gerätekanal" : "CCU Geräteliste",
        detail: `${name}: Konfigurationsdaten stehen zur Übertragung aus.`,
        timestamp: stringValue(configPendingDatapoint?.timestamp)
      });
    }

    return {
      name,
      address: stringValue(device.address),
      type: stringValue(device.type),
      firmware: stringValue(device.firmware),
      lowBattery: Boolean(lowBatteryDatapoint),
      unreachable: Boolean(unreachableDatapoint),
      configPending: Boolean(configPendingDatapoint || readyConfigPending),
      evidence
    };
  });
}

function collectServiceMessages(parsedNotifications: UnknownRecord): CcuEvidence[] {
  const root = asRecord(parsedNotifications.systemNotifications ?? parsedNotifications.systemNotification ?? parsedNotifications);
  const notifications = asArray(root.notification);

  return notifications.map((notificationValue) => {
    const notification = asRecord(notificationValue);
    const type = stringValue(notification.type) ?? "Servicemeldung";
    const message = stringValue(notification.message) ?? stringValue(notification.text) ?? "Keine Meldungsdetails";

    return {
      source: "CCU Servicemeldung",
      detail: `${type}: ${message}`,
      timestamp: stringValue(notification.timestamp)
    };
  });
}

function findDutyCycle(datapoints: UnknownRecord[], serviceMessages: CcuEvidence[]): number | undefined {
  const dutyDatapoint = datapoints.find((datapoint) => {
    const marker = `${datapoint.type ?? ""} ${datapoint.name ?? ""}`.toUpperCase();
    return marker.includes("DUTY_CYCLE") || marker.includes("DUTYCYCLE");
  });

  const dutyValue = numberValue(dutyDatapoint?.value);
  if (dutyValue !== undefined) return dutyValue;

  const dutyMessage = serviceMessages.find((message) => /duty/i.test(message.detail));
  const fromMessage = dutyMessage?.detail.match(/(\d+(?:[.,]\d+)?)\s*%?/);
  return fromMessage ? numberValue(fromMessage[1]) : undefined;
}

function enrichFromServiceMessages(devices: CcuDevice[], serviceMessages: CcuEvidence[]): CcuDevice[] {
  return devices.map((device) => {
    const relatedMessages = serviceMessages.filter((message) => {
      const haystack = message.detail.toLowerCase();
      return Boolean(device.name && haystack.includes(device.name.toLowerCase())) || Boolean(device.address && haystack.includes(device.address.toLowerCase()));
    });

    if (relatedMessages.length === 0) return device;

    const lowBattery = device.lowBattery || relatedMessages.some((message) => /(lowbat|battery|batter)/i.test(message.detail));
    const unreachable = device.unreachable || relatedMessages.some((message) => /(unreach|nicht erreichbar|communication)/i.test(message.detail));
    const configPending = device.configPending || relatedMessages.some((message) => /(config|konfig)/i.test(message.detail));

    return {
      ...device,
      lowBattery,
      unreachable,
      configPending,
      evidence: [...device.evidence, ...relatedMessages]
    };
  });
}

export async function readCcuSnapshot(config: AnalyzeRequest): Promise<CcuSnapshot | undefined> {
  if (!config.ccuHost || !config.ccuUser || !config.ccuPassword) return undefined;

  const baseUrl = normalizeHost(config.ccuHost);
  const collectedAt = new Date().toISOString();

  try {
    const [stateList, notifications] = await Promise.all([
      fetchXml(baseUrl, "/addons/xmlapi/statelist.cgi", config),
      fetchXml(baseUrl, "/addons/xmlapi/systemNotification.cgi", config).catch(() => ({}))
    ]);

    const serviceMessages = collectServiceMessages(notifications);
    const datapoints = collectDatapoints(stateList);
    const devices = enrichFromServiceMessages(collectDevices(stateList), serviceMessages);
    const dutyCycle = findDutyCycle(datapoints, serviceMessages);

    return {
      reachable: true,
      xmlApiInstalled: true,
      source: "xml-api",
      collectedAt,
      devices,
      serviceMessages,
      dutyCycle,
      counters: {
        devices: devices.length,
        lowBattery: devices.filter((device) => device.lowBattery).length,
        unreachable: devices.filter((device) => device.unreachable).length,
        configPending: devices.filter((device) => device.configPending).length,
        serviceMessages: serviceMessages.length
      }
    };
  } catch (error) {
    const status = error instanceof CcuRequestError ? error.status : undefined;
    const xmlApiInstalled = status !== 404;
    const detail = status === 404
      ? `XML-API wurde unter /addons/xmlapi/statelist.cgi nicht gefunden. Installation: ${xmlApiInstallUrl}`
      : error instanceof Error ? error.message : "CCU konnte nicht gelesen werden.";

    return {
      reachable: false,
      xmlApiInstalled,
      source: "xml-api",
      collectedAt,
      error: detail,
      devices: [],
      serviceMessages: [],
      counters: {
        devices: 0,
        lowBattery: 0,
        unreachable: 0,
        configPending: 0,
        serviceMessages: 0
      }
    };
  }
}
