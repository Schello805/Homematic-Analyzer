import { useEffect, useRef, useState } from "react";
import { DualRssiAssessment, RssiAssessment, rssiClass } from "../radio/RssiAssessment";
import "./SignalQualityDeviceList.css";

export type SignalDevice = {
  key: string;
  name: string;
  type?: string;
  serial?: string;
  address?: string;
  ccuRssi?: number;
  snifferRssi?: number;
  telegrams?: number;
};

export type SignalReceiverOption = {
  id: string;
  name: string;
  type?: string;
  protocol: "hmip" | "bidcos";
  role: "gateway" | "router" | "candidate";
  routerEnabled: boolean;
  routingEnabled: boolean;
};

type SignalSource = "ccu" | "both";

function isAttentionValue(value?: number) {
  const signalClass = rssiClass(value);
  return signalClass === "medium" || signalClass === "weak";
}

function isHmIpDevice(device: SignalDevice) {
  return /^HmIP/i.test(device.type ?? "") || /^00/i.test(device.serial ?? "");
}

function normalizeDeviceName(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(/[ä]/g, "ae")
    .replace(/[ö]/g, "oe")
    .replace(/[ü]/g, "ue")
    .replace(/[ß]/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function receiverStatus(receiver: SignalReceiverOption) {
  if (receiver.role === "gateway") return "Zusätzlicher Funkempfänger";
  if (receiver.routerEnabled && receiver.routingEnabled) return "Als Router und Routing aktiv belegt";
  if (receiver.routerEnabled) return "Router aktiv, Routing noch nicht belegt";
  return "Möglicher netzversorgter Router-Kandidat";
}

export function SignalQualityDeviceList({ devices, source, onSourceChange, receiverOptions, focusDeviceName }: {
  devices: SignalDevice[];
  source: SignalSource;
  onSourceChange: (source: SignalSource) => void;
  receiverOptions: SignalReceiverOption[];
  focusDeviceName?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const improvementPlanRef = useRef<HTMLElement>(null);
  const sourceDevices = devices.filter((device) => source === "both"
    ? device.ccuRssi !== undefined || device.snifferRssi !== undefined
    : device.ccuRssi !== undefined);
  const attentionDevices = sourceDevices.filter((device) => source === "both"
    ? isAttentionValue(device.ccuRssi) || isAttentionValue(device.snifferRssi)
    : isAttentionValue(device.ccuRssi));
  const visibleDevices = (showAll ? sourceDevices : attentionDevices)
    .filter((device) => {
      const query = normalizeDeviceName(searchQuery);
      if (!query) return true;
      return normalizeDeviceName(`${device.name} ${device.type ?? ""} ${device.serial ?? ""} ${device.address ?? ""}`).includes(query);
    })
    .sort((left, right) => {
    const leftValue = source === "both" ? Math.min(left.ccuRssi ?? 99, left.snifferRssi ?? 99) : left.ccuRssi ?? 99;
    const rightValue = source === "both" ? Math.min(right.ccuRssi ?? 99, right.snifferRssi ?? 99) : right.ccuRssi ?? 99;
    return leftValue - rightValue;
  });
  const selectedDevice = sourceDevices.find((device) => device.key === selectedKey);
  const relevantReceivers = selectedDevice
    ? receiverOptions.filter((receiver) => isHmIpDevice(selectedDevice) ? receiver.protocol === "hmip" : receiver.protocol === "bidcos")
    : [];
  const existingReceivers = relevantReceivers.filter((receiver) => receiver.role === "gateway" || (receiver.routerEnabled && receiver.routingEnabled));
  const actionableReceivers = relevantReceivers.filter((receiver) => !existingReceivers.some((existing) => existing.id === receiver.id));

  useEffect(() => {
    if (!focusDeviceName) return;
    const normalizedFocus = normalizeDeviceName(focusDeviceName);
    const focusedDevice = devices.find((device) => normalizeDeviceName(device.name) === normalizedFocus && (source === "both"
      ? device.ccuRssi !== undefined || device.snifferRssi !== undefined
      : device.ccuRssi !== undefined));
    if (!focusedDevice) return;
    setShowAll(false);
    setSearchQuery(focusedDevice.name);
    setSelectedKey(focusedDevice.key);
  }, [devices, focusDeviceName, source]);

  useEffect(() => {
    if (!selectedKey) return;
    const animationFrame = window.requestAnimationFrame(() => {
      improvementPlanRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [selectedKey]);

  return (
    <>
      <div className="signal-source-switch" role="group" aria-label="Signalquelle auswählen">
        <button type="button" className={source === "ccu" ? "is-active" : ""} onClick={() => { onSourceChange("ccu"); setSelectedKey(""); setSearchQuery(""); }}>Ohne Snifferwerte <small>{devices.filter((device) => device.ccuRssi !== undefined).length}</small></button>
        <button type="button" className={source === "both" ? "is-active" : ""} onClick={() => { onSourceChange("both"); setSelectedKey(""); setSearchQuery(""); }}>Mit Snifferwerten <small>{devices.filter((device) => device.ccuRssi !== undefined || device.snifferRssi !== undefined).length}</small></button>
      </div>
      <p className="signal-source-hint">{source === "both" ? "Zeigt Zentralenwerte plus vorhandene Snifferwerte. Der Sniffer ist eine zweite Messposition und kann vom Zentralenwert deutlich abweichen." : "Zeigt nur RSSI-Werte, die die Zentrale/XML-API meldet. Snifferwerte werden in dieser Ansicht bewusst ausgeblendet."}</p>
      <div className="signal-list-toolbar">
        <strong>{attentionDevices.length} Geräte brauchen Aufmerksamkeit</strong>
        <button type="button" className="light-button" onClick={() => { setShowAll((current) => !current); setSelectedKey(""); }}>{showAll ? "Nur auffällige zeigen" : `Alle ${sourceDevices.length} zeigen`}</button>
      </div>
      <label className="signal-device-search">
        <span>Gerät suchen</span>
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => { setSearchQuery(event.target.value); setSelectedKey(""); }}
          placeholder="Name, Typ oder Seriennummer"
        />
        {searchQuery && <button type="button" onClick={() => { setSearchQuery(""); setSelectedKey(""); }}>Suche löschen</button>}
      </label>
      {selectedDevice && (
        <section ref={improvementPlanRef} className="signal-improvement-plan" tabIndex={-1}>
          <p className="eyebrow">Nächster Schritt für {selectedDevice.name}</p>
          <h3>Empfang verbessern, ohne das Gerät zu versetzen</h3>
          <p>Die Zentrale empfängt dieses Gerät schwach. Das kann Telegramme verzögern oder störanfälliger machen. Die App kennt jedoch keine Raumpositionen und kann deshalb keine echte Nähe behaupten.</p>
          {existingReceivers.length > 0 && <>
            <strong>Bereits vorhanden – kein neuer Vorschlag:</strong>
            <ul>{existingReceivers.slice(0, 4).map((receiver) => <li key={receiver.id}><b>{receiver.name}</b>{receiver.type ? ` (${receiver.type})` : ""} – {receiverStatus(receiver)}. Prüfe nur den Standort, falls dieser Empfänger nicht günstig liegt.</li>)}</ul>
          </>}
          {actionableReceivers.length > 0 ? <>
            <strong>Mögliche zusätzliche Option – nur prüfen, wenn sie räumlich zwischen Zentrale und Gerät liegt:</strong>
            <ul>{actionableReceivers.slice(0, 6).map((receiver) => <li key={receiver.id}><b>{receiver.name}</b>{receiver.type ? ` (${receiver.type})` : ""} – {receiverStatus(receiver)}.</li>)}</ul>
          </> : !existingReceivers.length ? <p>Im aktuellen Snapshot ist kein passender vorhandener Empfänger oder Router-Kandidat belegt. Prüfe einen zusätzlichen, zur Funktechnik passenden Empfänger.</p> : <p>Weitere passende Router-Kandidaten sind aktuell nicht belegt. Ein bestehender Empfänger hilft nur, wenn er räumlich günstig positioniert ist.</p>}
          {isHmIpDevice(selectedDevice) ? <p><b>Für Homematic IP:</b> „Gerät dient als Router“ beschreibt die Router-Fähigkeit. „Routing aktiv“ erlaubt die Nutzung für Weiterleitungen. Beides ist nicht dasselbe. Änderungen nur in der CCU-WebUI und nur an unterstützten, netzversorgten Geräten vornehmen.</p> : <p><b>Für klassisches Homematic:</b> Ein LAN-Gateway ist ein zusätzlicher Funkempfänger, kein HmIP-Router. Es muss am passenden Standort stehen; eine automatische Zuordnung zu diesem Gerät ist ohne Routing-Beleg nicht möglich.</p>}
        </section>
      )}
      <div className="action-device-list">
        {visibleDevices.map((device) => (
          <article key={device.key} className={selectedKey === device.key ? "is-selected" : ""}>
            <div><strong>{device.name}</strong><span>{device.type ?? device.serial ?? device.address ?? device.key}</span></div>
            {source === "both" ? <DualRssiAssessment ccu={device.ccuRssi} sniffer={device.snifferRssi} /> : <span className="single-rssi"><small>Zentrale</small><RssiAssessment value={device.ccuRssi} /></span>}
            {source === "both" && device.telegrams !== undefined ? <small className={device.telegrams >= 3 ? "measurement-good" : "measurement-provisional"}>{device.telegrams} Telegramm{device.telegrams === 1 ? "" : "e"} · {device.telegrams >= 3 ? "belastbar" : "vorläufig"}</small> : <small className="measurement-central">Zentralenwert</small>}
            {!showAll && <button type="button" className="signal-improve-button" onClick={() => setSelectedKey((current) => current === device.key ? "" : device.key)}>Empfang verbessern</button>}
          </article>
        ))}
        {visibleDevices.length === 0 && <div className="modal-empty"><strong>{showAll ? "Noch keine passenden RSSI-Gerätedaten" : "Keine auffälligen Signalwerte"}</strong><span>{showAll ? "Analyse automatisch aktualisieren lassen und prüfen, ob die XML-API RSSI-Werte der Zentrale liefert." : "Die vorhandenen Werte liegen im guten Bereich. Über „Alle“ kannst du sie trotzdem ansehen."}</span></div>}
      </div>
    </>
  );
}
