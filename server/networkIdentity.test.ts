import assert from "node:assert/strict";
import test from "node:test";
import { describeKnownService } from "./networkIdentity.js";

test("erkennt nur eindeutige Hinweise aus aufgelösten Gerätenamen", () => {
  assert.equal(describeKnownService("homeassistant.fritz.box"), "Der Gerätename deutet auf Home Assistant hin.");
  assert.equal(describeKnownService("ioBroker.local"), "Der Gerätename deutet auf ioBroker hin.");
  assert.equal(describeKnownService("nodered-server"), "Der Gerätename deutet auf Node-RED hin.");
  assert.equal(describeKnownService("wohnzimmer-tablet"), undefined);
});
