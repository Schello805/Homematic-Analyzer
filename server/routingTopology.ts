import type {
  CcuMasterdataPayload,
  RoutingTopology,
  RoutingTopologyEdge,
  RoutingTopologyNode,
  CcuDevice,
  RadioGateway,
  SnifferDeviceSummary
} from "./types.js";

type InventoryDevice = NonNullable<CcuMasterdataPayload["devices"]>[number];

const routerCandidatePattern = /^HmIP-(PSM|PSM-2|FSM|FSM16|BSM|PCBS|DRSI|DRDI|DRBLI|FAL|MIOB)/i;
const hmipPattern = /^(?:HmIP-|HmIPW-)/i;
const bidcosPattern = /^(?:HM-(?!W)|HMLGW)/i;
const gatewayPattern = /^(?:HmIP-(?:HAP|WLAN-HAP|DRAP)|HmIPW-DRAP|HM-(?:LGW|CFG-LAN)|HMLGW)/i;
const settingKeys = ["ROUTER_MODULE_ENABLED", "MULTICAST_ROUTER_MODULE_ENABLED", "ENABLE_ROUTING"] as const;
const routingConfigPattern = /^ROUTING_CONFIG\|([^|]+)\|([^|]*)\|router=([^|]+)\|routing=([^|]+)\|multicast=([^|]+)$/i;
const radioGatewayPattern = /^RADIO_GATEWAY\|(.+)$/i;

function normalizeIdentifier(value?: string | number): string {
  return String(value ?? "").trim().toUpperCase();
}

function identifierVariants(value?: string | number): string[] {
  const normalized = normalizeIdentifier(value);
  if (!normalized) return [];
  const withoutInterface = normalized.replace(/^[A-Z]+(?:-[A-Z]+)?\./, "");
  const withoutChannel = withoutInterface.split(":")[0];
  return [...new Set([normalized, withoutInterface, withoutChannel].filter(Boolean))];
}

function deviceIdentifiers(device: InventoryDevice): string[] {
  return [
    device.serial,
    device.address,
    device.rfAddress,
    device.radioAddress
  ].flatMap(identifierVariants).filter(Boolean);
}

function isHmIpDevice(device: InventoryDevice): boolean {
  return hmipPattern.test(device.type ?? "");
}

function isBidCosDevice(device: InventoryDevice): boolean {
  return bidcosPattern.test(device.type ?? "");
}

function isRadioDevice(device: InventoryDevice): boolean {
  return isHmIpDevice(device) || isBidCosDevice(device);
}

function nodeId(device: InventoryDevice, index: number): string {
  return deviceIdentifiers(device)[0] ?? `hmip-device-${index + 1}`;
}

function booleanValue(value: string): boolean {
  return /^(1|true|on|yes)$/i.test(value.trim());
}

function configValue(value: string): boolean | undefined {
  const normalized = value.trim();
  if (/^(1|true|on|yes)$/i.test(normalized)) return true;
  if (/^(0|false|off|no)$/i.test(normalized)) return false;
  return undefined;
}

function findKnownIdentifier(line: string, identifiers: Map<string, string>, excluded?: string): string | undefined {
  const normalizedLine = line.toUpperCase();
  return [...identifiers.keys()]
    .filter((identifier) => identifier !== excluded && identifier.length >= 5 && normalizedLine.includes(identifier))
    .sort((left, right) => right.length - left.length)[0];
}

function parseExplicitRoute(
  line: string,
  identifiers: Map<string, string>
): { sourceIdentifier: string; targetIdentifier: string } | undefined {
  const normalized = line.toUpperCase();
  if (!/\b(VIA|ROUTER|ROUTED|ROUTE|ROUTING|HOP|REPEATER)\b/.test(normalized)) return undefined;

  const orderedIdentifiers = [...identifiers.keys()]
    .filter((identifier) => identifier.length >= 5 && normalized.includes(identifier))
    .sort((left, right) => normalized.indexOf(left) - normalized.indexOf(right));
  if (orderedIdentifiers.length < 2) return undefined;

  const viaMatch = normalized.match(/\b(?:VIA(?:\s+ROUTER)?|ROUTER|HOP|REPEATER)\b[^A-Z0-9]*([A-Z0-9_-]{5,24})/);
  const targetIdentifier = viaMatch
    ? findKnownIdentifier(viaMatch[1], identifiers)
    : orderedIdentifiers[1];
  const sourceIdentifier = orderedIdentifiers.find((identifier) => identifier !== targetIdentifier);

  if (!sourceIdentifier || !targetIdentifier) return undefined;
  return { sourceIdentifier, targetIdentifier };
}

