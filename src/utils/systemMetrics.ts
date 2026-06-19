export function splitMetricLines(value?: string) {
  return value?.replaceAll("\\n", "\n").split(/\n|\s+\|\s+/).map((line) => line.trim()).filter(Boolean) ?? [];
}

export function firstLine(value?: string) {
  return splitMetricLines(value)[0];
}

export function parseMemoryNumberToMb(value: string, unit?: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const normalizedUnit = (unit ?? "").toUpperCase();
  if (normalizedUnit.startsWith("G")) return parsed * 1024;
  if (normalizedUnit.startsWith("K") || normalizedUnit === "") return parsed / 1024;
  return parsed;
}

export function parseCpuUsagePercent(raw?: string) {
  const value = firstLine(raw)?.match(/(\d+(?:[.,]\d+)?)\s*%/)?.[1];
  if (!value) return undefined;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : undefined;
}

export function parseCpuLoad(raw?: string) {
  return parseCpuUsagePercent(raw);
}

export function parseMemoryUsagePercent(raw?: string) {
  const line = splitMetricLines(raw).find((entry) => /^Mem:/i.test(entry)) ?? firstLine(raw);
  if (!line) return undefined;
  const parts = line.split(/\s+/).filter((part) => part !== "Mem:");
  if (parts.length >= 3) {
    const total = Number(parts[0]);
    const used = Number(parts[1]);
    if (Number.isFinite(total) && total > 0 && Number.isFinite(used)) return Math.round((used / total) * 100);
  }
  const busyboxMatch = line.match(/Mem:\s*(\d+)\w*\s+used,?\s+(\d+)\w*\s+free/i);
  if (!busyboxMatch) return undefined;
  const used = Number(busyboxMatch[1]);
  const free = Number(busyboxMatch[2]);
  return Number.isFinite(used) && Number.isFinite(free) && used + free > 0 ? Math.round((used / (used + free)) * 100) : undefined;
}

export function parseTemperature(raw?: string) {
  const value = Number(firstLine(raw)?.replace(",", "."));
  if (!Number.isFinite(value)) return undefined;
  return value > 1000 ? value / 1000 : value;
}

