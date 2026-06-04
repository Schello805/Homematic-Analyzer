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

function firstDatapointName(device: UnknownRecord): string | undefined {
  const channels = asArray(device.channel);
  const datapoints = channels.flatMap((channel) => asArray(asRecord(channel).datapoint).map((datapoint) => asRecord(datapoint)));
  return stringValue(datapoints[0]?.name);
}

function inferAddress(device: UnknownRecord): string | undefined {
  const explicitAddress = stringValue(device.address);
  if (explicitAddress) return explicitAddress;

  const datapointName = firstDatapointName(device);
  return datapointName?.split(":")[0];
}

function inferDeviceType(device: UnknownRecord): string | undefined {
  const explicitType = stringValue(device.type);
  if (explicitType) return explicitType;

  const datapointName = firstDatapointName(device);
  const address = datapointName?.split(":")[0];
  return address?.split(".")[0];
}

type CcuEndpoint = {
  baseUrl: string;
  basePath?: string;
  sid?: string;
};

function parseCcuEndpoint(host: string): CcuEndpoint {
  const trimmed = host.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsedUrl = new URL(withProtocol);
  const sid = parsedUrl.searchParams.get("sid") ?? undefined;

  let basePath = undefined;
  const lowercasePath = parsedUrl.pathname.toLowerCase();
  if (lowercasePath.includes("/addons/xmlapi") || lowercasePath.includes("/config/xmlapi")) {
    const normalizedPath = parsedUrl.pathname.replace(/\/+$/, "");
    basePath = normalizedPath.endsWith(".cgi")
      ? normalizedPath.split("/").slice(0, -1).join("/")
      : normalizedPath;
  }

  return {
    baseUrl: parsedUrl.origin,
    basePath,
    sid
  };
}

function normalizeSidToken(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  try {
    const parsedUrl = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://token.invalid/?${trimmed}`);
    const sidFromUrl = parsedUrl.searchParams.get("sid");
    if (sidFromUrl) return normalizeSidToken(sidFromUrl);
  } catch {
  }

  const sidAssignment = trimmed.match(/(?:^|[?&\s])sid=([^&\s]+)/i)?.[1];
  if (sidAssignment) return normalizeSidToken(decodeURIComponent(sidAssignment));

  const tokenMatch = trimmed.match(/@?[A-Za-z0-9_-]{8,}@?/);
  if (!tokenMatch) return trimmed;

  return tokenMatch[0].replace(/^@/, "").replace(/@$/, "");
}

function buildXmlApiUrl(endpoint: CcuEndpoint, path: string): string {
  let url: URL;
  if (endpoint.basePath) {
    const file = path.split("/").pop() ?? "";
    url = new URL(`${endpoint.basePath}/${file}`, endpoint.baseUrl);
  } else {
    url = new URL(path, endpoint.baseUrl);
  }

  if (endpoint.sid) {
    url.searchParams.set("sid", endpoint.sid);
  }

  // Replace %40 back to @ since CCU XML-API expects raw '@'
  return url.toString().replace(/%40/g, "@");
}

function detectXmlError(parsedXml: UnknownRecord): string | undefined {
  if (parsedXml.error) {
    return stringValue(parsedXml.error);
  }
  const result = asRecord(parsedXml.result);
  if (result.error) {
    return stringValue(result.error);
  }
  const stateList = asRecord(parsedXml.stateList);
  if ("not_authenticated" in stateList) {
    return "Nicht authentifiziert (not_authenticated). Die XML-API erwartet einen gültigen Token (sid).";
  }
  return undefined;
}

function findSidValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.startsWith("@") && value.endsWith("@")) {
    return value;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const sid = findSidValue(entry);
      if (sid) return sid;
    }
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value as UnknownRecord)) {
      if (/^(sid|session_id|sessionid)$/i.test(key)) {
        const directSid = stringValue(entry);
        if (directSid?.startsWith("@") && directSid.endsWith("@")) return directSid;
      }

      const sid = findSidValue(entry);
      if (sid) return sid;
    }
  }

  return undefined;
}

