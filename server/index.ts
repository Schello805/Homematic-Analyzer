import cors from "cors";
import express from "express";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createAnalysis } from "./analyzer.js";
import { readCcuSnapshot } from "./ccuClient.js";
import type { CcuMasterdataPayload, CollectorPayload } from "./types.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

let latestCollector: CollectorPayload | undefined;
let latestCcuMasterdata: CcuMasterdataPayload | undefined;

const analyzeSchema = z.object({
  ccuHost: z.string().optional(),
  ccuUser: z.string().optional(),
  ccuPassword: z.string().optional(),
  hasCcuPassword: z.boolean().optional(),
  sshHost: z.string().optional(),
  sshUser: z.string().optional(),
  sshPassword: z.string().optional(),
  hasSshPassword: z.boolean().optional(),
  snifferPort: z.string().optional(),
  telegramEnabled: z.boolean().optional(),
  externalSystems: z.array(z.string()).optional()
});

const collectorSchema = z.object({
  token: z.string().max(200).optional(),
  host: z.string().max(160).optional(),
  collectedAt: z.string().max(80).optional(),
  system: z.record(z.unknown()).optional(),
  logs: z.array(z.string().max(700)).max(80).optional(),
  backups: z.record(z.unknown()).optional()
});

const ccuMasterdataSchema = z.object({
  token: z.string().max(200).optional(),
  source: z.string().max(80).optional(),
  collectedAt: z.string().max(80).optional(),
  deviceCount: z.number().int().nonnegative().optional(),
  devices: z.array(z.object({
    name: z.string().max(200).optional(),
    address: z.string().max(80).optional(),
    type: z.string().max(120).optional(),
    firmware: z.string().max(80).optional()
  })).max(1000).optional()
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "Homematic Analyzer API" });
});

app.post("/api/analyze", async (request, response) => {
  const parsed = analyzeSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: "Ungültige Analyse-Konfiguration", issues: parsed.error.issues });
    return;
  }

  const ccuSnapshot = await readCcuSnapshot(parsed.data);

  response.json({
    generatedAt: new Date().toISOString(),
    checks: createAnalysis(parsed.data, latestCollector, ccuSnapshot)
  });
});

app.post("/api/collector", (request, response) => {
  const parsed = collectorSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: "Ungültige Collector-Daten", issues: parsed.error.issues });
    return;
  }

  const expectedCollectorToken = process.env.COLLECTOR_TOKEN;

  if (expectedCollectorToken && parsed.data.token !== expectedCollectorToken) {
    response.status(401).json({ error: "Collector-Token ist ungültig." });
    return;
  }

  latestCollector = {
    ...parsed.data,
    collectedAt: parsed.data.collectedAt ?? new Date().toISOString()
  };

  response.json({ ok: true, receivedAt: new Date().toISOString() });
});

app.post("/api/ccu-masterdata", (request, response) => {
  const parsed = ccuMasterdataSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: "Ungültige CCU-Stammdaten", issues: parsed.error.issues });
    return;
  }

  const expectedCollectorToken = process.env.COLLECTOR_TOKEN;

  if (expectedCollectorToken && parsed.data.token !== expectedCollectorToken) {
    response.status(401).json({ error: "Collector-Token ist ungültig." });
    return;
  }

  latestCcuMasterdata = {
    ...parsed.data,
    collectedAt: parsed.data.collectedAt ?? new Date().toISOString()
  };

  response.json({
    ok: true,
    receivedAt: new Date().toISOString(),
    deviceCount: parsed.data.deviceCount ?? parsed.data.devices?.length ?? 0
  });
});

app.get("/api/collector/script", async (request, response) => {
  const analyzerUrl = String(request.query.url ?? `http://127.0.0.1:${port}`);
  const token = String(request.query.token ?? "bitte-token-aendern");
  const scriptPath = join(root, "scripts", "system-snapshot-collector.sh");
  const script = await readFile(scriptPath, "utf8");

  response.type("text/plain").send(
    script
      .replaceAll("__ANALYZER_URL__", analyzerUrl)
      .replaceAll("__ANALYZER_TOKEN__", token)
  );
});

app.get("/api/ccu-masterdata/script", async (request, response) => {
  const analyzerUrl = String(request.query.url ?? `http://127.0.0.1:${port}`);
  const token = String(request.query.token ?? "bitte-token-aendern");
  const scriptPath = join(root, "scripts", "ccu", "daily-masterdata.rega");
  const script = await readFile(scriptPath, "utf8");

  response.type("text/plain").send(
    script
      .replaceAll("__ANALYZER_URL__", analyzerUrl)
      .replaceAll("__ANALYZER_TOKEN__", token)
  );
});

app.listen(port, () => {
  console.log(`Homematic Analyzer API läuft auf http://127.0.0.1:${port}`);
});