export function parseRadioGateways(lines: string[]): RadioGateway[] {
  const gateways = new Map<string, RadioGateway>();

  lines.forEach((line) => {
    const match = line.trim().match(radioGatewayPattern);
    if (!match) return;

    const values = new Map<string, string>();
    match[1].split("|").forEach((entry) => {
      const separator = entry.indexOf("=");
      if (separator <= 0) return;
      values.set(entry.slice(0, separator).trim().toLowerCase(), entry.slice(separator + 1).trim());
    });

    const protocol = values.get("protocol")?.toLowerCase() === "hmip" ? "hmip" : "bidcos";
    const type = values.get("type") || undefined;
    const serial = values.get("serial") || undefined;
    const address = values.get("address") || undefined;
    const name = values.get("name") || type || serial || address;
    if (!name) return;

    const key = normalizeIdentifier(serial || address || `${protocol}-${name}`);
    gateways.set(key, { protocol, name, type, serial, address });
  });

  return [...gateways.values()];
}

export function buildRoutingTopology(
  masterdata?: CcuMasterdataPayload,
  hmipLogs: string[] = [],
  sourceHost?: string,
  collectedAt?: string,
  snifferDevices: SnifferDeviceSummary[] = [],
  ccuDevices: CcuDevice[] = [],
  radioGateways: RadioGateway[] = []
): RoutingTopology {
  const devices = (masterdata?.devices ?? []).filter(isRadioDevice);
  const deviceNodes: RoutingTopologyNode[] = devices.map((device, index) => ({
    id: nodeId(device, index),
    name: device.name?.trim() || device.serial?.trim() || device.address?.trim() || `HmIP-Gerät ${index + 1}`,
    serial: device.serial?.trim(),
    address: device.address?.trim(),
    type: device.type?.trim(),
    protocol: isHmIpDevice(device) ? "hmip" : "bidcos",
    role: gatewayPattern.test(device.type ?? "")
      ? "gateway"
      : routerCandidatePattern.test(device.type ?? "") ? "candidate" : "device",
    routerEnabled: false,
    routingEnabled: false,
    multicastRouting: false,
    evidence: []
  }));
  const existingGatewayIdentifiers = new Set(
    devices.filter((device) => gatewayPattern.test(device.type ?? ""))
      .flatMap(deviceIdentifiers)
  );
  const gatewayNodes: RoutingTopologyNode[] = radioGateways
    .filter((gateway) => {
      const identifiers = [gateway.serial, gateway.address].map(normalizeIdentifier).filter(Boolean);
      return !identifiers.some((identifier) => existingGatewayIdentifiers.has(identifier));
    })
    .map((gateway, index) => ({
      id: normalizeIdentifier(gateway.serial || gateway.address) || `radio-gateway-${index + 1}`,
      name: gateway.name,
      serial: gateway.serial,
      address: gateway.address,
      type: gateway.type,
      protocol: gateway.protocol,
      role: "gateway",
      routerEnabled: false,
      routingEnabled: false,
      multicastRouting: false,
      evidence: ["Als Funk-Schnittstelle aus der CCU-Konfiguration gelesen."]
    }));
  const nodes = [...deviceNodes, ...gatewayNodes];

  const centralNode: RoutingTopologyNode = {
    id: "central",
    name: sourceHost || "Homematic Zentrale",
    protocol: "central",
    role: "central",
    routerEnabled: true,
    routingEnabled: true,
    multicastRouting: false,
    evidence: ["Zentrale der Installation"]
  };
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const identifiers = new Map<string, string>();

  devices.forEach((device, index) => {
    const id = deviceNodes[index].id;
    deviceIdentifiers(device).forEach((identifier) => identifiers.set(identifier, id));
  });

  const snifferByIdentifier = new Map<string, SnifferDeviceSummary>();
  snifferDevices.forEach((device) => {
    [device.address, device.serial].map(normalizeIdentifier).filter(Boolean)
      .forEach((identifier) => snifferByIdentifier.set(identifier, device));
  });
  devices.forEach((device, index) => {
    const snifferDevice = deviceIdentifiers(device)
      .map((identifier) => snifferByIdentifier.get(identifier))
      .find(Boolean);
    if (!snifferDevice) return;
    deviceNodes[index].avgRssi = snifferDevice.avgRssi;
    deviceNodes[index].snifferRssi = snifferDevice.avgRssi;
    deviceNodes[index].rssiTelegrams = snifferDevice.telegrams;
  });

  const ccuByIdentifier = new Map<string, CcuDevice>();
  ccuDevices.forEach((device) => {
    [device.address, device.name].flatMap(identifierVariants).filter(Boolean)
      .forEach((identifier) => ccuByIdentifier.set(identifier, device));
  });
  devices.forEach((device, index) => {
    const ccuDevice = deviceIdentifiers(device)
      .map((identifier) => ccuByIdentifier.get(identifier))
      .find(Boolean);
    if (!ccuDevice) return;
    deviceNodes[index].ccuRssi = ccuDevice.rssiPeer ?? ccuDevice.rssiDevice;
    deviceNodes[index].ccuRssiSource = ccuDevice.rssiPeer !== undefined ? "RSSI_PEER" : ccuDevice.rssiDevice !== undefined ? "RSSI_DEVICE" : undefined;
    deviceNodes[index].ccuPeerRssi = ccuDevice.rssiPeer;
  });

  const edges: RoutingTopologyEdge[] = [];
  const seenEdges = new Set<string>();

  hmipLogs.forEach((line) => {
    const configMatch = line.trim().match(routingConfigPattern);
    if (configMatch) {
      const [, rawIdentifier, , routerValue, routingValue, multicastValue] = configMatch;
      const identifier = findKnownIdentifier(rawIdentifier, identifiers);
      const node = identifier ? nodeById.get(identifiers.get(identifier) ?? "") : undefined;
      if (node) {
        const routerEnabled = configValue(routerValue);
        const routingEnabled = configValue(routingValue);
        const multicastRouting = configValue(multicastValue);
        if (routerEnabled !== undefined) {
          node.routerEnabled = routerEnabled;
          node.evidence.push(`Gerät dient als Router: ${routerEnabled ? "aktiv" : "inaktiv"} (CCU-Geräteparameter)`);
        }
        if (routingEnabled !== undefined) {
          node.routingEnabled = routingEnabled;
          node.evidence.push(`Routing aktiv: ${routingEnabled ? "aktiv" : "inaktiv"} (CCU-Geräteparameter)`);
        }
        if (multicastRouting !== undefined) {
          node.multicastRouting = multicastRouting;
          node.evidence.push(`Multicast-Routing: ${multicastRouting ? "aktiv" : "inaktiv"} (CCU-Geräteparameter)`);
        }
      }
      return;
    }

    const knownIdentifier = findKnownIdentifier(line, identifiers);
    if (knownIdentifier) {
      const node = nodeById.get(identifiers.get(knownIdentifier) ?? "");
      if (node) {
        settingKeys.forEach((key) => {
          const match = line.match(new RegExp(`${key}\\s*(?:=|:|value\\s*)\\s*(1|0|true|false|on|off|yes|no)`, "i"));
          if (!match) return;
          const enabled = booleanValue(match[1]);
          if (key === "ROUTER_MODULE_ENABLED") node.routerEnabled = enabled;
          if (key === "ENABLE_ROUTING") node.routingEnabled = enabled;
          if (key === "MULTICAST_ROUTER_MODULE_ENABLED") node.multicastRouting = enabled;
          node.evidence.push(`${key} = ${enabled ? "aktiv" : "inaktiv"}`);
        });
      }
    }

    const route = parseExplicitRoute(line, identifiers);
    if (!route) return;
    const source = identifiers.get(route.sourceIdentifier);
    const target = identifiers.get(route.targetIdentifier);
    if (!source || !target || source === target) return;
    const targetNode = nodeById.get(target);
    if (!targetNode) return;

    targetNode.routerEnabled = true;
    const edgeKey = `${source}->${target}`;
    if (seenEdges.has(edgeKey)) return;
    seenEdges.add(edgeKey);
    edges.push({
      id: edgeKey,
      source,
      target,
      kind: "confirmed-route",
      evidence: line.trim()
    });
  });

  nodes.forEach((node) => {
    if (node.protocol === "hmip" && node.role !== "gateway" && node.routerEnabled) node.role = "router";
  });

  const confirmedRouters = nodes.filter((node) => node.role === "router").length;
  const routerCandidates = nodes.filter((node) => node.role === "candidate").length;
  const gateways = nodes.filter((node) => node.role === "gateway").length;
  const assignedDevices = new Set(edges.map((edge) => edge.source));
  const unknownAssignments = nodes.filter((node) => node.role !== "router" && !assignedDevices.has(node.id)).length;

  return {
    generatedAt: new Date().toISOString(),
    collectedAt: collectedAt ?? masterdata?.collectedAt,
    sourceHost,
    state: devices.length === 0 ? "missing" : edges.length > 0 || confirmedRouters > 0 ? "ready" : "partial",
    nodes: [centralNode, ...nodes],
    edges,
    metrics: {
      devices: nodes.length,
      hmipDevices: nodes.filter((node) => node.protocol === "hmip" && node.role !== "gateway").length,
      bidcosDevices: nodes.filter((node) => node.protocol === "bidcos" && node.role !== "gateway").length,
      gateways,
      confirmedRouters,
      routerCandidates,
      routingEnabled: nodes.filter((node) => node.routingEnabled).length,
      multicastRouters: nodes.filter((node) => node.multicastRouting).length,
      confirmedRoutes: edges.length,
      unknownAssignments
    },
    rssiSources: {
      sniffer: nodes.filter((node) => node.snifferRssi !== undefined).length,
      ccu: nodes.filter((node) => node.ccuRssi !== undefined).length
    },
    diagnostics: [
      devices.length > 0
        ? `${nodes.filter((node) => node.protocol === "hmip").length} HmIP- und ${nodes.filter((node) => node.protocol === "bidcos").length} klassische Homematic-Funkknoten aus den CCU-Stammdaten übernommen.`
        : "Keine HmIP- oder klassischen Homematic-Funkgeräte in den CCU-Stammdaten gefunden.",
      hmipLogs.length > 0
        ? `${hmipLogs.length} HmIP-Routingbelege und Geräteparameter ausgewertet.`
        : "Keine aktuellen HmIPServer-Logzeilen vorhanden.",
      hmipLogs.some((line) => routingConfigPattern.test(line.trim()))
        ? "Router-, Routing- und Multicast-Schalter wurden direkt aus den HmIP-RF-Geräteparametern gelesen."
        : "Der aktuelle Collector enthält noch keine HmIP-RF-Geräteparameter. Collector erneut auf der CCU ausführen.",
      radioGateways.length > 0
        ? `${radioGateways.length} Funk-Gateway-Konfigurationen wurden vom CCU-Collector geliefert.`
        : "Der aktuelle Collector enthält noch keine Funk-Gateway-Konfiguration. Collector nach dem Update erneut auf der CCU ausführen.",
      edges.length > 0
        ? `${edges.length} Routingpfade sind durch ausdrückliche Logzeilen belegt.`
        : "Noch kein aktiver Routingpfad ist ausdrücklich im Log belegt. Gestrichelte Verbindungen sind daher nur unbekannte Zuordnungen."
    ]
  };
}
