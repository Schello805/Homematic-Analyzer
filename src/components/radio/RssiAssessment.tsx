import "./RssiAssessment.css";

export type RssiAssessmentState = "unknown" | "excellent" | "good" | "medium" | "weak";

export function rssiClass(value?: number): RssiAssessmentState | "" {
  if (value === undefined || value >= 0 || value < -150) return "";
  if (value >= -60) return "excellent";
  if (value >= -72) return "good";
  if (value >= -85) return "medium";
  return "weak";
}

export function rssiAssessment(value?: number) {
  if (value === undefined || value >= 0 || value < -150) return { label: "Kein Wert", symbol: "?", className: "unknown" as const, value: undefined };
  if (value >= -60) return { label: "Sehr gut", symbol: "👍", className: "excellent" as const, value };
  if (value >= -72) return { label: "Gut", symbol: "👍", className: "good" as const, value };
  if (value >= -85) return { label: "Beobachten", symbol: "●", className: "medium" as const, value };
  return { label: "Schwach", symbol: "👎", className: "weak" as const, value };
}

export function RssiAssessment({ value }: { value?: number }) {
  const assessment = rssiAssessment(value);
  return (
    <span className={`rssi-assessment ${assessment.className}`}>
      <i aria-hidden="true">{assessment.symbol}</i>
      <strong>{assessment.label}</strong>
      {assessment.value !== undefined && <span>{assessment.value} dBm</span>}
    </span>
  );
}

export function DualRssiAssessment({
  ccu,
  sniffer,
  compact = false
}: {
  ccu?: number;
  sniffer?: number;
  compact?: boolean;
}) {
  return (
    <span className={`dual-rssi ${compact ? "is-compact" : ""}`}>
      <span>
        <small>Zentrale</small>
        <RssiAssessment value={ccu} />
      </span>
      <span>
        <small>Sniffer</small>
        <RssiAssessment value={sniffer} />
      </span>
    </span>
  );
}

export function parseRssiComparison(detail: string) {
  const match = detail.match(/^(.+?): Zentrale (-?\d+|nicht verfügbar) dBm, Sniffer (-?\d+|nicht verfügbar) dBm\.$/i);
  if (!match) return null;
  const parseValue = (value: string) => value === "nicht verfügbar" ? undefined : Number(value);
  return { name: match[1], ccu: parseValue(match[2]), sniffer: parseValue(match[3]) };
}

export function parseCentralRssi(detail: string) {
  const match = detail.match(/^(.+?): Zentrale (-?\d+|nicht verfügbar) dBm\.$/i);
  if (!match) return null;
  return { name: match[1], ccu: match[2] === "nicht verfügbar" ? undefined : Number(match[2]) };
}

export function normalizeRadioIdentifier(value?: string) {
  return (value ?? "").trim().toUpperCase().replace(/:\d+$/, "");
}
