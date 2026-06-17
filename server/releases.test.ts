import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, isOfficialCcu3Product, isOpenCcuFamilyProduct, normalizeCentralVersion } from "./releases.js";

test("vergleicht datumsbasierte OpenCCU-Versionen", () => {
  assert.equal(compareVersions("3.87.6.20260614", "3.81.7.20250125") > 0, true);
  assert.equal(compareVersions("3.87.6.20260614", "3.87.6.20260614"), 0);
});

test("liest die OpenCCU-Version aus Text und Release-URL", () => {
  assert.equal(normalizeCentralVersion("VERSION=3.87.6.20260614"), "3.87.6.20260614");
  assert.equal(normalizeCentralVersion("Aktuelle Firmwareversion:\t3.87.6.20260614"), "3.87.6.20260614");
  assert.equal(normalizeCentralVersion("Firmware CCU3 3.87.6"), "3.87.6");
  assert.equal(normalizeCentralVersion("https://github.com/OpenCCU/OpenCCU/releases/tag/3.87.6.20260614"), "3.87.6.20260614");
  assert.equal(normalizeCentralVersion("unbekannt"), undefined);
});

test("grenzt OpenCCU-Familie von originaler CCU-Firmware ab", () => {
  assert.equal(isOpenCcuFamilyProduct("OpenCCU"), true);
  assert.equal(isOpenCcuFamilyProduct("raspmatic"), true);
  assert.equal(isOpenCcuFamilyProduct("RaspberryMatic"), true);
  assert.equal(isOpenCcuFamilyProduct("CCU3"), false);
  assert.equal(isOfficialCcu3Product("HM-CCU3"), true);
  assert.equal(isOfficialCcu3Product("CCU3"), true);
  assert.equal(isOfficialCcu3Product("OpenCCU"), false);
});
