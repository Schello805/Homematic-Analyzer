import assert from "node:assert/strict";
import test from "node:test";
import { prepareLogLines } from "./aiLogAnalyzer.js";

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

test("begrenzt die vollständige Analyse auf die neuesten 500 Zeilen", () => {
  const logs = Array.from({ length: 520 }, (_, index) => `Logzeile ${index + 1}`);
  const result = prepareLogLines(logs, "full");

  assert.equal(result.totalLines, 500);
  assert.equal(result.lines.length, 500);
  assert.equal(result.lines[0], "Logzeile 21");
  assert.equal(result.lines.at(-1), "Logzeile 520");
});
