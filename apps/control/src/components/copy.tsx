"use client";

import { useState } from "react";

async function write(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older mobile browsers and non-secure origins.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export function CopyButton({
  value,
  label = "Copy",
  className = "cf-copy",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");

  async function onClick() {
    const ok = await write(value);
    setState(ok ? "done" : "fail");
    window.setTimeout(() => setState("idle"), 1600);
  }

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      data-copied={state === "done" ? "1" : undefined}
      aria-live="polite"
      title={label}
    >
      {state === "done" ? "Copied" : state === "fail" ? "Select it" : label}
    </button>
  );
}

export interface CopyFieldProps {
  label: string;
  value: string;
  hint?: string;
}

/** One DNS value with its own copy control. */
export function CopyField({ label, value, hint }: CopyFieldProps) {
  return (
    <div className="copyfield">
      <span className="cf-label">{label}</span>
      <div className="cf-value">
        <code>{value}</code>
        <CopyButton value={value} />
      </div>
      {hint ? <span className="fine">{hint}</span> : null}
    </div>
  );
}

/** The whole record as one paste-ready block. */
export function CopyAll({ value }: { value: string }) {
  return (
    <div className="copyall">
      <CopyButton value={value} label="Copy the whole record" className="btn ghost sm" />
    </div>
  );
}
