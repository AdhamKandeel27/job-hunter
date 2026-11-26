"use client";

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { saveDoc, type DocField } from "./actions";
import { CopyButton } from "./copy-button";

/**
 * An editable résumé or cover note. Copy uses what is in the box; Download PDF saves
 * any unsaved changes first, because the PDF is built from the saved text.
 */
export function DocEditor({
  id,
  field,
  title,
  initial,
  pdf,
}: {
  id: number;
  field: DocField;
  title: string;
  initial: string;
  pdf: string;
}) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  const dirty = text !== saved;

  // Grow the box to fit its text instead of scrolling inside it.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [text]);

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save(): Promise<boolean> {
    if (!text.trim()) {
      setError("The text is empty, so it was not saved.");
      return false;
    }
    try {
      await saveDoc(id, field, text);
      setSaved(text);
      setError(null);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
      return true;
    } catch {
      setError("Could not save. Is the database running?");
      return false;
    }
  }

  function download() {
    start(async () => {
      if (dirty && !(await save())) return;
      const a = document.createElement("a");
      a.href = pdf;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  return (
    <>
      <div className="section-head">
        <h2>{title}</h2>
        <div className="doc-actions">
          {dirty && <span className="small muted">Unsaved changes</span>}
          {dirty && (
            <button type="button" className="quiet" disabled={pending} onClick={() => { setText(saved); setError(null); }}>
              Undo changes
            </button>
          )}
          <button
            type="button"
            className={justSaved ? "success on" : ""}
            disabled={pending || (!dirty && !justSaved)}
            onClick={() => start(async () => { await save(); })}
          >
            {justSaved ? "Saved" : "Save"}
          </button>
          <button type="button" className="secondary" disabled={pending} onClick={download}>
            {pending ? "Working…" : "Download PDF"}
          </button>
          <CopyButton text={text} />
        </div>
      </div>
      {error && <div className="notice error"><b>{error}</b></div>}
      <textarea
        ref={box}
        className="doc"
        value={text}
        spellCheck
        aria-label={title}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            if (dirty) start(async () => { await save(); });
          }
        }}
      />
    </>
  );
}
