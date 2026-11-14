import { useEffect, useRef, useState } from "react";

/** Both labels share one grid cell, so width and text position never change. */
export function CopyButton({
  text,
  announce,
}: {
  text: string;
  announce: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    clearTimeout(timer.current);
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      announce("Copied the React code to the clipboard.");
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
      announce("Copy failed: select the code and copy it manually.");
    }
  }

  return (
    <button
      type="button"
      className="btn btn--primary copy"
      data-copied={copied}
      onClick={copy}
    >
      <span className="copy__idle" aria-hidden={copied}>
        Copy code
      </span>
      <span className="copy__done" aria-hidden={!copied}>
        ✓ Copied
      </span>
    </button>
  );
}
