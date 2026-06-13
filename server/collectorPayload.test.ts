import assert from "node:assert/strict";
import test from "node:test";
import { decodeBase64Lines } from "./collectorPayload.js";

test("dekodiert HmIP-Logzeilen mit JSON-Sonderzeichen verlustfrei", () => {
  const logLine = 'HmIPServer: route "device\\channel"\tstatus=ok';
  const encoded = Buffer.from(logLine, "utf8").toString("base64");

  assert.deepEqual(decodeBase64Lines([encoded]), [logLine]);
});
