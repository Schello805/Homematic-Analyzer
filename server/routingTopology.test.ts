import assert from "node:assert/strict";
import test from "node:test";
import { buildRoutingTopology, parseRadioGateways } from "./routingTopology.js";
import type { CcuMasterdataPayload } from "./types.js";

const masterdata: CcuMasterdataPayload = {
  collectedAt: "2026-06-13T12:00:00.000Z",
  devices: [
    { name: "Steckdose Trockner", serial: "0001D3C99C4EAA", type: "HmIP-PSM" },
    { name: "Bewegungsmelder", serial: "000A1B2C3D4E55", type: "HmIP-SMI" },
    { name: "Fensterkontakt", serial: "000A1B2C3D4E66", type: "HmIP-SWDO" },
    { name: "Klassischer Wandtaster", serial: "MEQ1234567", type: "HM-PB-2-WM55" }
  ]
};

test("ordnet HmIP und klassisches Homematic getrennten Funktechnologien zu", () => {
  const topology = buildRoutingTopology(masterdata);

  assert.equal(topology.nodes.find((node) => node.serial === "MEQ1234567")?.protocol, "bidcos");
  assert.equal(topology.metrics.hmipDevices, 3);
  assert.equal(topology.metrics.bidcosDevices, 1);
  assert.equal(topology.metrics.devices, 4);
});

test("behandelt Access Points und LAN-Gateways nicht als Geräte-Router", () => {
  const topology = buildRoutingTopology({
    devices: [
      { name: "HmIP Access Point", serial: "3014F711A000000000000001", type: "HmIP-HAP" },
      { name: "LAN Gateway", serial: "JEQ0123456", type: "HM-LGW-O-TW-W-EU" },
      { name: "Alter LAN Adapter", serial: "KEQ0123456", type: "HM-CFG-LAN" },
      { name: "Wired Access Point", serial: "3014F711A000000000000002", type: "HmIPW-DRAP" },
      { name: "HmIP Access Point DRAP", serial: "3014F711A000000000000003", type: "HmIP-DRAP" },
      { name: "Legacy Gateway", serial: "HMLGW0001", type: "HMLGW2" }
    ]
  });

  for (const serial of [
    "3014F711A000000000000001",
    "JEQ0123456",
    "KEQ0123456",
    "3014F711A000000000000002",
    "3014F711A000000000000003",
    "HMLGW0001"
  ]) {
    assert.equal(topology.nodes.find((node) => node.serial === serial)?.role, "gateway");
  }
  assert.equal(topology.metrics.gateways, 6);
  assert.equal(topology.metrics.confirmedRouters, 0);
});

test("übernimmt klassische LAN-Gateways aus der CCU-Schnittstellenkonfiguration", () => {
  const gateways = parseRadioGateways([
    "RADIO_GATEWAY|protocol=bidcos|name=Funk-Gateway Erdgeschoss|type=HMLGW2|serial=JEQ0123456|address=192.168.1.31",
    "RADIO_GATEWAY|protocol=bidcos|name=Funk-Gateway Obergeschoss|type=HMLGW2|serial=KEQ0123456|address=192.168.1.32"
  ]);
  const topology = buildRoutingTopology(masterdata, [], undefined, undefined, [], [], gateways);

  assert.equal(gateways.length, 2);
  assert.equal(topology.metrics.gateways, 2);
  assert.equal(topology.nodes.find((node) => node.serial === "JEQ0123456")?.role, "gateway");
  assert.equal(topology.nodes.find((node) => node.serial === "KEQ0123456")?.address, "192.168.1.32");
  assert.match(topology.diagnostics.join(" "), /2 Funk-Gateway-Konfigurationen/);
});

test("erkennt belegte Router-Schalter aus HmIPServer-Zeilen", () => {
  const topology = buildRoutingTopology(masterdata, [
    "event interface: HmIP-RF_java device 0001D3C99C4EAA: key:ROUTER_MODULE_ENABLED = true",
    "event interface: HmIP-RF_java device 0001D3C99C4EAA: key:ENABLE_ROUTING = 1",
    "event interface: HmIP-RF_java device 0001D3C99C4EAA: key:MULTICAST_ROUTER_MODULE_ENABLED = on"
  ], "Homematic-raspi");

  const router = topology.nodes.find((node) => node.serial === "0001D3C99C4EAA");
  assert.equal(router?.role, "router");
  assert.equal(router?.routerEnabled, true);
  assert.equal(router?.routingEnabled, true);
  assert.equal(router?.multicastRouting, true);
  assert.equal(topology.metrics.confirmedRouters, 1);
});

