#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

function run(command, args, options = {}) {
  console.log(`→ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit", ...options });
}

function output(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function bumpPatch(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!match) {
    throw new Error(`Version ${version} ist kein SemVer im Format x.y.z.`);
  }

  const [, major, minor, patch, suffix] = match;
  return `${major}.${minor}.${Number(patch) + 1}${suffix ?? ""}`;
}

const statusBefore = output("git", ["status", "--porcelain"]);
if (!statusBefore) {
  console.log("Keine Änderungen vorhanden. Version wird nicht erhöht.");
  process.exit(0);
}

const packagePath = new URL("../../package.json", import.meta.url);
const lockPath = new URL("../../package-lock.json", import.meta.url);
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const lockJson = JSON.parse(await readFile(lockPath, "utf8"));
const nextVersion = bumpPatch(packageJson.version);

packageJson.version = nextVersion;
lockJson.version = nextVersion;
if (lockJson.packages?.[""]) {
  lockJson.packages[""].version = nextVersion;
}

await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
await writeFile(lockPath, `${JSON.stringify(lockJson, null, 2)}\n`);

run("npm", ["run", "build"]);
run("git", ["add", "."]);
run("git", ["commit", "-m", `Release ${nextVersion}`]);
run("git", ["push"]);

console.log(`✓ Version ${nextVersion} wurde committed und gepusht.`);
