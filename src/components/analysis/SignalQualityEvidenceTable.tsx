import { useMemo, useState } from "react";
import { parseCentralRssi, parseRssiComparison, RssiAssessment, rssiClass } from "../radio/RssiAssessment";
import "./SignalQualityEvidenceTable.css";

type Evidence = { source: string; detail: string };
type Filter = "all" | "attention" | "sniffer" | "without-sniffer";
type SortKey = "name" | "ccu" | "sniffer" | "worst";
type SortDirection = "asc" | "desc";
type SignalRow = { name: string; ccu?: number; sniffer?: number };

function needsAttention(row: SignalRow) {
  return [row.ccu, row.sniffer].some((value) => ["medium", "weak"].includes(rssiClass(value)));
}

function worstValue(row: SignalRow) {
  const values = [row.ccu, row.sniffer].filter((value): value is number => value !== undefined);
  return values.length > 0 ? Math.min(...values) : undefined;
}

function valueForSort(row: SignalRow, key: SortKey): string | number {
  if (key === "name") return row.name.toLocaleLowerCase("de-DE");
  if (key === "ccu") return row.ccu ?? Number.POSITIVE_INFINITY;
  if (key === "sniffer") return row.sniffer ?? Number.POSITIVE_INFINITY;
  return worstValue(row) ?? Number.POSITIVE_INFINITY;
}

export function isSignalQualityEvidence(item: Evidence) {
  return item.source === "RSSI-Vergleich" && Boolean(parseRssiComparison(item.detail) ?? parseCentralRssi(item.detail));
}

export function SignalQualityEvidenceTable({ evidence, onImprove }: { evidence: Evidence[]; onImprove: (name: string) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("worst");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const rows = useMemo<SignalRow[]>(() => evidence.flatMap((item) => {
    const comparison = parseRssiComparison(item.detail) ?? parseCentralRssi(item.detail);
    return comparison ? [comparison] : [];
  }), [evidence]);
  const visibleRows = useMemo(() => rows
    .filter((row) => row.name.toLocaleLowerCase("de-DE").includes(query.trim().toLocaleLowerCase("de-DE")))
    .filter((row) => filter === "attention" ? needsAttention(row) : filter === "sniffer" ? row.sniffer !== undefined : filter === "without-sniffer" ? row.sniffer === undefined : true)
    .sort((left, right) => {
      const leftValue = valueForSort(left, sortKey);
      const rightValue = valueForSort(right, sortKey);
      const result = typeof leftValue === "string" && typeof rightValue === "string"
        ? leftValue.localeCompare(rightValue, "de-DE")
        : Number(leftValue) - Number(rightValue);
      return sortDirection === "asc" ? result : -result;
    }), [filter, query, rows, sortDirection, sortKey]);
  const toggleSort = (key: SortKey) => {
    if (key === sortKey) return setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    setSortKey(key);
    setSortDirection("asc");
  };
  const sortLabel = (key: SortKey) => sortKey === key ? (sortDirection === "asc" ? " ↑" : " ↓") : "";

  return (
    <section className="signal-evidence-table" aria-label="RSSI-Vergleich">
      <div className="signal-evidence-table__toolbar">
        <label><span>Gerät suchen</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name eingeben …" /></label>
        <label><span>Anzeige</span><select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
          <option value="all">Alle Geräte</option><option value="attention">Nur auffällige</option><option value="sniffer">Mit Snifferwert</option><option value="without-sniffer">Ohne Snifferwert</option>
        </select></label>
        <output>{visibleRows.length} von {rows.length} Geräten</output>
      </div>
      <div className="signal-evidence-table__scroll">
        <table><thead><tr>
          <th><button type="button" onClick={() => toggleSort("name")}>Gerät{sortLabel("name")}</button></th>
          <th><button type="button" onClick={() => toggleSort("ccu")}>Zentrale{sortLabel("ccu")}</button></th>
          <th><button type="button" onClick={() => toggleSort("sniffer")}>Sniffer{sortLabel("sniffer")}</button></th>
          <th><button type="button" onClick={() => toggleSort("worst")}>Schwächster Wert{sortLabel("worst")}</button></th>
          <th><span className="sr-only">Aktion</span></th>
        </tr></thead><tbody>{visibleRows.map((row) => <tr key={`${row.name}-${row.ccu ?? ""}-${row.sniffer ?? ""}`}>
          <td className="signal-evidence-table__name">{row.name}</td><td><RssiAssessment value={row.ccu} /></td><td><RssiAssessment value={row.sniffer} /></td><td><RssiAssessment value={worstValue(row)} /></td>
          <td><button type="button" className="evidence-action" onClick={() => onImprove(row.name)}>Empfang verbessern</button></td>
        </tr>)}</tbody></table>
        {visibleRows.length === 0 && <p className="signal-evidence-table__empty">Keine Geräte passen zu diesem Filter.</p>}
      </div>
    </section>
  );
}
