import assert from "node:assert/strict";
import test from "node:test";
import { explainAiEvidence, prepareLogLines } from "./aiLogAnalyzer.js";

test("filtert im Einsteiger-Modus nur Fehler und Warnungen", () => {
  const result = prepareLogLines([
    "ReGaHss: Info: Programm gestartet",
    "ReGaHss: Warning: Zeitüberschreitung erkannt",
    "rfd: ERROR communication failed",
    "ReGaHss: Debug: Programm beendet"
  ], "issues");

  assert.equal(result.totalLines, 4);
  assert.equal(result.matchedLines, 2);
  assert.deepEqual(result.lines, [
    "ReGaHss: Warning: Zeitüberschreitung erkannt",
    "rfd: ERROR communication failed"
  ]);
});

test("meldet keine Treffer bei normalen Logzeilen", () => {
  const result = prepareLogLines([
    "ReGaHss: Info: Programm gestartet",
    "ReGaHss: Verbose: Regel ausgewertet"
  ], "issues");

  assert.equal(result.totalLines, 2);
  assert.equal(result.matchedLines, 0);
  assert.deepEqual(result.lines, []);
});

test("wertet UNREACH=false als Entwarnung und nicht als Fehler", () => {
  const result = prepareLogLines([
    'Jun 16 19:14:02 Homematic-raspi local0.info ReGaHss: Info: Event="0001D569A581EA:0"."UNREACH"=false [execute():iseXmlRpc.cpp:334]'
  ], "issues");

  assert.equal(result.totalLines, 1);
  assert.equal(result.matchedLines, 0);
  assert.deepEqual(result.lines, []);
});

test("begrenzt die vollständige Analyse auf die neuesten 500 Zeilen", () => {
  const logs = Array.from({ length: 520 }, (_, index) => `Logzeile ${index + 1}`);
  const result = prepareLogLines(logs, "full");

  assert.equal(result.totalLines, 500);
  assert.equal(result.lines.length, 500);
  assert.equal(result.lines[0], "Logzeile 21");
  assert.equal(result.lines.at(-1), "Logzeile 520");
});

test("übersetzt ENERGY_COUNTER_OVERFLOW in eine verständliche Erklärung", () => {
  const result = explainAiEvidence('Event="0001D569A581EA:6"."ENERGY_COUNTER_OVERFLOW"=true');

  assert.match(result, /Energiezähler/);
  assert.match(result, /beweist allein keinen Gerätedefekt/);
  assert.match(result, /0001D569A581EA:6/);
});

test("kennzeichnet unbekannte technische Events als Beleg statt Diagnose", () => {
  const result = explainAiEvidence('Event="0001D569A581EA:6"."SOME_UNKNOWN_STATE"=42');

  assert.match(result, /noch keine Ursache/);
  assert.match(result, /SOME_UNKNOWN_STATE/);
});

test("erklärt false-Events als Normalzustand", () => {
  const result = explainAiEvidence('Event="0001D569A581EA:0"."UNREACH"=false');

  assert.match(result, /nicht aktiv/);
  assert.match(result, /Normalzustand/);
  assert.match(result, /kein Fehler/);
});

test("setzt vorhandenen Gerätenamen in die Erklärung ein", () => {
  const result = explainAiEvidence(
    'Event="0001D569A581EA:6"."ENERGY_COUNTER_OVERFLOW"=true',
    { devices: [{ name: "Steckdose Wärmepumpe", serial: "0001D569A581EA", type: "HmIP-PSM" }] }
  );

  assert.match(result, /Steckdose Wärmepumpe/);
});
