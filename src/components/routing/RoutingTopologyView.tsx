import { useEffect, useRef, useState } from "react";
import { DualRssiAssessment, normalizeRadioIdentifier, rssiClass, RssiAssessment } from "../radio/RssiAssessment";
import { InfoTooltip } from "../ui/InfoTooltip";
import { SourceBadge } from "../analysis/EvidenceDetail";
import type { AnalysisSnifferMode, RoutingTopology, RoutingTopologyNode } from "../../types";

function polarPoint(center: number, radius: number, percent: number) {
  const angle = (percent * 3.6 - 90) * Math.PI / 180;
  return {
    x: center + Math.cos(angle) * radius,
    y: center + Math.sin(angle) * radius
  };
}

function donutSegmentPath(startPercent: number, endPercent: number, outerRadius = 48, innerRadius = 25) {
  const safeEnd = Math.min(endPercent, startPercent + 99.999);
  const outerStart = polarPoint(50, outerRadius, startPercent);
  const outerEnd = polarPoint(50, outerRadius, safeEnd);
  const innerEnd = polarPoint(50, innerRadius, safeEnd);
  const innerStart = polarPoint(50, innerRadius, startPercent);
  const largeArc = safeEnd - startPercent > 50 ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z"
  ].join(" ");
}

function routingRssiForNode(node: RoutingTopologyNode, includeSnifferRssi: boolean): number | undefined {
  if (!includeSnifferRssi) return node.ccuRssi;
  const values = [node.ccuRssi, node.snifferRssi].filter((value): value is number => value !== undefined);
  return values.length ? Math.min(...values) : undefined;
}

