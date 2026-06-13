import assert from "node:assert/strict";
import test from "node:test";
import { buildRoutingTopology } from "./routingTopology.js";
import type { CcuMasterdataPayload } from "./types.js";

const masterdata: CcuMasterdataPayload = {
  collectedAt: "2026-06-13T12:00:00.000Z",
  devices: [
    { name: "Steckdose Trockner", serial: "0001D3C99C4EAA", type: "HmIP-PSM" },
    { name: "Bewegungsmelder", serial: "000A1B2C3D4E55", type: "HmIP-SMI" },
    { name: "Fensterkontakt", serial: "000A1B2C3D4E66", type: "HmIP-SWDO" }
  ]
};

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
