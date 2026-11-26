"use client";

import { useEffect, useState, type ReactNode } from "react";

interface Props {
  title: string;
  /** Shown next to the title, so the closed section still says something. */
  hint?: string;
  /** Where this browser remembers whether the section is open. */
  storageKey: string;
  children: ReactNode;
}

/** A section you can fold away. It starts closed and remembers your choice. */
export function Collapsible({ title, hint, storageKey, children }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(storageKey) === "open");
    } catch {
      // Storage unavailable: stay closed.
    }
  }, [storageKey]);

  return (
    <details
      className="fold"
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        setOpen(now);
        try {
          localStorage.setItem(storageKey, now ? "open" : "closed");
        } catch {
          // Not remembered; the section still opens and closes.
        }
      }}
    >
      <summary>
        <h2>{title}</h2>
        {hint && <span className="small muted">{hint}</span>}
        <span className="small muted fold-action">{open ? "Hide" : "Show"}</span>
      </summary>
      {children}
    </details>
  );
}
