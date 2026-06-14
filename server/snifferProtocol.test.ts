import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDutyCycle,
  calculateSendTimeMs,
  normalizeDutyCycle,
  parseAskSinTelegram,
  parseRssiNoise
} from "./snifferProtocol.js";

const receivedAt = "2026-06-12T12:00:00.000Z";
const deviceMap = new Map([
  ["A1B2C3", { name: "Testsender", serial: "ABC1234567", type: "HM-TEST" }],
  ["D4E5F6", { name: "Testempfänger", serial: "DEF1234567", type: "HM-TEST" }]
]);

test("parst klassische Homematic-Telegramme wie AskSinAnalyzerXS", () => {
  const telegram = parseAskSinTelegram(":5A0C012010A1B2C3D4E5F6010203;", deviceMap, receivedAt);

  assert.ok(telegram);
  assert.equal(telegram.rssi, -90);
  assert.equal(telegram.len, 12);
  assert.equal(telegram.cnt, 1);
  assert.deepEqual(telegram.flags, ["BIDI"]);
  assert.equal(telegram.type, "INFO");
  assert.equal(telegram.fromAddress, "A1B2C3");
  assert.equal(telegram.toAddress, "D4E5F6");
  assert.equal(telegram.fromName, "Testsender");
  assert.equal(telegram.payload, "010203");
  assert.equal(telegram.tstamp, receivedAt);
  assert.equal(telegram.sendTimeMs, 18.6);
});

test("berechnet Burst-Duty-Cycle nach AskSinAnalyzerXS", () => {
  const sendTimeMs = calculateSendTimeMs(12, ["BURST"]);
  assert.equal(Math.round(sendTimeMs * 100) / 100, 375.39);
  assert.equal(Math.round(calculateDutyCycle(sendTimeMs) * 1000) / 1000, 1.043);
});

test("begrenzt eine überzählige Duty-Cycle-Schätzung proportional auf 100 Prozent", () => {
  assert.deepEqual(normalizeDutyCycle([70, 40]), {
    estimated: 110,
    scale: 100 / 110,
    total: 100
  });
});

test("interpretiert HmIP-Flags nicht als klassische Homematic-Flags", () => {
  const telegram = parseAskSinTelegram(":5A0C011080A1B2C3D4E5F6010203;", deviceMap, receivedAt);

  assert.ok(telegram);
  assert.equal(telegram.type, "HMIP_TYPE");
  assert.deepEqual(telegram.flags, []);
  assert.equal(telegram.sendTimeMs, 18.6);
});

test("parst RSSI-Noise-Zeilen", () => {
  assert.deepEqual(parseRssiNoise(":61;", receivedAt), {
    tstamp: receivedAt,
    raw: ":61;",
    rssi: -97
  });
});

test("weist ungültige Zeilen zurück", () => {
  assert.equal(parseAskSinTelegram("ready", deviceMap, receivedAt), undefined);
  assert.equal(parseAskSinTelegram(":61;", deviceMap, receivedAt), undefined);
  assert.equal(parseRssiNoise(":GG;", receivedAt), undefined);
});
