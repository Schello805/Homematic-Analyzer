import assert from "node:assert/strict";
import test from "node:test";
import { decodeBase64Lines, parseCollectorAddons } from "./collectorPayload.js";

test("dekodiert Collector-Zeilen mit JSON-Sonderzeichen verlustfrei", () => {
  const logLine = 'HmIPServer: route "device\\channel"\tstatus=ok';
  const encoded = Buffer.from(logLine, "utf8").toString("base64");

  assert.deepEqual(decodeBase64Lines([encoded]), [logLine]);
});

test("liest CUxD-Version aus Collector-Zeilen", () => {
  assert.deepEqual(parseCollectorAddons([
    "ADDON|name=CUxD|version=2.10.0",
    "ADDON|name=XML-API|version=2.3"
  ]), [
    { name: "CUxD", version: "2.10.0" },
    { name: "XML-API", version: "2.3" }
  ]);
});

test("ignoriert ungültige und doppelte Collector-Add-on-Zeilen", () => {
  assert.deepEqual(parseCollectorAddons([
    "ADDON|name=CUxD|version=2.10.0",
    "ADDON|name=cuxd|version=2.9.9",
    "kein Add-on"
  ]), [{ name: "CUxD", version: "2.10.0" }]);
});
