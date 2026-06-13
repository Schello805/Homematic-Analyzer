import assert from "node:assert/strict";
import test from "node:test";
import { classifyCcuConnectionError, xmlApiTimeoutForPath } from "./ccuClient.js";

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
