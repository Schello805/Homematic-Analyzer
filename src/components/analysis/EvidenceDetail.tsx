import {
  DualRssiAssessment,
  parseCentralRssi,
  parseRssiComparison,
  RssiAssessment
} from "../radio/RssiAssessment";

type Evidence = {
  source: string;
  detail: string;
};

export function sourceBadge(source: string) {
  const normalized = source.toLowerCase();
  if (normalized.includes("sniffer") || normalized.includes("asksin")) return { label: "Sniffer", className: "source-sniffer" };
  if (normalized.includes("collector") || normalized.includes("shell") || normalized.includes("logzeile") || normalized.includes("hmipserver")) return { label: "Collector", className: "source-collector" };
  if (normalized.includes("ki") || normalized.includes("openai") || normalized.includes("gemini")) return { label: "KI", className: "source-ai" };
  if (normalized.includes("github") || normalized.includes("release") || normalized.includes("openccu") || normalized.includes("eq-3")) return { label: "Online", className: "source-online" };
  if (normalized.includes("setup") || normalized.includes("konfiguration")) return { label: "Setup", className: "source-setup" };
  if (normalized.includes("ccu") || normalized.includes("xml-api") || normalized.includes("zentrale") || normalized.includes("webui") || normalized.includes("rega")) return { label: "CCU", className: "source-ccu" };
  return { label: "Quelle", className: "source-default" };
}

export function SourceBadge({ source }: { source: string }) {
  const badge = sourceBadge(source);
  return <span className={`source-badge ${badge.className}`}>{badge.label}</span>;
}

export function EvidenceDetail({ item }: { item: Evidence }) {
  const rssiComparison = item.source === "RSSI-Vergleich" ? parseRssiComparison(item.detail) : null;
  const centralRssi = item.source === "RSSI-Vergleich" ? parseCentralRssi(item.detail) : null;
  if (!rssiComparison && !centralRssi) return <span>{item.detail}</span>;

  if (centralRssi) {
    return (
      <div className="evidence-rssi-comparison">
        <span>{centralRssi.name}</span>
        <span className="single-rssi">
          <small>Zentrale</small>
          <RssiAssessment value={centralRssi.ccu} />
        </span>
      </div>
    );
  }

  if (!rssiComparison) return <span>{item.detail}</span>;
  return (
    <div className="evidence-rssi-comparison">
      <span>{rssiComparison.name}</span>
      <DualRssiAssessment ccu={rssiComparison.ccu} sniffer={rssiComparison.sniffer} />
    </div>
  );
}