async function fetchXml(endpoint: CcuEndpoint, path: string, config: AnalyzeRequest): Promise<UnknownRecord> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const headers: Record<string, string> = {};

  const passwordIsSid = Boolean(
    config.ccuPassword?.trim().startsWith("@") && config.ccuPassword.trim().endsWith("@")
  ) || Boolean(config.ccuPassword && !config.ccuUser);

  if (!endpoint.sid && config.ccuUser && config.ccuPassword && !passwordIsSid) {
    headers.Authorization = `Basic ${Buffer.from(`${config.ccuUser}:${config.ccuPassword}`).toString("base64")}`;
  }

  try {
    const response = await fetch(buildXmlApiUrl(endpoint, path), {
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
  const devices = getStateListDevices(parsedStateList);

  return devices.flatMap((device) => {
    const channels = asArray(asRecord(device).channel);
    return channels.flatMap((channel) => asArray(asRecord(channel).datapoint).map((datapoint) => asRecord(datapoint)));
  });
}

function getStateListDevices(parsedStateList: UnknownRecord): UnknownRecord[] {
  const stateList = asRecord(parsedStateList.stateList);
  const nestedDevices = asRecord(stateList.devices).device;
  const directDevices = stateList.device;

  return asArray(nestedDevices ?? directDevices).map((device) => asRecord(device));
}

function hasStateList(parsedStateList: UnknownRecord): boolean {
  return getStateListDevices(parsedStateList).length > 0;
}

function collectDevices(parsedStateList: UnknownRecord): CcuDevice[] {
  const devices = getStateListDevices(parsedStateList);

  return devices.map((deviceValue) => {
    const device = asRecord(deviceValue);
    const name = stringValue(device.name) ?? stringValue(device.address) ?? "Unbenanntes Gerät";
    const address = inferAddress(device);
    const type = inferDeviceType(device);
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
      address,
      type,
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

async function loginToCcu(endpoint: CcuEndpoint, config: AnalyzeRequest): Promise<string | undefined> {
  if (!config.ccuUser || !config.ccuPassword) return undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const loginUrl = new URL("/api/homematic.cgi", endpoint.baseUrl).toString();
    const response = await fetch(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "Session.login",
        params: {
          username: config.ccuUser,
          password: config.ccuPassword
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) return undefined;

    const data = await response.json() as { result?: string; error?: unknown };
    if (data.result && typeof data.result === "string" && data.result.startsWith("@")) {
      return data.result;
    }
  } catch (err) {
    console.error("CCU Login Fehler:", err);
  } finally {
    clearTimeout(timeout);
  }
  return undefined;
}

function buildXmlApiLoginUrls(endpoint: CcuEndpoint, config: AnalyzeRequest): string[] {
  const paths = endpoint.basePath
    ? [endpoint.basePath]
    : ["/addons/xmlapi", "/config/xmlapi"];

  return paths.map((path) => {
    const url = new URL(`${path.replace(/\/+$/, "")}/login.cgi`, endpoint.baseUrl);
    url.searchParams.set("user", config.ccuUser ?? "");
    url.searchParams.set("password", config.ccuPassword ?? "");
    return url.toString();
  });
}

async function loginToXmlApi(endpoint: CcuEndpoint, config: AnalyzeRequest): Promise<string | undefined> {
  if (!config.ccuUser || !config.ccuPassword) return undefined;

  for (const loginUrl of buildXmlApiLoginUrls(endpoint, config)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetch(loginUrl, { signal: controller.signal });
      if (!response.ok) continue;

      const text = await response.text();
      const sidFromText = text.match(/@[A-Za-z0-9]+@/)?.[0];
      if (sidFromText) return sidFromText;

      const sidFromXml = findSidValue(asRecord(parser.parse(text)));
      if (sidFromXml) return sidFromXml;
    } catch {
    } finally {
      clearTimeout(timeout);
    }
  }

  return undefined;
}

async function logoutFromCcu(endpoint: CcuEndpoint, sid: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const logoutUrl = new URL("/api/homematic.cgi", endpoint.baseUrl).toString();
    await fetch(logoutUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "Session.logout",
        params: {
          _session_id_: sid
        }
      }),
      signal: controller.signal
    });
  } catch {
    // Ignore logout errors
  } finally {
    clearTimeout(timeout);
  }
}

