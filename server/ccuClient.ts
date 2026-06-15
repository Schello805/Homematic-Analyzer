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
const xmlApiRequestTimeoutMs = 12000;
const xmlApiStateListTimeoutMs = 30000;
const xmlApiInstallUrl = "https://github.com/homematic-community/XML-API";

class CcuRequestError extends Error {
  status?: number;
  code?: CcuSnapshot["errorCode"];

  constructor(message: string, status?: number, code?: CcuSnapshot["errorCode"]) {
    super(message);
    this.name = "CcuRequestError";
    this.status = status;
    this.code = code;
  }
}

type CcuDiagnostic = NonNullable<CcuSnapshot["diagnostics"]>[number];

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

function replacementCount(value: string) {
  return (value.match(/\uFFFD/g) ?? []).length;
}

function decodeXmlBuffer(buffer: Buffer): { text: string; encoding: "utf8" | "latin1" } {
  const utf8Text = buffer.toString("utf8");
  const latin1Text = buffer.toString("latin1");
  return replacementCount(utf8Text) > replacementCount(latin1Text)
    ? { text: latin1Text, encoding: "latin1" }
    : { text: utf8Text, encoding: "utf8" };
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function stripInterfacePrefix(value: string): string {
  return value.replace(/^[A-Za-z]+(?:-[A-Za-z]+)?\./, "");
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
  return datapointName ? stripInterfacePrefix(datapointName).split(":")[0] : undefined;
}

function inferDeviceType(device: UnknownRecord): string | undefined {
  const explicitType = stringValue(device.type);
  if (explicitType) return explicitType;

  const datapointName = firstDatapointName(device);
  const address = datapointName ? stripInterfacePrefix(datapointName).split(":")[0] : undefined;
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

export function xmlApiTimeoutForPath(path: string) {
  return path.endsWith("/statelist.cgi") ? xmlApiStateListTimeoutMs : xmlApiRequestTimeoutMs;
}

async function fetchXml(endpoint: CcuEndpoint, path: string, config: AnalyzeRequest): Promise<UnknownRecord> {
  const timeoutMs = xmlApiTimeoutForPath(path);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
      throw new CcuRequestError(`${path} antwortet mit HTTP ${response.status}`, response.status, response.status === 404 ? "xml-api-missing" : "http");
    }

    const decoded = decodeXmlBuffer(Buffer.from(await response.arrayBuffer()));
    console.info(`[CCU DEBUG] XML ${path}: encoding=${decoded.encoding}, chars=${decoded.text.length}, replacements=${replacementCount(decoded.text)}`);
    return asRecord(parser.parse(decoded.text));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      const endpointName = path.split("/").pop() ?? path;
      throw new CcuRequestError(
        `${endpointName} antwortete nicht innerhalb von ${timeoutMs / 1000} Sekunden. Die XML-API-Antwort wurde nicht rechtzeitig vollständig übertragen.`,
        undefined,
        "timeout"
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function classifyCcuConnectionError(error: unknown): {
  code: NonNullable<CcuSnapshot["errorCode"]>;
  detail: string;
} {
  if (error instanceof CcuRequestError && error.code) {
    return { code: error.code, detail: error.message };
  }

  if (error instanceof Error && error.name === "AbortError") {
    return {
      code: "timeout",
      detail: `Zeitüberschreitung nach ${requestTimeoutMs / 1000} Sekunden. Der Analyzer-Server erhielt keine rechtzeitige Antwort.`
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const causeCode = error instanceof Error && typeof error.cause === "object" && error.cause !== null && "code" in error.cause
    ? String((error.cause as { code?: unknown }).code ?? "")
    : "";

  if (/ENOTFOUND|EAI_AGAIN/i.test(`${causeCode} ${message}`)) {
    return { code: "dns", detail: "Der Hostname konnte vom Analyzer-Server nicht in eine IP-Adresse aufgelöst werden." };
  }
  if (/ECONNREFUSED/i.test(`${causeCode} ${message}`)) {
    return { code: "connection-refused", detail: "Die Zieladresse wurde erreicht, aber die Verbindung wurde am angegebenen Port abgelehnt." };
  }
  if (/EHOSTUNREACH|ENETUNREACH|ECONNRESET/i.test(`${causeCode} ${message}`)) {
    return { code: "network", detail: "Der Analyzer-Server hat keine funktionierende Netzwerkroute zur CCU oder die Verbindung wurde unterwegs getrennt." };
  }
  if (/CERT_|certificate|self.signed|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY/i.test(`${causeCode} ${message}`)) {
    return { code: "tls", detail: "Die HTTPS-Verbindung wurde wegen eines nicht vertrauenswürdigen oder selbstsignierten CCU-Zertifikats abgelehnt." };
  }
  if (/not_authenticated|Nicht authentifiziert/i.test(message)) {
    return { code: "authentication", detail: message };
  }

  return { code: "unknown", detail: message || "Unbekannter Verbindungsfehler." };
}

async function probeCcuWebUi(endpoint: CcuEndpoint): Promise<{ reachable: boolean; detail: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(endpoint.baseUrl, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal
    });
    return {
      reachable: true,
      detail: `Die CCU antwortet dem Analyzer-Server unter ${endpoint.baseUrl} mit HTTP ${response.status}.`
    };
  } catch (error) {
    return {
      reachable: false,
      detail: classifyCcuConnectionError(error).detail
    };
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

function addNameAlias(nameMap: Map<string, string>, key: unknown, name: string | undefined) {
  const normalizedKey = stringValue(key)?.trim();
  if (!normalizedKey || !name) return;
  for (const alias of identifierCandidates(normalizedKey)) {
    nameMap.set(alias, name);
  }
}

function collectNameMap(parsedStateList: UnknownRecord): Map<string, string> {
  const nameMap = new Map<string, string>();
  const devices = getStateListDevices(parsedStateList);

  for (const deviceValue of devices) {
    const device = asRecord(deviceValue);
    const deviceName = stringValue(device.name) ?? stringValue(device.address);
    const deviceAddress = inferAddress(device);
    addNameAlias(nameMap, device.ise_id, deviceName);
    addNameAlias(nameMap, deviceAddress, deviceName);
    addNameAlias(nameMap, device.name, deviceName);

    for (const channelValue of asArray(device.channel)) {
      const channel = asRecord(channelValue);
      const channelName = stringValue(channel.name) ?? deviceName;
      const channelAddress = stringValue(channel.address);
      addNameAlias(nameMap, channel.ise_id, channelName);
      addNameAlias(nameMap, channelAddress, channelName);
      addNameAlias(nameMap, channel.name, channelName);

      for (const datapointValue of asArray(channel.datapoint)) {
        const datapoint = asRecord(datapointValue);
        const datapointName = stringValue(datapoint.name);
        addNameAlias(nameMap, datapoint.ise_id, channelName);
        addNameAlias(nameMap, datapointName, channelName);
        if (datapointName?.includes(".")) {
          addNameAlias(nameMap, datapointName.split(".").slice(0, -1).join("."), channelName);
        }
      }
    }
  }

  console.info("[CCU DEBUG] NameMap", JSON.stringify({
    devices: devices.length,
    aliases: nameMap.size,
    sampleDeviceNames: devices.slice(0, 8).map((deviceValue) => stringValue(asRecord(deviceValue).name)),
    replacementNames: devices
      .map((deviceValue) => stringValue(asRecord(deviceValue).name) ?? "")
      .filter((name) => name.includes("\uFFFD"))
      .slice(0, 8)
  }));

  return nameMap;
}

export function collectDevices(parsedStateList: UnknownRecord): CcuDevice[] {
  const devices = getStateListDevices(parsedStateList);

  return devices.map((deviceValue) => {
    const device = asRecord(deviceValue);
    const name = stringValue(device.name) ?? stringValue(device.address) ?? "Unbenanntes Gerät";
    const address = inferAddress(device);
    const type = inferDeviceType(device);
    const channels = asArray(device.channel);
    const datapoints = channels.flatMap((channel) => asArray(asRecord(channel).datapoint).map((datapoint) => asRecord(datapoint)));
    const evidence: CcuEvidence[] = [];
    const findNumericDatapoint = (parameterName: string) => {
      const datapoint = datapoints.find((candidate) => {
        const marker = `${candidate.type ?? ""} ${candidate.name ?? ""}`.toUpperCase();
        return marker.includes(parameterName);
      });
      return numberValue(datapoint?.value);
    };
    const normalizeRssi = (value?: number) => (
      value !== undefined && value >= -150 && value < 0 ? value : undefined
    );
    const rssiDevice = normalizeRssi(findNumericDatapoint("RSSI_DEVICE"));
    const rssiPeer = normalizeRssi(findNumericDatapoint("RSSI_PEER"));

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
      rssiDevice,
      rssiPeer,
      lowBattery: Boolean(lowBatteryDatapoint),
      unreachable: false,
      configPending: Boolean(configPendingDatapoint || readyConfigPending),
      evidence
    };
  });
}

function readableServiceMessageType(type: string): string {
  const normalizedType = normalizeText(type);
  if (normalizedType.includes("unreach")) return "Gerätekommunikation gestört";
  if (normalizedType.includes("lowbat")) return "Batterie niedrig";
  if (normalizedType.includes("config")) return "Konfiguration ausstehend";
  return type;
}

function identifierCandidates(value: unknown): string[] {
  const text = stringValue(value)?.trim();
  if (!text) return [];

  const candidates = new Set<string>([text]);

  const withoutInterface = stripInterfacePrefix(text);
  candidates.add(withoutInterface);

  if (text.includes(".")) {
    candidates.add(text.split(".").slice(0, -1).join("."));
  }
  if (withoutInterface.includes(".")) {
    candidates.add(withoutInterface.split(".").slice(0, -1).join("."));
  }

  const normalizedUnreach = text.replace(/\.STICKY_UNREACH$/i, ".UNREACH");
  candidates.add(normalizedUnreach);
  candidates.add(stripInterfacePrefix(normalizedUnreach));
  const stickyUnreach = text.replace(/\.UNREACH$/i, ".STICKY_UNREACH");
  candidates.add(stickyUnreach);
  candidates.add(stripInterfacePrefix(stickyUnreach));

  const addressMatches = text.match(/[A-Z]{2,}[A-Z0-9]{5,}(?::\d+)?/gi) ?? [];
  for (const match of addressMatches) {
    candidates.add(match);
    candidates.add(stripInterfacePrefix(match));
    if (match.includes(":")) {
      candidates.add(match.split(":")[0]);
    }
  }

  return [...candidates];
}

function resolveServiceMessageName(notification: UnknownRecord, nameMap: Map<string, string>): string | undefined {
  const preferredFields = ["name", "device", "channel", "object", "ise_id", "device_id", "channel_id", "object_id", "datapoint_id"];
  for (const field of preferredFields) {
    for (const candidate of identifierCandidates(notification[field])) {
      const resolvedName = nameMap.get(candidate);
      if (resolvedName) return resolvedName;
    }
  }

  for (const value of Object.values(notification)) {
    for (const candidate of identifierCandidates(value)) {
      const resolvedName = nameMap.get(candidate);
      if (resolvedName) return resolvedName;
    }
  }

  const directName = stringValue(notification.name) ?? stringValue(notification.device) ?? stringValue(notification.channel) ?? stringValue(notification.object);
  if (directName && !/[A-Z]{2,}[A-Z0-9]{5,}(?::\d+)?/i.test(directName)) {
    return directName;
  }

  return undefined;
}

function collectMessages(parsedNotifications: UnknownRecord, nameMap: Map<string, string>, source: string): CcuEvidence[] {
  const root = asRecord(
    parsedNotifications.systemNotifications
    ?? parsedNotifications.systemNotification
    ?? parsedNotifications.alarmMessages
    ?? parsedNotifications.alarmmessages
    ?? parsedNotifications.alarms
    ?? parsedNotifications
  );
  const notifications = asArray(root.notification ?? root.alarm ?? root.alarmmessage ?? root.message);
  const activeNotifications = notifications.filter((notificationValue) => {
    const notification = asRecord(notificationValue);
    const haystack = Object.values(notification).map((value) => String(value ?? "")).join(" ").toUpperCase();
    return !haystack.includes("STICKY_UNREACH");
  });
  const skippedSticky = notifications.length - activeNotifications.length;

  console.info("[CCU DEBUG] ServiceMessages", JSON.stringify({
    source,
    raw: notifications.length,
    active: activeNotifications.length,
    skippedStickyUnreach: skippedSticky
  }));

  return activeNotifications.map((notificationValue, index) => {
    const notification = asRecord(notificationValue);
    const type = stringValue(notification.type) ?? "Servicemeldung";
    const readableType = readableServiceMessageType(type);
    const name = resolveServiceMessageName(notification, nameMap);
    const message = stringValue(notification.message)
      ?? stringValue(notification.text)
      ?? stringValue(notification.value)
      ?? readableType;
    const debugCandidates = [
      ...new Set(Object.values(notification).flatMap((value) => identifierCandidates(value)).filter(Boolean))
    ].slice(0, 12);

    if (index < 12) {
      console.info("[CCU DEBUG] ServiceMessage", JSON.stringify({
        index,
        rawType: type,
        rawName: notification.name,
        rawIseId: notification.ise_id ?? notification.object_id ?? notification.channel_id,
        message,
        resolvedName: name ?? null,
        candidates: debugCandidates,
        matched: debugCandidates.filter((candidate) => nameMap.has(candidate)).slice(0, 5)
      }));
    }

    return {
      source,
      detail: name ? `${name}: ${message}` : `${readableType}: ${message}`,
      timestamp: stringValue(notification.timestamp)
    };
  });
}

function collectServiceMessages(parsedNotifications: UnknownRecord, nameMap: Map<string, string>): CcuEvidence[] {
  return collectMessages(parsedNotifications, nameMap, "CCU Servicemeldung");
}

function collectAlarmMessages(parsedNotifications: UnknownRecord, nameMap: Map<string, string>): CcuEvidence[] {
  return collectMessages(parsedNotifications, nameMap, "CCU Alarmmeldung");
}

function findDutyCycle(datapoints: UnknownRecord[], serviceMessages: CcuEvidence[]): number | undefined {
  const dutyCandidates = datapoints.filter((datapoint) => {
    const marker = `${datapoint.type ?? ""} ${datapoint.name ?? ""}`.toUpperCase();
    return marker.includes("DUTY_CYCLE") || marker.includes("DUTYCYCLE") || marker.includes("DUTY");
  });
  console.info("[CCU DEBUG] Duty candidates", JSON.stringify(dutyCandidates.slice(0, 10).map((datapoint) => ({
    name: datapoint.name,
    type: datapoint.type,
    value: datapoint.value,
    valueUnit: datapoint.valueunit,
    timestamp: datapoint.timestamp
  }))));

  const dutyDatapoint = dutyCandidates.find((datapoint) => numberValue(datapoint.value) !== undefined);
  const dutyValue = numberValue(dutyDatapoint?.value);
  if (dutyValue !== undefined) return dutyValue;

  const dutyMessage = serviceMessages.find((message) => /duty/i.test(message.detail));
  console.info("[CCU DEBUG] Duty service message", JSON.stringify(dutyMessage ?? null));
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
    const hasUnreachServiceMessage = relatedMessages.some((message) => {
      const detail = normalizeText(message.detail);
      return /unreach|nicht erreichbar|kommunikation|communication|geratekommunikation gestort/.test(detail);
    });
    const unreachable = device.unreachable || hasUnreachServiceMessage;
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
  const diagnostics: CcuDiagnostic[] = [];
  const webUiProbe = await probeCcuWebUi(endpoint);
  diagnostics.push({
    step: "Netzwerk / WebUI",
    status: webUiProbe.reachable ? "ok" : "failed",
    detail: webUiProbe.detail
  });

  try {
    if (!activeSid && hasCredentials) {
      activeSid = await loginToCcu(endpoint, config) ?? await loginToXmlApi(endpoint, config);
      if (activeSid) {
        sessionWasCreated = true;
        diagnostics.push({
          step: "CCU-Anmeldung",
          status: "ok",
          detail: "Der Analyzer-Server konnte eine Sitzung bei der CCU anlegen."
        });
      } else {
        activeSid = undefined;
        diagnostics.push({
          step: "CCU-Anmeldung",
          status: "failed",
          detail: "Mit Benutzername und Passwort konnte keine CCU-Sitzung erzeugt werden. Ein separat eingetragener XML-API-Token wird trotzdem geprüft."
        });
      }
    } else if (activeSid) {
      diagnostics.push({
        step: "XML-API-Token",
        status: "ok",
        detail: "Ein XML-API-Token ist eingetragen und wird für die Abfrage verwendet."
      });
    }

    const endpointWithAuth = {
      ...endpoint,
      sid: activeSid
    };

    const xmlApiStartedAt = Date.now();
    const [stateList, notifications, alarms] = await Promise.all([
      fetchXml(endpointWithAuth, "/addons/xmlapi/statelist.cgi", config),
      fetchXml(endpointWithAuth, "/addons/xmlapi/systemNotification.cgi", config).catch(() => ({})),
      fetchXml(endpointWithAuth, "/addons/xmlapi/alarmmessages.cgi", config).catch(() => ({}))
    ]);

    const xmlError = detectXmlError(stateList);
    if (xmlError) {
      throw new CcuRequestError(xmlError, undefined, "authentication");
    }

    if (!hasStateList(stateList)) {
      throw new CcuRequestError("XML-API wurde erreicht, lieferte aber keine Geräteliste. Bitte stelle sicher, dass Geräte in der CCU angelernt sind.", undefined, "empty-data");
    }
    diagnostics.push({
      step: "XML-API",
      status: "ok",
      detail: `${endpoint.basePath ?? "/addons/xmlapi"}/statelist.cgi lieferte die Geräteliste nach ${((Date.now() - xmlApiStartedAt) / 1000).toFixed(1)} Sekunden.`
    });

    const nameMap = collectNameMap(stateList);
    const serviceMessages = collectServiceMessages(notifications, nameMap);
    const alarmMessages = collectAlarmMessages(alarms, nameMap);
    const datapoints = collectDatapoints(stateList);
    const devices = enrichFromServiceMessages(collectDevices(stateList), serviceMessages);
    const dutyCycle = findDutyCycle(datapoints, serviceMessages);

    return {
      reachable: true,
      xmlApiInstalled: true,
      webUiReachable: webUiProbe.reachable,
      xmlApiReachable: true,
      authentication: "ok",
      diagnostics,
      source: "xml-api",
      collectedAt,
      devices,
      serviceMessages,
      alarmMessages,
      dutyCycle,
      counters: {
        devices: devices.length,
        lowBattery: devices.filter((device) => device.lowBattery).length,
        unreachable: devices.filter((device) => device.unreachable).length,
        configPending: devices.filter((device) => device.configPending).length,
        serviceMessages: serviceMessages.length,
        alarmMessages: alarmMessages.length
      }
    };
  } catch (error) {
    const status = error instanceof CcuRequestError ? error.status : undefined;
    const classified = classifyCcuConnectionError(error);
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
    diagnostics.push({
      step: "XML-API Geräteliste",
      status: "failed",
      detail: classified.detail
    });

    return {
      reachable: false,
      xmlApiInstalled,
      webUiReachable: webUiProbe.reachable,
      xmlApiReachable: !["dns", "timeout", "connection-refused", "network", "tls"].includes(classified.code),
      authentication: classified.code === "authentication" || isNotAuthenticated ? "failed" : activeSid ? "not-tested" : "failed",
      errorCode: classified.code,
      diagnostics,
      source: "xml-api",
      collectedAt,
      error: detail,
      devices: [],
      serviceMessages: [],
      alarmMessages: [],
      counters: {
        devices: 0,
        lowBattery: 0,
        unreachable: 0,
        configPending: 0,
        serviceMessages: 0,
        alarmMessages: 0
      }
    };
  } finally {
    if (sessionWasCreated && activeSid) {
      void logoutFromCcu(endpoint, activeSid);
    }
  }
}
