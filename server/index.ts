import cors from "cors";
import express from "express";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createAnalysis } from "./analyzer.js";
import type { CollectorPayload } from "./types.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

let latestCollector: CollectorPayload | undefined;

const analyzeSchema = z.object({
  ccuHost: z.string().optional(),
  ccuUser: z.string().optional(),
  hasCcuPassword: z.boolean().optional(),
  sshHost: z.string().optional(),
  sshUser: z.string().optional(),
  hasSshPassword: z.boolean().optional(),
  snifferPort: z.string().optional(),
  telegramEnabled: z.boolean().optional(),
  externalSystems: z.array(z.string()).optional()
});

const collectorSchema = z.object({
  token: z.string().optional(),
  host: z.string().optional(),
  collectedAt: z.string().optional(),
  system: z.record(z.unknown()).optional(),
  logs: z.array(z.string()).optional(),
  backups: z.record(z.unknown()).optional()
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "Homematic Analyzer API" });
});

app.post("/api/analyze", (request, response) => {
  const parsed = analyzeSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: "Ungültige Analyse-Konfiguration", issues: parsed.error.issues });
    return;
  }

  response.json({
    generatedAt: new Date().toISOString(),
    checks: createAnalysis(parsed.data, latestCollector)
  });
});

app.post("/api/collector", (request, response) => {
  const parsed = collectorSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: "Ungültige Collector-Daten", issues: parsed.error.issues });
    return;
  }

  latestCollector = {
    ...parsed.data,
    collectedAt: parsed.data.collectedAt ?? new Date().toISOString()
  };

  response.json({ ok: true, receivedAt: new Date().toISOString() });
});

app.get("/api/collector/script", async (request, response) => {
  const analyzerUrl = String(request.query.url ?? `http://127.0.0.1:${port}`);
  const token = String(request.query.token ?? "bitte-token-aendern");
  const scriptPath = join(root, "scripts", "homematic-analyzer-collector.sh");
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
