import { lookupService } from "node:dns/promises";

const hostnameCache = new Map<string, { hostname?: string; expiresAt: number }>();
const cacheDurationMs = 15 * 60 * 1000;
const lookupTimeoutMs = 700;

function cleanHostname(hostname?: string): string | undefined {
  const cleaned = hostname?.trim().replace(/\.$/, "");
  return cleaned && cleaned !== "localhost" ? cleaned : undefined;
}

async function lookupHostname(address: string): Promise<string | undefined> {
  const cached = hostnameCache.get(address);
  if (cached && cached.expiresAt > Date.now()) return cached.hostname;

  let timeout: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      lookupService(address, 0).then((entry) => cleanHostname(entry.hostname)),
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => resolve(undefined), lookupTimeoutMs);
      })
    ]);
    hostnameCache.set(address, { hostname: result, expiresAt: Date.now() + cacheDurationMs });
    return result;
  } catch {
    hostnameCache.set(address, { hostname: undefined, expiresAt: Date.now() + cacheDurationMs });
    return undefined;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function resolveNetworkHostnames(addresses: string[]): Promise<Record<string, string>> {
  const uniqueAddresses = [...new Set(addresses.filter(Boolean))];
  const entries = await Promise.all(uniqueAddresses.map(async (address) => {
    const hostname = await lookupHostname(address);
    return hostname ? [address, hostname] as const : undefined;
  }));

  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry)));
}

export function describeKnownService(hostname?: string): string | undefined {
  const normalized = hostname?.toLowerCase() ?? "";

  if (normalized.includes("homeassistant") || normalized.includes("home-assistant")) {
    return "Der Gerätename deutet auf Home Assistant hin.";
  }
  if (normalized.includes("iobroker")) {
    return "Der Gerätename deutet auf ioBroker hin.";
  }
  if (normalized.includes("node-red") || normalized.includes("nodered")) {
    return "Der Gerätename deutet auf Node-RED hin.";
  }
  if (normalized.includes("openhab")) {
    return "Der Gerätename deutet auf openHAB hin.";
  }

  return undefined;
}
