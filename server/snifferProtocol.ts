import type { SnifferTelegram } from "./types.js";

export type SnifferDeviceLookup = Map<string, {
  name: string;
  serial?: string;
  type?: string;
}>;

const knownTelegramTypes: Record<number, string> = {
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

export function snifferFlags(flagsInt: number): string[] {
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

export function snifferTelegramType(typeInt: number): string {
  return typeInt >= 0x80 ? "HMIP_TYPE" : knownTelegramTypes[typeInt] ?? "";
}

export function calculateSendTimeMs(length: number, flags: string[]): number {
  return flags.includes("BURST")
    ? 360 + (length + 7) * 0.81
    : (length + 11) * 0.81;
}

export function calculateDutyCycle(sendTimeMs: number): number {
  return sendTimeMs / 360;
}

export function normalizeDutyCycle(values: number[]) {
  const estimated = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  const scale = estimated > 100 ? 100 / estimated : 1;
  return {
    estimated,
    scale,
    total: Math.min(100, estimated)
  };
}

export function parseAskSinTelegram(
  line: string,
  deviceMap: SnifferDeviceLookup,
  receivedAt = new Date().toISOString()
): SnifferTelegram | undefined {
  const trimmed = line.trim();
  if (!/^:[0-9a-f]+;$/i.test(trimmed) || trimmed.length <= 23) return undefined;

  const fromAddress = trimmed.substring(11, 17).toUpperCase();
  const toAddress = trimmed.substring(17, 23).toUpperCase();
  const fromDevice = deviceMap.get(fromAddress);
  const toDevice = deviceMap.get(toAddress);
  const length = parseInt(trimmed.substring(3, 5), 16);
  const type = snifferTelegramType(parseInt(trimmed.substring(9, 11), 16));
  const flags = type === "HMIP_TYPE"
    ? []
    : snifferFlags(parseInt(trimmed.substring(7, 9), 16));
  const sendTimeMs = calculateSendTimeMs(length, flags);

  return {
    tstamp: receivedAt,
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
    dutyCycle: calculateDutyCycle(sendTimeMs),
    sendTimeMs: Math.round(sendTimeMs * 10) / 10,
    payload: trimmed.substring(23, trimmed.length - 1)
  };
}

export function parseRssiNoise(line: string, receivedAt = new Date().toISOString()) {
  const trimmed = line.trim();
  if (!/^:[0-9a-f]{2};$/i.test(trimmed)) return undefined;
  return {
    tstamp: receivedAt,
    raw: trimmed,
    rssi: -1 * parseInt(trimmed.substring(1, 3), 16)
  };
}
