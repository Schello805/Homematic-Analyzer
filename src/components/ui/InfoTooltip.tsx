import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type InfoTooltipProps = {
  label: string;
  children: ReactNode;
  className?: string;
};

export function InfoTooltip({ label, children, className = "" }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("touchstart", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("touchstart", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <span className={`info-tooltip ${open ? "is-open" : ""} ${className}`} ref={containerRef}>
      <button
        type="button"
        className="info-tooltip__trigger"
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">ⓘ</span>
        {label}
      </button>
      <span id={tooltipId} className="info-tooltip__content" role="tooltip">
        {children}
      </span>
    </span>
  );
}
