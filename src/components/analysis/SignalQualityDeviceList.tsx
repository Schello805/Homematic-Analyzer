import { useEffect, useRef, useState } from "react";
import { DualRssiAssessment, RssiAssessment, rssiClass } from "../radio/RssiAssessment";
import { InfoTooltip } from "../ui/InfoTooltip";
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
  const [showReceiverOptions, setShowReceiverOptions] = useState(false);
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
    setShowReceiverOptions(false);
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
      <InfoTooltip label="Messquelle erklären" className="signal-source-tooltip">
        {source === "both"
          ? "Zeigt Zentralenwerte plus vorhandene Snifferwerte. Der Sniffer ist eine zweite Messposition und kann vom Zentralenwert deutlich abweichen."
          : "Zeigt nur RSSI-Werte, die die Zentrale/XML-API meldet. Snifferwerte werden in dieser Ansicht bewusst ausgeblendet."}
      </InfoTooltip>
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
          <h3>Empfang gezielt verbessern</h3>
          <p>Die Zentrale empfängt dieses Gerät schwach. Die App kennt keine Raumpositionen und kann daher keinen bestimmten Router als „nächsten“ Empfänger behaupten.</p>
          <ol className="signal-improvement-steps">
            <li><strong>Vor Ort prüfen:</strong> Liegt ein vorhandenes Gateway oder ein netzversorgtes HmIP-Gerät ungefähr zwischen Zentrale und diesem Gerät?</li>
            <li><strong>Nur bei HmIP:</strong> Prüfe bei einem passenden, netzversorgten Gerät in der CCU-WebUI, ob „Gerät dient als Router“ und „Routing aktiv“ gesetzt sind.</li>
            <li><strong>Danach beobachten:</strong> Gerät mehrfach auslösen und prüfen, ob sich RSSI und Erreichbarkeit in der nächsten Analyse verbessern.</li>
          </ol>
          {isHmIpDevice(selectedDevice)
            ? <p className="signal-improvement-note"><b>Hinweis für Homematic IP:</b> Router-Fähigkeit und „Routing aktiv“ sind unterschiedliche Schalter. Ändere nur unterstützte, netzversorgte Geräte.</p>
            : <p className="signal-improvement-note"><b>Hinweis für klassisches Homematic:</b> Ein LAN-Gateway ist ein zusätzlicher Funkempfänger, kein HmIP-Router.</p>}
          {(existingReceivers.length > 0 || actionableReceivers.length > 0) && (
            <details className="signal-receiver-options" open={showReceiverOptions} onToggle={(event) => setShowReceiverOptions(event.currentTarget.open)}>
              <summary>Vorhandene Optionen ansehen ({existingReceivers.length} aktiv, {actionableReceivers.length} Kandidaten)</summary>
              <p>Diese Liste ist keine Orts- oder Routing-Zuordnung. Berücksichtige nur Geräte, die räumlich sinnvoll liegen.</p>
              {existingReceivers.length > 0 && <>
                <strong>Bereits aktiv</strong>
                <ul>{existingReceivers.slice(0, 4).map((receiver) => <li key={receiver.id}><b>{receiver.name}</b>{receiver.type ? ` (${receiver.type})` : ""} – {receiverStatus(receiver)}</li>)}</ul>
              </>}
              {actionableReceivers.length > 0 && <>
                <strong>Weitere Kandidaten</strong>
                <ul>{actionableReceivers.slice(0, 6).map((receiver) => <li key={receiver.id}><b>{receiver.name}</b>{receiver.type ? ` (${receiver.type})` : ""} – {receiverStatus(receiver)}</li>)}</ul>
              </>}
            </details>
          )}
        </section>
      )}
      <div className="action-device-list">
        {visibleDevices.map((device) => (
          <article key={device.key} className={selectedKey === device.key ? "is-selected" : ""}>
            <div><strong>{device.name}</strong><span>{device.type ?? device.serial ?? device.address ?? device.key}</span></div>
            {source === "both" ? <DualRssiAssessment ccu={device.ccuRssi} sniffer={device.snifferRssi} /> : <span className="single-rssi"><small>Zentrale</small><RssiAssessment value={device.ccuRssi} /></span>}
            {source === "both" && device.telegrams !== undefined ? <small className={device.telegrams >= 3 ? "measurement-good" : "measurement-provisional"}>{device.telegrams} Telegramm{device.telegrams === 1 ? "" : "e"} · {device.telegrams >= 3 ? "belastbar" : "vorläufig"}</small> : <small className="measurement-central">Zentralenwert</small>}
            {!showAll && <button type="button" className="signal-improve-button" onClick={() => { setShowReceiverOptions(false); setSelectedKey((current) => current === device.key ? "" : device.key); }}>Empfang verbessern</button>}
          </article>
        ))}
        {visibleDevices.length === 0 && <div className="modal-empty"><strong>{showAll ? "Noch keine passenden RSSI-Gerätedaten" : "Keine auffälligen Signalwerte"}</strong><span>{showAll ? "Analyse automatisch aktualisieren lassen und prüfen, ob die XML-API RSSI-Werte der Zentrale liefert." : "Die vorhandenen Werte liegen im guten Bereich. Über „Alle“ kannst du sie trotzdem ansehen."}</span></div>}
      </div>
    </>
  );
}