export async function readCcuSnapshot(config: AnalyzeRequest): Promise<CcuSnapshot | undefined> {
  if (!config.ccuHost) return undefined;

  const endpoint = parseCcuEndpoint(config.ccuHost);
  const explicitSid = normalizeSidToken(config.xmlApiToken) ?? normalizeSidToken(endpoint.sid);

  // Treat password as sid token if it starts/ends with @ OR if ccuUser is empty
  const passwordIsSid = Boolean(
    config.ccuPassword?.trim().startsWith("@") && config.ccuPassword.trim().endsWith("@")
  ) || Boolean(config.ccuPassword && !config.ccuUser);

  if (explicitSid) {
    endpoint.sid = explicitSid;
  } else if (!endpoint.sid && passwordIsSid && config.ccuPassword) {
    endpoint.sid = normalizeSidToken(config.ccuPassword);
  }

  const hasCredentials = Boolean(config.ccuUser && config.ccuPassword && !passwordIsSid);
  const hasSid = Boolean(endpoint.sid);
  if (!hasCredentials && !hasSid) return undefined;

  let activeSid: string | undefined = endpoint.sid;
  let sessionWasCreated = false;
  const collectedAt = new Date().toISOString();

  try {
    if (!activeSid && hasCredentials) {
      activeSid = await loginToCcu(endpoint, config) ?? await loginToXmlApi(endpoint, config);
      if (activeSid) {
        sessionWasCreated = true;
      } else {
        activeSid = undefined;
      }
    }

    const endpointWithAuth = {
      ...endpoint,
      sid: activeSid
    };

    const [stateList, notifications] = await Promise.all([
      fetchXml(endpointWithAuth, "/addons/xmlapi/statelist.cgi", config),
      fetchXml(endpointWithAuth, "/addons/xmlapi/systemNotification.cgi", config).catch(() => ({}))
    ]);

    const xmlError = detectXmlError(stateList);
    if (xmlError) {
      throw new CcuRequestError(xmlError);
    }

    if (!hasStateList(stateList)) {
      throw new CcuRequestError("XML-API wurde erreicht, lieferte aber keine Geräteliste. Bitte stelle sicher, dass Geräte in der CCU angelernt sind.");
    }

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
    const message = error instanceof Error ? error.message : "CCU konnte nicht gelesen werden.";
    const isNotAuthenticated = /not_authenticated|Nicht authentifiziert/i.test(message);
    const detail = status === 404
      ? `XML-API wurde unter /addons/xmlapi/statelist.cgi nicht gefunden. Installation: ${xmlApiInstallUrl}`
      : isNotAuthenticated
        ? endpoint.sid
          ? `${message} Der eingetragene XML-API Token wurde abgelehnt. Bitte Token in der XML-API Zusatzsoftware neu kopieren oder neu registrieren. Geprüfter Pfad: ${endpoint.basePath ?? "/addons/xmlapi"}.`
          : `${message} Das normale CCU-Passwort reicht für XML-API v2 nicht aus. Bitte in der XML-API Zusatzsoftware einen Token registrieren und im Feld „XML-API Token / sid“ eintragen. Geprüfter Pfad: ${endpoint.basePath ?? "/addons/xmlapi"}.`
        : `${message} Geprüfter Pfad: ${endpoint.basePath ?? "/addons/xmlapi"}.`;

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
  } finally {
    if (sessionWasCreated && activeSid) {
      void logoutFromCcu(endpoint, activeSid);
    }
  }
}