export function parseStorageSizeToGiB(value: string) {
  const match = value.match(/^([0-9.]+)\s*([KMGTPE]?)(?:i?B?)?$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  const unit = match[2].toUpperCase();
  if (unit === "K") return amount / 1024 / 1024;
  if (unit === "M") return amount / 1024;
  if (unit === "T") return amount * 1024;
  if (unit === "P") return amount * 1024 * 1024;
  if (unit === "E") return amount * 1024 * 1024 * 1024;
  return amount;
}

export function calculateDiskPercent(used: string, total: string) {
  const usedGiB = parseStorageSizeToGiB(used);
  const totalGiB = parseStorageSizeToGiB(total);
  if (usedGiB === undefined || totalGiB === undefined || totalGiB <= 0) return undefined;
  return (usedGiB / totalGiB) * 100;
}

export function parseDiskInfo(raw?: string) {
  const line = splitMetricLines(raw).find((entry) => /\d+%/.test(entry) && !/^filesystem\s+/i.test(entry));
  if (!line) return undefined;
  const parts = line.split(/\s+/);
  const percentIndex = parts.findIndex((part) => /^\d+%$/.test(part));
  if (percentIndex < 4) return undefined;
  const total = parts[percentIndex - 3];
  const used = parts[percentIndex - 2];
  const available = parts[percentIndex - 1];
  const percentFromDf = Number(parts[percentIndex].replace("%", ""));
  const percent = calculateDiskPercent(used, total) ?? (Number.isFinite(percentFromDf) ? percentFromDf : undefined);
  if (percent === undefined) return undefined;
  return { filesystem: parts[0], total, used, available, percent, mount: parts.slice(percentIndex + 1).join(" ") };
}

export function parseDiskUsagePercent(raw?: string) {
  return parseDiskInfo(raw)?.percent;
}

export function formatPercent(value: number) {
  if (value > 0 && value < 1) return `${value.toFixed(1).replace(".", ",")}%`;
  if (value < 10 && value % 1 !== 0) return `${value.toFixed(1).replace(".", ",")}%`;
  return `${Math.round(value)}%`;
}

export function formatTemperature(raw?: string) {
  const value = parseTemperature(raw);
  return value === undefined ? firstLine(raw) ?? "nicht verfügbar" : `${Math.round(value * 10) / 10} °C`;
}

export function formatMemory(raw?: string) {
  const lines = splitMetricLines(raw);
  const line = lines.find((entry) => /^Mem:/i.test(entry)) ?? lines.find((entry) => !/^total\s+used\s+free/i.test(entry));
  if (!line) return "nicht verfügbar";
  const busyboxMatch = line.match(/Mem:\s*([0-9.]+)\s*([KMGT]?B?|K)?\s+used,?\s+([0-9.]+)\s*([KMGT]?B?|K)?\s+free/i);
  if (busyboxMatch) {
    const used = parseMemoryNumberToMb(busyboxMatch[1], busyboxMatch[2]);
    const free = parseMemoryNumberToMb(busyboxMatch[3], busyboxMatch[4]);
    const total = used + free;
    return total > 0 ? `${Math.round((used / total) * 100)}% belegt · ${Math.round(free)} MB frei` : "nicht verfügbar";
  }
  const parts = line.split(/\s+/).filter((part) => part !== "Mem:");
  if (parts.length >= 3) {
    const total = Number(parts[0]);
    const used = Number(parts[1]);
    const available = Number(parts[6] ?? parts[3]);
    if (Number.isFinite(total) && total > 0 && Number.isFinite(used)) return `${Math.round((used / total) * 100)}% belegt · ${Number.isFinite(available) ? `${available} MB verfügbar` : `${total - used} MB frei`}`;
  }
  return line;
}

export function formatDisk(raw?: string) {
  const disk = parseDiskInfo(raw);
  if (disk) return `${formatPercent(disk.percent)} belegt · ${disk.available} frei von ${disk.total}${disk.mount ? ` · ${disk.mount}` : ""}`;
  return splitMetricLines(raw).find((line) => !/^filesystem\s+/i.test(line)) ?? "nicht verfügbar";
}

export function formatCpu(raw?: string) {
  const percent = parseCpuUsagePercent(raw);
  return percent === undefined ? "nicht verfügbar" : `${percent}% Auslastung`;
}

export function formatUptime(raw?: string) {
  const line = firstLine(raw);
  if (!line) return "nicht verfügbar";
  const uptime = line.match(/\bup\s+(.+?),\s+\d+\s+users?/i)?.[1] ?? line.match(/\bup\s+(.+?),\s+load average/i)?.[1] ?? line.replace(/^\s*\d{1,2}:\d{2}:\d{2}\s+up\s+/i, "");
  const clean = uptime.replace(/,\s*load average:.*$/i, "").trim();
  const dayMatch = clean.match(/(\d+)\s+days?,\s*(\d{1,2}):(\d{2})/i);
  if (dayMatch) return `${dayMatch[1]} Tage, ${Number(dayMatch[2])} h ${Number(dayMatch[3])} min`;
  const hourMinuteMatch = clean.match(/(\d{1,2}):(\d{2})/);
  if (hourMinuteMatch) return `${Number(hourMinuteMatch[1])} h ${Number(hourMinuteMatch[2])} min`;
  const minuteMatch = clean.match(/(\d+)\s+min/i);
  if (minuteMatch) return `${minuteMatch[1]} min`;
  return clean.replace(/\bdays?\b/i, "Tage").replace(/\bhours?\b/i, "h").replace(/\bminutes?\b/i, "min");
}

export function formatBackupDate(raw?: string) {
  if (!raw) return "";
  const date = new Date(raw.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

export function formatBackups(count?: string, paths?: string[], latestDirectory?: string, latestAt?: string, latestPath?: string) {
  if (!count) return "nicht geprüft";
  const backupCount = Number(count);
  const label = Number.isFinite(backupCount) ? backupCount === 0 ? "keine gefunden" : `${backupCount} gefunden` : `${count} gefunden`;
  if (backupCount === 0) return label;
  const directory = latestDirectory ?? (latestPath ? latestPath.replace(/\/[^/]+$/, "/") : undefined) ?? (paths?.at(-1) ? paths.at(-1)!.replace(/\/[^/]+$/, "/") : undefined);
  const displayDate = formatBackupDate(latestAt);
  return [label, directory, displayDate ? `Letztes Backup vom ${displayDate}` : ""].filter(Boolean).join("\n");
}

export function metricNeedsHelp(value: string) {
  return value === "nicht verfügbar" || value === "nicht geprüft" || value === "keine gefunden" || value.startsWith("keine gefunden");
}

export function formatSnifferTime(value?: string) {
  return value ? new Date(value).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "–";
}

export function noiseAssessment(value?: number) {
  if (value === undefined) return { label: "Nicht gemessen", className: "unknown" };
  if (value <= -100) return { label: "Sehr ruhiger Funkhintergrund", className: "excellent" };
  if (value <= -90) return { label: "Ruhiger Funkhintergrund", className: "good" };
  if (value <= -80) return { label: "Erhöhter Rauschpegel", className: "medium" };
  return { label: "Starker Funkhintergrund", className: "weak" };
}

export function formatDataAge(value?: string) {
  if (!value) return { label: "keine Daten", state: "missing" };
  const ageMinutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (ageMinutes < 2) return { label: "live / gerade eben", state: "fresh" };
  if (ageMinutes < 60) return { label: `vor ${ageMinutes} Min.`, state: ageMinutes <= 10 ? "fresh" : "stale" };
  return { label: `vor ${Math.round(ageMinutes / 60)} Std.`, state: "stale" };
}

export function flagClass(flag: string) {
  if (flag === "BURST") return "danger";
  if (flag === "BIDI") return "warn";
  if (flag === "WKMEUP") return "info";
  return "ok";
}

export function sparklinePoints(values: number[], width = 120, height = 34, min = 0, max = 100) {
  if (values.length === 0) return "";
  const range = Math.max(max - min, 1);
  const normalizedValues = values.map((value) => Math.max(min, Math.min(max, value)));
  if (normalizedValues.length === 1) {
    const y = height - ((normalizedValues[0] - min) / range) * height;
    return `0,${Math.round(y * 10) / 10} ${width},${Math.round(y * 10) / 10}`;
  }
  return normalizedValues.map((value, index) => {
    const x = (index / (normalizedValues.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
  }).join(" ");
}

export function historyTimeLabels(history?: Array<{ collectedAt: string }>) {
  const points = history?.filter((point) => point.collectedAt) ?? [];
  if (points.length < 2) return undefined;
  const formatTime = (value: string) => new Date(value).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return { start: formatTime(points[0].collectedAt), end: formatTime(points.at(-1)!.collectedAt), duration: `${points.length} min` };
}
