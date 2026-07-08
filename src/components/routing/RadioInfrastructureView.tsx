import { InfoTooltip } from "../ui/InfoTooltip";
import type { RoutingTopology } from "../../types";

export function RadioInfrastructureView({
  topology,
  loading,
  onRefresh
}: {
  topology: RoutingTopology | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  if (!topology) {
    return (
      <section className="radio-infrastructure-card">
        <div className="radio-infrastructure-empty">
          <strong>{loading ? "Funk-Infrastruktur wird gelesen …" : "Noch keine Infrastruktur-Daten geladen"}</strong>
          <button type="button" className="light-button" onClick={onRefresh} disabled={loading}>
            {loading ? "Lädt …" : "Jetzt laden"}
          </button>
        </div>
      </section>
    );
  }

  const gateways = topology.nodes.filter((node) => node.role === "gateway");
  const routers = topology.nodes.filter((node) => node.role === "router");
  const candidates = topology.nodes.filter((node) => node.role === "candidate");
  const visibleNodes = [...gateways, ...routers, ...candidates];

  return (
    <section className="radio-infrastructure-card">
      <div className="radio-infrastructure-header">
        <div>
          <p className="eyebrow">Funk-Infrastruktur</p>
          <h4>Router und Funk-Gateways</h4>
          <p>Die CCU meldet Rollen und Konfigurationen, aber keine Live-Tabelle des aktuell verwendeten Funkwegs.</p>
        </div>
        <button type="button" className="light-button" onClick={onRefresh} disabled={loading}>
          {loading ? "Aktualisiert …" : "Infrastruktur aktualisieren"}
        </button>
      </div>

      <div className="radio-infrastructure-metrics">
        <span><strong>{gateways.length}</strong> Funk-Gateways</span>
        <span><strong>{routers.length}</strong> bestätigte HmIP-Router</span>
        <span><strong>{candidates.length}</strong> mögliche Router-Kandidaten</span>
      </div>

      <div className="radio-infrastructure-note">
        <strong>Wichtig</strong>
        <span>Welchen Empfänger ein einzelnes Gerät gerade nutzt, stellt die CCU nicht als belastbaren Datenpunkt bereit. Für schwachen Empfang öffne „Signalqualität“; Funkzeit pro Gerät zeigt der DC-Analyzer mit Sniffer.</span>
      </div>

      {visibleNodes.length > 0 ? (
        <div className="radio-infrastructure-list">
          {visibleNodes.map((node) => (
            <article key={node.id}>
              <span className={`radio-infrastructure-role ${node.role}`}>
                {node.role === "gateway" ? "Gateway" : node.role === "router" ? "Router" : "Kandidat"}
              </span>
              <strong>{node.name}</strong>
              <small>{node.type ?? "Typ nicht gemeldet"}</small>
              {node.role === "router" && <small>{node.routingEnabled ? "Routing aktiviert" : "Router belegt"}</small>}
            </article>
          ))}
        </div>
      ) : <p className="muted">Keine Router oder Gateways in den verfügbaren Daten erkannt.</p>}
    </section>
  );
}