export function RoutingTopologyView({
  topology,
  loading,
  dataRefreshing,
  selectedNodeId,
  onSelectNode,
  onRefresh
}: {
  topology: RoutingTopology | null;
  loading: boolean;
  dataRefreshing: boolean;
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
  onRefresh: () => void;
}) {
  const [hoveredNodeId, setHoveredNodeId] = useState("");
  const [includeSnifferRssi, setIncludeSnifferRssi] = useState(() => typeof window === "undefined" ? false : window.sessionStorage.getItem("homematic-analyzer-routing-rssi-source") === "with-sniffer");
  const [topologyScope, setTopologyScope] = useState<"hmip" | "bidcos" | "combined">(() => {
    if (typeof window === "undefined") return "hmip";
    const stored = window.sessionStorage.getItem("homematic-analyzer-routing-scope");
    return stored === "bidcos" || stored === "combined" ? stored : "hmip";
  });
  const [topologyFilter, setTopologyFilter] = useState<"focus" | "infrastructure" | "all">(() => {
    if (typeof window === "undefined") return "focus";
    const stored = window.sessionStorage.getItem("homematic-analyzer-routing-filter");
    return stored === "infrastructure" || stored === "all" ? stored : "focus";
  });
  const [routingMapMode, setRoutingMapMode] = useState<"paths" | "signals">(() => {
    if (typeof window === "undefined") return "paths";
    return window.sessionStorage.getItem("homematic-analyzer-routing-map-mode") === "signals" ? "signals" : "paths";
  });
  const previousMeasuredNodeIds = useRef<Set<string>>(new Set());
  const [arrivingNodeIds, setArrivingNodeIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem("homematic-analyzer-routing-rssi-source", includeSnifferRssi ? "with-sniffer" : "base");
      window.sessionStorage.setItem("homematic-analyzer-routing-scope", topologyScope);
      window.sessionStorage.setItem("homematic-analyzer-routing-filter", topologyFilter);
      window.sessionStorage.setItem("homematic-analyzer-routing-map-mode", routingMapMode);
    } catch {
    }
  }, [includeSnifferRssi, topologyScope, topologyFilter, routingMapMode]);

  useEffect(() => {
    const measuredNodeIds = new Set((topology?.nodes ?? [])
      .filter((node) => node.role !== "central" && routingRssiForNode(node, includeSnifferRssi) !== undefined)
      .map((node) => node.id));
    const arrivals = [...measuredNodeIds].filter((nodeId) => !previousMeasuredNodeIds.current.has(nodeId));
    previousMeasuredNodeIds.current = measuredNodeIds;

    if (arrivals.length === 0) return;
    setArrivingNodeIds(new Set(arrivals));
    const timeout = window.setTimeout(() => setArrivingNodeIds(new Set()), 720);
    return () => window.clearTimeout(timeout);
  }, [topology?.generatedAt, includeSnifferRssi, topology?.nodes]);

  if (!topology) {
    return (
      <section className="routing-topology-card">
        <div className="routing-topology-empty">
          <strong>{loading ? "Routingdaten werden geladen …" : "Noch keine Topologiedaten geladen"}</strong>
          <button type="button" className="light-button" onClick={onRefresh} disabled={loading}>
            {loading ? "Lädt …" : "Jetzt laden"}
          </button>
        </div>
      </section>
    );
  }

  const central = topology.nodes.find((node) => node.role === "central");
  const visibleNodes = topology.nodes.filter((node) => (
    node.role === "central"
    || topologyScope === "combined"
    || node.protocol === topologyScope
  ));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const centralRssiCount = visibleNodes.filter((node) => node.ccuRssi !== undefined).length;
  const snifferRssiCount = visibleNodes.filter((node) => node.snifferRssi !== undefined).length;
  const ccuRssiLoading = !includeSnifferRssi && dataRefreshing && centralRssiCount === 0;
  const visibleEdges = topology.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));
  const gateways = visibleNodes.filter((node) => node.role === "gateway");
  const routers = visibleNodes.filter((node) => node.role === "router");
  const candidates = visibleNodes.filter((node) => node.role === "candidate");
  const selectedNode = visibleNodes.find((node) => node.id === selectedNodeId) ?? central;
  const selectedRoute = selectedNode ? visibleEdges.find((edge) => edge.source === selectedNode.id) : undefined;
  const selectedReceiver = selectedRoute ? visibleNodes.find((node) => node.id === selectedRoute.target) : undefined;
  const nodeRssi = (node?: RoutingTopologyNode) => {
    if (!node) return undefined;
    return routingRssiForNode(node, includeSnifferRssi);
  };
  const rssiSourceLabel = includeSnifferRssi ? "mit Snifferwerten" : "ohne Snifferwerte";
  const rssiSourceShortLabel = includeSnifferRssi ? "CCU + Sniffer" : "CCU / XML-API";
  const confirmedSourceIds = new Set(visibleEdges.map((edge) => edge.source));
  const nodeClass = (node: RoutingTopologyNode) => {
    if (node.role === "central") return "is-central";
    if (node.role === "gateway") return "is-gateway";
    if (node.role === "router") return "is-router";
    if (node.role === "candidate") return "is-candidate";
    return "is-device";
  };
  const hasRoutingConfig = topology.diagnostics.some((item) => item.includes("direkt aus den HmIP-RF-Geräteparametern"));
  const measuredNodes = visibleNodes
    .filter((node) => node.role !== "central" && nodeRssi(node) !== undefined)
    .sort((left, right) => (nodeRssi(left) ?? 0) - (nodeRssi(right) ?? 0));
  const weakNodes = measuredNodes.filter((node) => rssiClass(nodeRssi(node)) === "weak");
  const observedNodes = measuredNodes.filter((node) => rssiClass(nodeRssi(node)) === "medium");
  const goodNodes = measuredNodes.filter((node) => rssiClass(nodeRssi(node)) === "good");
  const excellentNodes = measuredNodes.filter((node) => rssiClass(nodeRssi(node)) === "excellent");
  const confirmedTargetIds = new Set(visibleEdges.map((edge) => edge.target));
  const focusNodeIds = new Set([
    "central",
    ...gateways.map((node) => node.id),
    ...routers.map((node) => node.id),
    ...candidates.map((node) => node.id),
    ...weakNodes.map((node) => node.id),
    ...observedNodes.map((node) => node.id),
    ...confirmedSourceIds,
    ...confirmedTargetIds
  ]);
  const infrastructureNodeIds = new Set([
    "central",
    ...gateways.map((node) => node.id),
    ...routers.map((node) => node.id),
    ...candidates.map((node) => node.id)
  ]);
  const waitingNodes = visibleNodes.filter((node) => node.role !== "central" && nodeRssi(node) === undefined);
  const waitingNodeIds = new Set(waitingNodes.map((node) => node.id));
  const signalGraphNodes = visibleNodes.filter((node) => {
    if (node.role === "central") return true;
    if (waitingNodeIds.has(node.id)) return false;
    return topologyFilter === "all"
      || (topologyFilter === "infrastructure" ? infrastructureNodeIds.has(node.id) : focusNodeIds.has(node.id));
  });
  const pathNodeIds = new Set([
    "central",
    ...gateways.map((node) => node.id),
    ...routers.map((node) => node.id),
    ...visibleEdges.flatMap((edge) => [edge.source, edge.target])
  ]);
  const graphNodes = routingMapMode === "paths"
    ? visibleNodes.filter((node) => pathNodeIds.has(node.id))
    : signalGraphNodes;
  const graphNodeIds = new Set(graphNodes.map((node) => node.id));
  const graphEdges = visibleEdges.filter((edge) => graphNodeIds.has(edge.source) && graphNodeIds.has(edge.target));
  const allTechnologyWeakNodes = topology.nodes.filter((node) => node.role !== "central" && rssiClass(nodeRssi(node)) === "weak");
  const weakNodesOutsideScope = allTechnologyWeakNodes.filter((node) => !visibleNodeIds.has(node.id));
  const graphGateways = graphNodes.filter((node) => node.role === "gateway");
  const graphRouters = graphNodes.filter((node) => node.role === "router");
  const graphCandidates = graphNodes.filter((node) => node.role === "candidate");
  const graphDevices = graphNodes.filter((node) => node.role === "device");
  const hiddenGraphNodes = Math.max(0, visibleNodes.length - signalGraphNodes.length - waitingNodes.length);
  const hoveredNode = visibleNodes.find((node) => node.id === hoveredNodeId);
  const center = { x: 450, y: 300 };
  const positions = new Map<string, { x: number; y: number }>();
  positions.set("central", center);
  const waitingPositions = new Map<string, { x: number; y: number }>();
  const visibleNonCentralNodes = visibleNodes.filter((node) => node.role !== "central");
  const waitingPositionFor = (index: number) => ({
    x: 744 + (index % 8) * 24,
    y: 158 + Math.floor(Math.min(index, 15) / 8) * 20
  });
  visibleNonCentralNodes.forEach((node, index) => waitingPositions.set(node.id, waitingPositionFor(index)));
  const waitingPreviewNodes = waitingNodes.slice(0, 16);
  const allowsMotion = typeof window === "undefined" || !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const signalRadius = (node: RoutingTopologyNode, fallback: number) => {
    const rssi = nodeRssi(node);
    if (rssi === undefined) return fallback;
    if (rssi >= -60) return 145;
    if (rssi >= -72) return 145 + ((-60 - rssi) / 12) * 35;
    if (rssi >= -85) return 180 + ((-72 - rssi) / 13) * 35;
    return Math.min(245, 215 + ((-85 - rssi) / 20) * 30);
  };

  const placeRing = (nodes: RoutingTopologyNode[], fallbackRadius: number, offset = -90, fixedRadius?: number) => {
    nodes.forEach((node, index) => {
      const angle = ((offset + (360 / Math.max(nodes.length, 1)) * index) * Math.PI) / 180;
      const radius = fixedRadius ?? signalRadius(node, fallbackRadius);
      positions.set(node.id, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      });
    });
  };

  if (routingMapMode === "paths") {
    positions.set("central", { x: 150, y: 300 });
    const pathReceivers = [...graphGateways, ...graphRouters];
    const pathDevices = graphNodes.filter((node) => node.role === "device" || node.role === "candidate");
    const placeColumn = (nodes: RoutingTopologyNode[], x: number) => {
      const spacing = Math.min(110, 420 / Math.max(nodes.length - 1, 1));
      const startY = 300 - ((nodes.length - 1) * spacing) / 2;
      nodes.forEach((node, index) => positions.set(node.id, { x, y: startY + index * spacing }));
    };
    placeColumn(pathReceivers, 485);
    placeColumn(pathDevices, 790);
  } else {
    placeRing(graphGateways, 145, -145);
    placeRing(graphRouters, 145, -65);
    placeRing(graphCandidates, 145, -5);
    placeRing(graphDevices, 270, -90);
  }

  const hoveredPosition = hoveredNode ? positions.get(hoveredNode.id) ?? waitingPositions.get(hoveredNode.id) : undefined;
  const hoverLabelX = hoveredPosition ? Math.max(130, Math.min(870, hoveredPosition.x)) : 0;
  const hoverLabelY = hoveredPosition
    ? hoveredPosition.y < 82 ? hoveredPosition.y + 30 : hoveredPosition.y - 68
    : 0;
  const scopeLabel = topologyScope === "hmip"
    ? "Homematic IP"
    : topologyScope === "bidcos" ? "Klassisches Homematic" : "Gesamte Funkinstallation";
  const visibleDeviceCount = visibleNodes.filter((node) => node.role !== "central" && node.role !== "gateway").length;
  const receiverCount = gateways.length + routers.length;
  const focusCount = Math.max(0, focusNodeIds.size - 1);
  const infrastructureCount = Math.max(0, infrastructureNodeIds.size - 1);
  const allDeviceCount = Math.max(0, visibleNodes.length - 1);
  const selectedRssi = nodeRssi(selectedNode);
  const nodeRoleLabel = (node: RoutingTopologyNode) => {
    if (node.role === "central") return "Zentrale";
    if (node.role === "gateway") return "Funk-Gateway / Access Point";
    if (node.role === "router") return "Bestätigter HmIP-Router";
    if (node.role === "candidate") return "Möglicher Router-Kandidat";
    return node.protocol === "hmip" ? "HmIP-Gerät" : "Homematic-Gerät";
  };
  const selectedAdvice = (() => {
    if (!selectedNode) return "Wähle einen Knoten in der Karte, um die Bedeutung einzuordnen.";
    if (selectedNode.role === "central") {
      return routingMapMode === "paths"
        ? "Die Zentrale ist der Bezugspunkt. Diese Ansicht zeichnet nur tatsächlich im Log belegte Gerätewege. Ohne Linie ist keine Route behauptet – nicht etwa eine fehlende Verbindung."
        : "Die Zentrale ist der Bezugspunkt. Alle gemessenen Knoten liegen entsprechend ihrer Signalqualität: weiter außen bedeutet schwächer. Knoten ohne Messwert bleiben in der Warteschleife.";
    }
    if (selectedNode.role === "gateway") return "Dieses Gerät ist ein eigener Funkempfänger. Es erweitert den Empfang, ist aber kein HmIP-Router.";
    if (selectedNode.role === "router") return "Dieses Gerät ist als HmIP-Router belegt. Es kann anderen HmIP-Geräten als Zwischenstation helfen.";
    const ccuState = rssiClass(selectedNode.ccuRssi);
    const snifferState = rssiClass(selectedNode.snifferRssi);
    if (ccuState === "weak" && snifferState === "weak") return "Beide Quellen sehen das Gerät schwach. Standort, Batterie/Stromversorgung, Entfernung und mögliche Router/Gateways prüfen.";
    if (ccuState === "weak") return "Die Zentrale sieht dieses Gerät schwach. Ein näherer Router/Gateway oder ein anderer Gerätestandort kann helfen.";
    if (snifferState === "weak") return "Nur der Sniffer sieht dieses Gerät schwach. Das kann am Sniffer-Standort liegen und ist nicht automatisch ein CCU-Problem.";
    if (selectedRssi !== undefined) return "Der aktuelle Signalwert ist unauffällig. Kein direkter Handlungsbedarf aus dieser Messquelle.";
    return "Für dieses Gerät liegt noch kein RSSI-Wert vor. Ohne Messwert wird kein Funkproblem behauptet.";
  })();
  const signalSummaryForNode = (node: RoutingTopologyNode) => {
    const parts = [`CCU ${node.ccuRssi ?? "–"} dBm`];
    if (includeSnifferRssi) parts.push(`Sniffer ${node.snifferRssi ?? "–"} dBm`);
    return `${node.name} (${parts.join(" / ")})`;
  };
  const signalDetailForNode = (node?: RoutingTopologyNode) => {
    if (!node) return "Keine Signalwerte";
    const ccuDetail = `Zentrale: ${node.ccuRssi ?? "nicht verfügbar"} dBm${node.ccuRssiSource ? ` (${node.ccuRssiSource})` : ""}`;
    if (!includeSnifferRssi) return ccuDetail;
    return `${ccuDetail} · Sniffer: ${node.snifferRssi ?? "nicht verfügbar"} dBm`;
  };

  return (
    <section className="routing-topology-card">
      <div className="routing-topology-header">
        <div>
          <p className="eyebrow">Routing-Karte</p>
          <h4>{routingMapMode === "paths" ? `${scopeLabel}: belegte Funkwege` : `${scopeLabel}: Signalverteilung`}</h4>
          <InfoTooltip label="Karte lesen">
            {routingMapMode === "paths"
              ? "Diese Ansicht zeigt nur explizit durch Logs belegte Gerätewege. Ohne Log-Beleg wird keine Verbindung zur Zentrale oder einem Router erfunden."
              : "Die Position jedes gemessenen Knotens richtet sich nach dem gewählten RSSI-Wert: weiter außen bedeutet schwächer. Eine blaue Linie erscheint ausschließlich bei einem im Log ausdrücklich belegten Funkweg."}
          </InfoTooltip>
        </div>
        <button type="button" className="light-button" onClick={onRefresh} disabled={loading}>
          {loading ? "Aktualisiert …" : "Karte aktualisieren"}
        </button>
      </div>

      <div className="routing-scope-switch" role="group" aria-label="Funktechnologie auswählen">
        <button type="button" className={topologyScope === "hmip" ? "is-active" : ""} onClick={() => setTopologyScope("hmip")}>HmIP</button>
        <button type="button" className={topologyScope === "bidcos" ? "is-active" : ""} onClick={() => setTopologyScope("bidcos")}>Homematic</button>
        <button type="button" className={topologyScope === "combined" ? "is-active" : ""} onClick={() => setTopologyScope("combined")}>Beides</button>
      </div>

      <div className="routing-view-switch" role="group" aria-label="Ansicht der Routing-Karte auswählen">
        <button type="button" className={routingMapMode === "paths" ? "is-active" : ""} onClick={() => setRoutingMapMode("paths")}>Funkwege <small>{visibleEdges.length > 0 ? `${visibleEdges.length} belegt` : "nicht nachweisbar"}</small></button>
        <button type="button" className={routingMapMode === "signals" ? "is-active" : ""} onClick={() => setRoutingMapMode("signals")}>Signalverteilung <small>{measuredNodes.length} Werte</small></button>
      </div>

      <details className="routing-reading-help">
        <summary>So liest du diese Karte</summary>
        <div>
          <span><b>Abstand zur Mitte:</b> weiter außen = schwächerer gemessener RSSI-Wert der gewählten Quelle.</span>
          <span><b>Blaue Linie:</b> durch einen Logeintrag belegter Funkweg. Ohne Linie ist der tatsächlich verwendete nächste Empfänger unbekannt.</span>
          <span><b>Grün/gelb/rot:</b> Signalbewertung. Rot bedeutet zuerst prüfen, nicht automatisch „Gerät defekt“.</span>
          <span><b>G/R:</b> Gateway oder Router. Der Buchstabe zeigt die Rolle, der Abstand zeigt den Messwert.</span>
        </div>
      </details>

      <div className="routing-metrics">
        <span><strong>{visibleDeviceCount}</strong> Geräte</span>
        <span><strong>{gateways.length}</strong> Funk-Gateways</span>
        <span><strong>{routers.length}</strong> bestätigte HmIP-Router</span>
        <span><strong>{visibleEdges.length > 0 ? visibleEdges.length : "–"}</strong> {visibleEdges.length > 0 ? "belegte Wege" : "aktive Wege nicht nachweisbar"}</span>
      </div>

      {(topologyScope === "bidcos" || topologyScope === "combined") && gateways.length === 0 ? (
        <div className="routing-truth-note">
          <strong>Keine klassischen LAN-Gateways im aktuellen Snapshot</strong>
          <span>Aktualisiere die App und führe danach den Shell-Collector im Setup einmal erneut auf der CCU aus. Erst der neue Collector liest die Funk-Schnittstellen sicher aus.</span>
        </div>
      ) : null}

      <div className="routing-rssi-source">
        <div>
          <strong>
            <SourceBadge source={includeSnifferRssi ? "Sniffer" : "CCU"} />Signalquelle
            <InfoTooltip label="Signalquelle erklärt">
              {!includeSnifferRssi
                ? "Die Karte verwendet von der Zentrale gemeldete RSSI-Werte. RSSI_PEER wird bevorzugt, RSSI_DEVICE dient nur als Rückfallwert."
                : "Die Karte berücksichtigt Zentralenwerte und vorhandene Snifferwerte. Für die Position wird der schwächere bekannte Wert verwendet."}
            </InfoTooltip>
          </strong>
          <small>{includeSnifferRssi ? "Zentrale + Sniffer" : ccuRssiLoading ? "CCU-Werte werden geladen …" : "Zentrale / XML-API"}</small>
        </div>
        <label>
          Signalwerte anzeigen von
          <select value={includeSnifferRssi ? "with-sniffer" : "base"} onChange={(event) => setIncludeSnifferRssi(event.target.value === "with-sniffer")}>
            <option value="base">
              {ccuRssiLoading ? "Ohne Snifferwerte (wird geladen …)" : `Ohne Snifferwerte (${centralRssiCount} Zentralenwerte)`}
            </option>
            <option value="with-sniffer">
              Mit Snifferwerten ({snifferRssiCount} Snifferwerte)
            </option>
          </select>
        </label>
      </div>

      <div className={`routing-insight ${ccuRssiLoading || measuredNodes.length === 0 ? "is-unavailable" : weakNodes.length > 0 ? "has-warning" : "is-good"}`}>
        <div>
          <span className="routing-insight-icon" aria-hidden="true">{ccuRssiLoading ? "↻" : measuredNodes.length === 0 ? "?" : weakNodes.length > 0 ? "!" : "✓"}</span>
          <div>
            <strong>
              {ccuRssiLoading
                ? "CCU-Signalwerte werden geladen"
                : measuredNodes.length === 0
                ? `Signalqualität noch nicht bewertbar`
                : weakNodes.length > 0 ? `${weakNodes.length} schwach empfangene Geräte prüfen` : "Keine klaren Signalschwächen erkannt"}
            </strong>
            <p>
              {ccuRssiLoading
                ? "Die Infrastruktur ist schon sichtbar. Die Signalbewertung folgt automatisch, sobald die CCU-Antwort vollständig eingetroffen ist."
                : measuredNodes.length === 0
                ? `Für die Ansicht „${rssiSourceLabel}“ liegen im aktuellen Snapshot keine RSSI-Werte vor. Erkannte Geräte, Gateways und Router werden trotzdem angezeigt – aber nicht als gut oder schlecht bewertet.`
                : weakNodes.length > 0
                ? `${weakNodes.slice(0, 4).map(signalSummaryForNode).join(", ")}${weakNodes.length > 4 ? " …" : ""}`
                : `${measuredNodes.length} Geräte wurden bewertet${observedNodes.length > 0 ? `, ${observedNodes.length} davon sollten beobachtet werden` : ""}.`}
            </p>
            {weakNodesOutsideScope.length > 0 && (
              <small className="routing-scope-hint">{weakNodesOutsideScope.length} weitere schwache Geräte gehören zur anderen Funktechnik. Wähle „Beides“, um sie ebenfalls zu sehen.</small>
            )}
          </div>
        </div>
        {!ccuRssiLoading && <InfoTooltip label="Bewertung erklärt">
          {!includeSnifferRssi
            ? "Weiter außen bedeutet: Die Zentrale sieht dieses Gerät schwächer. Das heißt nicht automatisch „keine Verbindung“, sondern zeigt zuerst Prüfbedarf für Standort, Abstand, Hindernisse oder passenden Empfänger."
            : "Weiter außen bedeutet: Mindestens eine bekannte Messquelle sieht dieses Gerät schwächer. Prüfe danach, ob CCU, Sniffer oder beide Quellen betroffen sind."}
          {" "}Eine gestrichelte Linie bedeutet nicht „offline“: Der tatsächlich verwendete nächste Empfänger ist noch nicht belegt.
        </InfoTooltip>}
      </div>

      {measuredNodes.length > 0 ? (
        <div className="routing-signal-summary" aria-label={`Verteilung der Signalqualität für ${scopeLabel}: ${rssiSourceShortLabel}`}>
          <span className="excellent"><strong>{excellentNodes.length}</strong> sehr gut <small>ab −60 dBm</small></span>
          <span className="good"><strong>{goodNodes.length}</strong> gut <small>−61 bis −72 dBm</small></span>
          <span className="medium"><strong>{observedNodes.length}</strong> beobachten <small>−73 bis −85 dBm</small></span>
          <span className="weak"><strong>{weakNodes.length}</strong> schwach <small>unter −85 dBm</small></span>
        </div>
      ) : (
        <div className="routing-no-rssi">
          <div>
            <strong>{gateways.length + routers.length} bestätigte Funkempfänger und Router</strong>
            <span>{gateways.length} Gateway{gateways.length === 1 ? "" : "s"} · {routers.length} bestätigte HmIP-Router · {candidates.length} mögliche Router-Kandidaten</span>
          </div>
          <p>Signalwerte folgen automatisch.</p>
        </div>
      )}

      {measuredNodes.length > 0 && (
        <details className="routing-weak-devices" open={weakNodes.length > 0}>
          <summary>
            <span>
              <strong>Schwächste Geräte · {scopeLabel} · {rssiSourceShortLabel}</strong>
              <small>{includeSnifferRssi ? "Nach dem schwächeren bekannten Wert sortiert · beide Messquellen werden angezeigt" : "Nach Zentralenwert sortiert · Snifferwerte werden ausgeblendet"}</small>
            </span>
            <b>{Math.min(measuredNodes.length, 8)} anzeigen</b>
          </summary>
          <div>
            {measuredNodes.slice(0, 8).map((node) => (
              <button type="button" key={node.id} onClick={() => onSelectNode(node.id)}>
                <span>
                  <strong>{node.name}</strong>
                  <small>
                    {node.type ?? "HmIP-Gerät"}
                    {includeSnifferRssi ? ` · ${node.rssiTelegrams ?? 0} Sniffer-Telegramme` : " · CCU-Livewert"}
                  </small>
                </span>
                {includeSnifferRssi ? (
                  <DualRssiAssessment ccu={node.ccuRssi} sniffer={node.snifferRssi} compact />
                ) : (
                  <span className="single-rssi">
                    <small>Zentrale</small>
                    <RssiAssessment value={node.ccuRssi} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </details>
      )}

      {routingMapMode === "signals" && <div className="routing-display-filter">
        <div>
          <strong>Anzeige <InfoTooltip label="Ansicht wählen">Auffällig zeigt Empfänger, Router und Geräte mit Handlungs- oder Beobachtungsbedarf. Empfänger zeigt nur die Infrastruktur, Alle zeigt sämtliche Knoten.</InfoTooltip></strong>
        </div>
        <div role="group" aria-label="Umfang der Routing-Grafik">
          <button type="button" className={topologyFilter === "focus" ? "is-active" : ""} onClick={() => setTopologyFilter("focus")}>Auffällig <small>{focusCount}</small></button>
          <button type="button" className={topologyFilter === "infrastructure" ? "is-active" : ""} onClick={() => setTopologyFilter("infrastructure")}>Empfänger <small>{infrastructureCount}</small></button>
          <button type="button" className={topologyFilter === "all" ? "is-active" : ""} onClick={() => setTopologyFilter("all")}>Alle <small>{allDeviceCount}</small></button>
        </div>
        {hiddenGraphNodes > 0 && <small>{hiddenGraphNodes} ausgeblendet</small>}
      </div>}

      {routingMapMode === "paths" && (
        <div className={`routing-path-summary ${visibleEdges.length > 0 ? "has-paths" : ""}`}>
          <strong>{visibleEdges.length > 0 ? `${visibleEdges.length} Funkweg${visibleEdges.length === 1 ? "" : "e"} sind belegt` : "Noch keine Funkwege belegt"}</strong>
          <span>{visibleEdges.length > 0
            ? "Blaue Linien zeigen ausschließlich im Log nachgewiesene Zwischenempfänger. Geräte ohne Linie sind nicht offline – ihr tatsächlich verwendeter Empfänger ist nur noch unbekannt."
            : "Die CCU-Daten belegen Router- und Gateway-Rollen, liefern in dieser Installation aber keinen aktiven Gerätepfad. Das ist keine Aussage darüber, ob Routing verwendet wird. Die App zeigt deshalb keine geratenen Linien."}
          </span>
        </div>
      )}

      <div className="routing-topology-layout">
        <div className="routing-map-wrap">
          {routingMapMode === "signals" && measuredNodes.length > 0 && (
            <div className="routing-map-position-hint">
              <strong>Signalposition:</strong> Mitte = sehr gut, weiter außen = schwächer. Die Position zeigt die RSSI-Klasse des gewählten Messorts, nicht den echten Raumplan.
            </div>
          )}
          <svg className="routing-map" viewBox="0 0 1000 600" role="img" aria-label="Grafische Funk-Topologie mit Signalqualität, Warteschleife und belegten Wegen">
            <defs>
              <radialGradient id="routing-map-background" cx="50%" cy="48%" r="72%">
                <stop offset="0%" stopColor="#f5f9ff" />
                <stop offset="100%" stopColor="#ffffff" />
              </radialGradient>
              <marker id="routing-arrow-confirmed" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="strokeWidth">
                <path d="M 0 0 L 8 4 L 0 8 z" fill="#3478f6" />
              </marker>
            </defs>
            <rect className="routing-map-background" x="1" y="1" width="998" height="598" rx="20" />
            {routingMapMode === "paths" && visibleEdges.length === 0 && (
              <g className="routing-no-paths-panel" transform="translate(640 216)">
                <rect width="304" height="164" rx="16" />
                <text className="routing-no-paths-title" x="18" y="30">Aktive Wege nicht nachweisbar</text>
                <text x="18" y="57">{gateways.length} Gateway{gateways.length === 1 ? "" : "s"} und {routers.length} Router sind erkannt.</text>
                <text x="18" y="79">Die aktuelle CCU-Schnittstelle liefert aber</text>
                <text x="18" y="97">keinen belegbaren aktiven Gerätepfad.</text>
                <line x1="18" y1="114" x2="286" y2="114" />
                <text className="routing-no-paths-action" x="18" y="137">Für konkrete Maßnahmen nutze die</text>
                <text className="routing-no-paths-action" x="18" y="154">Signalverteilung und den DC-Analyzer.</text>
              </g>
            )}
            {routingMapMode === "signals" && measuredNodes.length > 0 && (
              <>
                <circle className="routing-zone-fill routing-zone-fill-weak" cx={center.x} cy={center.y} r="245" />
                <circle className="routing-zone-fill routing-zone-fill-medium" cx={center.x} cy={center.y} r="215" />
                <circle className="routing-zone-fill routing-zone-fill-good" cx={center.x} cy={center.y} r="180" />
                <circle className="routing-zone-fill routing-zone-fill-excellent" cx={center.x} cy={center.y} r="145" />
                <circle className="routing-orbit routing-orbit-excellent" cx={center.x} cy={center.y} r="145" />
                <circle className="routing-orbit routing-orbit-good" cx={center.x} cy={center.y} r="180" />
                <circle className="routing-orbit routing-orbit-medium" cx={center.x} cy={center.y} r="215" />
                <circle className="routing-orbit routing-orbit-weak" cx={center.x} cy={center.y} r="245" />
                <g className="routing-zone-guide" transform="translate(52 72)">
                  <rect width="174" height="100" rx="12" />
                  <text className="routing-zone-guide-title" x="14" y="21">Signalposition</text>
                  <text className="routing-zone-label excellent" x="14" y="41">innen · sehr gut</text>
                  <text className="routing-zone-label good" x="14" y="57">danach · gut</text>
                  <text className="routing-zone-label medium" x="14" y="73">weiter außen · beobachten</text>
                  <text className="routing-zone-label weak" x="14" y="89">äußerer Ring · schwach</text>
                </g>
              </>
            )}

            {routingMapMode === "signals" && waitingNodes.length > 0 && (
              <g className="routing-waiting-area">
                <rect x="720" y="92" width="238" height="104" rx="14" />
                <text className="routing-waiting-title" x="738" y="116">Warteschleife</text>
                <text className="routing-waiting-copy" x="738" y="132">{waitingNodes.length} ohne Messwert</text>
                {waitingPreviewNodes.map((node) => {
                  const position = waitingPositions.get(node.id);
                  if (!position) return null;
                  return (
                    <g
                      className={`routing-waiting-node ${selectedNode?.id === node.id ? "is-selected" : ""}`}
                      key={`waiting-${node.id}`}
                      transform={`translate(${position.x} ${position.y})`}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectNode(node.id)}
                      onMouseEnter={() => setHoveredNodeId(node.id)}
                      onMouseLeave={() => setHoveredNodeId("")}
                      onFocus={() => setHoveredNodeId(node.id)}
                      onBlur={() => setHoveredNodeId("")}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") onSelectNode(node.id);
                      }}
                    >
                      <circle r="9" />
                      <title>{`${node.name} · noch kein Messwert`}</title>
                    </g>
                  );
                })}
                {waitingNodes.length > waitingPreviewNodes.length && (
                  <text className="routing-waiting-more" x="940" y="180" textAnchor="end">+{waitingNodes.length - waitingPreviewNodes.length}</text>
                )}
              </g>
            )}

            {graphEdges.map((edge) => {
              const source = positions.get(edge.source);
              const target = positions.get(edge.target);
              if (!source || !target) return null;
              return (
                <line className="routing-edge is-confirmed" key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} markerEnd="url(#routing-arrow-confirmed)">
                  <title>{edge.evidence}</title>
                </line>
              );
            })}

            {graphNodes.map((node) => {
              const position = positions.get(node.id);
              if (!position) return null;
              const isSelected = selectedNode?.id === node.id;
              const rssi = nodeRssi(node);
              const waitingStart = waitingPositions.get(node.id);
              return (
                <g
                  className={`routing-node ${nodeClass(node)} ${isSelected ? "is-selected" : ""}`}
                  key={node.id}
                  transform={`translate(${position.x} ${position.y})`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectNode(node.id)}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId("")}
                  onFocus={() => setHoveredNodeId(node.id)}
                  onBlur={() => setHoveredNodeId("")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") onSelectNode(node.id);
                  }}
                >
                  {allowsMotion && arrivingNodeIds.has(node.id) && waitingStart && (
                    <animateTransform
                      attributeName="transform"
                      type="translate"
                      from={`${waitingStart.x} ${waitingStart.y}`}
                      to={`${position.x} ${position.y}`}
                      dur="650ms"
                      fill="remove"
                    />
                  )}
                  {routingMapMode === "signals" && rssiClass(rssi) === "weak" && <circle className="routing-weak-pulse" r={node.role === "router" ? 28 : 22} />}
                  {routingMapMode === "signals" && rssi !== undefined && (
                    <circle
                      className={`routing-signal-ring ${rssiClass(rssi)}`}
                      r={node.role === "router" ? 23 : 17}
                    />
                  )}
                  <circle r={node.role === "central" ? 31 : node.role === "gateway" ? 20 : node.role === "router" ? 18 : 12} />
                  {rssi !== undefined && node.role !== "central" && (
                    <circle className={`routing-status-dot ${rssiClass(rssi)}`} cx={node.role === "router" ? 15 : 11} cy={node.role === "router" ? -15 : -11} r="4" />
                  )}
                  <title>{`${node.name}${node.type ? ` · ${node.type}` : ""} · ${signalDetailForNode(node)}`}</title>
                  {node.role === "central" && (
                    <text className="routing-central-label" y="47" textAnchor="middle">{node.name}</text>
                  )}
                  {node.role === "gateway" && <text className="routing-node-icon" y="5" textAnchor="middle">G</text>}
                  {node.role === "router" && <text className="routing-node-icon" y="5" textAnchor="middle">R</text>}
                  {routingMapMode === "paths" && node.role !== "central" && (
                    <text className="routing-path-node-label" y={node.role === "gateway" ? 35 : node.role === "router" ? 33 : 27} textAnchor="middle">
                      {node.name.length > 24 ? `${node.name.slice(0, 23)}…` : node.name}
                    </text>
                  )}
                </g>
              );
            })}

            {hoveredNode && hoveredPosition && (
              <g className="routing-hover-label" transform={`translate(${hoverLabelX - 120} ${hoverLabelY})`} pointerEvents="none">
                <rect width="240" height="58" rx="10" />
                <text x="120" y="17" textAnchor="middle">{hoveredNode.name}</text>
                <text className="routing-hover-role" x="120" y="32" textAnchor="middle">{nodeRoleLabel(hoveredNode)}</text>
                <text className="routing-hover-signal" x="120" y="47" textAnchor="middle">
                  {signalDetailForNode(hoveredNode)}
                </text>
              </g>
            )}
          </svg>

          <div className="routing-legend">
            <span><i className="legend-dot is-central" /> Zentrale</span>
            <span><i className="legend-dot is-gateway" /> Funk-Gateway / Access Point</span>
            <span><i className="legend-dot is-router" /> bestätigter Router</span>
            <span><i className="legend-dot is-candidate" /> möglicher netzversorgter Router</span>
            {routingMapMode === "signals" && <><span><i className="legend-signal excellent" /> Signal sehr gut</span>
            <span><i className="legend-signal good" /> Signal gut</span>
            <span><i className="legend-signal medium" /> beobachten</span>
            <span><i className="legend-signal weak" /> schwach</span></>}
            <span><i className="legend-line is-confirmed" /> belegter Funkweg</span>
            {routingMapMode === "signals" && waitingNodes.length > 0 && <span><i className="legend-dot is-waiting" /> Warteschleife: kein Messwert</span>}
          </div>
        </div>

        <aside className="routing-node-detail">
          <small>Ausgewählter Knoten</small>
          <h5>{selectedNode?.name ?? "Keine Auswahl"}</h5>
          {selectedNode?.type && <p>{selectedNode.type}</p>}
          {selectedNode?.serial && <p>Seriennummer: {selectedNode.serial}</p>}
          {selectedNode?.role !== "central" && (
            <dl>
              <div><dt>Technologie</dt><dd>{selectedNode?.protocol === "hmip" ? "Homematic IP" : "Klassisches Homematic"}</dd></div>
              <div><dt>Rolle</dt><dd>{selectedNode?.role === "gateway" ? "Funk-Gateway / Access Point" : selectedNode?.role === "router" ? "HmIP-Router" : "Funkgerät"}</dd></div>
              {selectedNode?.protocol === "hmip" && selectedNode?.role !== "gateway" && (
                <>
                  <div><dt>Dient als Router</dt><dd>{selectedNode?.routerEnabled ? "Ja, belegt" : "Nicht belegt"}</dd></div>
                  <div><dt>Routing aktiv</dt><dd>{selectedNode?.routingEnabled ? "Ja" : "Nicht belegt"}</dd></div>
                  <div><dt>Multicast-Routing</dt><dd>{selectedNode?.multicastRouting ? "Ja" : "Nicht belegt"}</dd></div>
                </>
              )}
              <div><dt>Nächster Empfänger</dt><dd>{selectedReceiver?.name ?? "Noch nicht belegt"}</dd></div>
              <div>
                <dt>Signalwerte</dt>
                <dd>
                  {includeSnifferRssi ? (
                    <DualRssiAssessment ccu={selectedNode?.ccuRssi} sniffer={selectedNode?.snifferRssi} />
                  ) : (
                    <span className="single-rssi">
                      <small>Zentrale</small>
                      <RssiAssessment value={selectedNode?.ccuRssi} />
                    </span>
                  )}
                  {includeSnifferRssi && selectedNode?.rssiTelegrams !== undefined && <small>{selectedNode.rssiTelegrams} Sniffer-Telegramme</small>}
                  {selectedNode?.ccuRssiSource && <small>CCU-Wert verwendet: {selectedNode.ccuRssiSource}</small>}
                </dd>
              </div>
            </dl>
          )}
          <div className={`routing-node-advice ${rssiClass(selectedRssi) ?? "unknown"}`}>
            <strong>Einordnung</strong>
            <span>{selectedAdvice}</span>
          </div>
          {selectedNode?.evidence.length ? (
            <ul>{selectedNode.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
          ) : (
            <p className="muted">Für diesen Knoten liegt noch kein spezieller Routing-Beleg im aktuellen Log vor.</p>
          )}
        </aside>
      </div>

      {topology.metrics.confirmedRoutes === 0 && (
        <div className="routing-truth-note">
          <strong>{hasRoutingConfig ? "Router-Schalter gelesen – aktive Wege noch nicht belegt." : "Router noch nicht zuverlässig geprüft."}</strong>
          <span>
            {hasRoutingConfig
              ? "Die Karte erfindet keine Pfade. Betätige HmIP-Geräte und aktualisiere anschließend die Karte, damit passende HmIPServer-Zeilen erfasst werden können."
              : "Orange Punkte sind nur netzversorgte Kandidaten. Führe den aktualisierten Shell-Collector erneut auf der CCU aus; er liest die drei Routing-Schalter jetzt lokal und ausschließlich lesend aus."}
          </span>
        </div>
      )}

      <div className="routing-technology-note">
        <strong>{topologyScope === "hmip" ? "HmIP-Routing" : topologyScope === "bidcos" ? "Klassische Homematic-Funkabdeckung" : "Gemeinsame Übersicht, getrennte Funktechnik"}</strong>
        <span>
          {topologyScope === "hmip"
            ? "HmIP-Geräte können – sofern unterstützt und ausdrücklich konfiguriert – als Router arbeiten. HmIP-Access-Points werden dagegen als Gateways dargestellt."
            : topologyScope === "bidcos"
              ? "Homematic LAN-Gateways erweitern den BidCos-RF-Empfang, sind aber keine HmIP-Router. Solange kein konkreter Empfänger belegt ist, erfindet die Karte keine Gateway-Zuordnung."
              : "Die Gesamtansicht zeigt beide Funkwelten zusammen. HmIP-Routingpfade und klassische Homematic-Gateways bleiben fachlich getrennt."}
        </span>
      </div>
    </section>
  );
}