test("erkennt Router-Schalter aus der lokalen HmIP-RF-Parameterabfrage", () => {
  const topology = buildRoutingTopology(masterdata, [
    "ROUTING_CONFIG|0001D3C99C4EAA|HmIP-PSM|router=true|routing=true|multicast=false",
    "ROUTING_CONFIG|000A1B2C3D4E55|HmIP-SMI|router=-|routing=true|multicast=-"
  ]);

  const router = topology.nodes.find((node) => node.serial === "0001D3C99C4EAA");
  const motion = topology.nodes.find((node) => node.serial === "000A1B2C3D4E55");
  assert.equal(router?.role, "router");
  assert.equal(router?.routerEnabled, true);
  assert.equal(router?.multicastRouting, false);
  assert.equal(motion?.routerEnabled, false);
  assert.equal(motion?.routingEnabled, true);
  assert.match(router?.evidence[0] ?? "", /CCU-Geräteparameter/);
});

test("ordnet Sniffer-RSSI den HmIP-Geräten zu", () => {
  const topology = buildRoutingTopology(masterdata, [], undefined, undefined, [{
    address: "ABC123",
    serial: "0001D3C99C4EAA",
    name: "Steckdose Trockner",
    telegrams: 8,
    dutyCycle: 0.1,
    dutyShare: 20,
    sendTimeMs: 40,
    avgRssi: -72,
    lastSeen: "2026-06-13T12:00:00.000Z"
  }]);

  const device = topology.nodes.find((node) => node.serial === "0001D3C99C4EAA");
  assert.equal(device?.avgRssi, -72);
  assert.equal(device?.rssiTelegrams, 8);
  assert.equal(topology.rssiSources.sniffer, 1);
});

test("ordnet XML-API-RSSI der HmIP-Routingkarte zu", () => {
  const topology = buildRoutingTopology(masterdata, [], undefined, undefined, [], [{
    name: "Steckdose Trockner",
    address: "0001D3C99C4EAA",
    type: "HmIP-PSM",
    rssiDevice: -68,
    rssiPeer: -72,
    lowBattery: false,
    unreachable: false,
    configPending: false,
    evidence: []
  }]);

  const device = topology.nodes.find((node) => node.serial === "0001D3C99C4EAA");
  assert.equal(device?.ccuRssi, -72);
  assert.equal(device?.ccuRssiSource, "RSSI_PEER");
  assert.equal(device?.ccuPeerRssi, -72);
  assert.equal(topology.rssiSources.ccu, 1);
});

test("nutzt RSSI_DEVICE nur als Rückfallwert, wenn RSSI_PEER fehlt", () => {
  const topology = buildRoutingTopology(masterdata, [], undefined, undefined, [], [{
    name: "Steckdose Trockner",
    address: "0001D3C99C4EAA",
    type: "HmIP-PSM",
    rssiDevice: -68,
    lowBattery: false,
    unreachable: false,
    configPending: false,
    evidence: []
  }]);

  const device = topology.nodes.find((node) => node.serial === "0001D3C99C4EAA");
  assert.equal(device?.ccuRssi, -68);
  assert.equal(device?.ccuRssiSource, "RSSI_DEVICE");
});

test("übernimmt nur ausdrücklich geloggte Routingpfade", () => {
  const topology = buildRoutingTopology(masterdata, [
    "routing device 000A1B2C3D4E55 via router 0001D3C99C4EAA successful"
  ]);

  assert.equal(topology.edges.length, 1);
  assert.equal(topology.edges[0].source, "000A1B2C3D4E55");
  assert.equal(topology.edges[0].target, "0001D3C99C4EAA");
});

test("erfindet ohne Routingbeleg keine aktiven Pfade", () => {
  const topology = buildRoutingTopology(masterdata, [
    "event interface: HmIP-RF_java device 000A1B2C3D4E55: key:STATE = true"
  ]);

  assert.equal(topology.edges.length, 0);
  assert.equal(topology.metrics.confirmedRoutes, 0);
  assert.equal(topology.state, "partial");
});
