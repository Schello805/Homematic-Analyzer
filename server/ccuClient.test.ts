import assert from "node:assert/strict";
import test from "node:test";
import { classifyCcuConnectionError, collectDevices, extractCentralVersionFromText, xmlApiTimeoutForPath } from "./ccuClient.js";

test("erkennt DNS-Fehler des Analyzer-Servers", () => {
  const error = new Error("fetch failed", { cause: { code: "ENOTFOUND" } });
  const result = classifyCcuConnectionError(error);

  assert.equal(result.code, "dns");
  assert.match(result.detail, /Hostname/);
});

test("erkennt Netzwerkroute und selbstsigniertes Zertifikat", () => {
  const networkResult = classifyCcuConnectionError(new Error("fetch failed", { cause: { code: "EHOSTUNREACH" } }));
  const tlsResult = classifyCcuConnectionError(new Error("self signed certificate", { cause: { code: "DEPTH_ZERO_SELF_SIGNED_CERT" } }));

  assert.equal(networkResult.code, "network");
  assert.equal(tlsResult.code, "tls");
});

test("erkennt Zeitüberschreitung", () => {
  const error = new Error("aborted");
  error.name = "AbortError";

  const result = classifyCcuConnectionError(error);
  assert.equal(result.code, "timeout");
  assert.match(result.detail, /6 Sekunden/);
});

test("gibt der großen XML-API-Geräteliste deutlich mehr Zeit", () => {
  assert.equal(xmlApiTimeoutForPath("/addons/xmlapi/statelist.cgi"), 30000);
  assert.equal(xmlApiTimeoutForPath("/addons/xmlapi/systemNotification.cgi"), 12000);
});

test("liest Zentralenversion aus VERSION-Datei und WebUI-HTML", () => {
  assert.equal(extractCentralVersionFromText("VERSION=3.87.6.20260614\nPRODUCT=OpenCCU"), "3.87.6.20260614");
  assert.equal(
    extractCentralVersionFromText("<td>Aktuelle Firmwareversion:</td><td><strong>3.87.6.20260614</strong></td>"),
    "3.87.6.20260614"
  );
});

test("liest Zentralenversion aus VERSION-Datei mit Anführungszeichen", () => {
  assert.equal(extractCentralVersionFromText([
    'PRODUCT="OpenCCU"',
    'VERSION="3.87.6.20260614"',
    "BUILD=20260614"
  ].join("\n")), "3.87.6.20260614");
});

test("liest Zentralenversion aus einfachem WebUI-Text", () => {
  assert.equal(
    extractCentralVersionFromText("Aktuelle Firmwareversion: 3.87.6.20260614"),
    "3.87.6.20260614"
  );
});

test("liest RSSI_DEVICE und RSSI_PEER aus der XML-API-Geräteliste", () => {
  const devices = collectDevices({
    stateList: {
      device: {
        name: "HmIP Fenster",
        address: "000A1B2C3D4E55",
        type: "HmIP-SWDO",
        channel: {
          address: "000A1B2C3D4E55:0",
          datapoint: [
            { name: "HmIP-RF.000A1B2C3D4E55:0.RSSI_DEVICE", type: "RSSI_DEVICE", value: "-74" },
            { name: "HmIP-RF.000A1B2C3D4E55:0.RSSI_PEER", type: "RSSI_PEER", value: "-81" }
          ]
        }
      }
    }
  });

  assert.equal(devices[0].rssiDevice, -74);
  assert.equal(devices[0].rssiPeer, -81);
});

test("verwirft XML-API-Platzhalter statt sie als dBm anzuzeigen", () => {
  const devices = collectDevices({
    stateList: {
      device: {
        name: "HmIP Gerät ohne RSSI",
        address: "000A1B2C3D4E77",
        type: "HmIP-SWDO",
        channel: {
          address: "000A1B2C3D4E77:0",
          datapoint: [
            { name: "HmIP-RF.000A1B2C3D4E77:0.RSSI_DEVICE", type: "RSSI_DEVICE", value: "-65535" },
            { name: "HmIP-RF.000A1B2C3D4E77:0.RSSI_PEER", type: "RSSI_PEER", value: "65535" }
          ]
        }
      }
    }
  });

  assert.equal(devices[0].rssiDevice, undefined);
  assert.equal(devices[0].rssiPeer, undefined);
});

test("verwirft 0 dBm als ungültigen RSSI-Platzhalter", () => {
  const devices = collectDevices({
    stateList: {
      device: {
        name: "HmIP Gerät mit Nullwert",
        address: "000A1B2C3D4E88",
        type: "HmIP-SWDO",
        channel: {
          address: "000A1B2C3D4E88:0",
          datapoint: [
            { name: "HmIP-RF.000A1B2C3D4E88:0.RSSI_DEVICE", type: "RSSI_DEVICE", value: "0" },
            { name: "HmIP-RF.000A1B2C3D4E88:0.RSSI_PEER", type: "RSSI_PEER", value: "0" }
          ]
        }
      }
    }
  });

  assert.equal(devices[0].rssiDevice, undefined);
  assert.equal(devices[0].rssiPeer, undefined);
});
