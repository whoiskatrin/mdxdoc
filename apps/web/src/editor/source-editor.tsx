import * as React from "react";
import * as Y from "yjs";
import { MdxdocClient } from "@mdxdoc/sdk-js";
import { Button } from "../components/ui/button";

const client = new MdxdocClient({ apiUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8787" });
type Mode = "editing" | "suggesting";

export function SourceEditor({ documentId, ydoc }: { documentId: string; ydoc: Y.Doc }) {
  const [source, setSource] = React.useState("# Untitled\n");
  const [savedSource, setSavedSource] = React.useState("# Untitled\n");
  const [version, setVersion] = React.useState(0);
  const [mode, setMode] = React.useState<Mode>("editing");
  const [status, setStatus] = React.useState("loading source…");
  const ytext = React.useMemo(() => ydoc.getText(`source:${documentId}`), [ydoc, documentId]);
  const suppressYjsWrite = React.useRef(false);
  const modeRef = React.useRef<Mode>(mode);
  React.useEffect(() => { modeRef.current = mode; }, [mode]);

  function replaceSharedText(next: string) {
    ydoc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, next);
    });
  }

  async function loadSource(forceSharedReset = false) {
    if (!documentId || documentId === "demo") return;
    const res = await client.docs.source(documentId);
    setSavedSource(res.source);
    setVersion(res.version);
    setStatus(`version ${res.version}`);
    if (forceSharedReset || ytext.length === 0) {
      replaceSharedText(res.source);
      setSource(res.source);
    } else {
      setSource(ytext.toString());
    }
  }

  React.useEffect(() => {
    const observer = () => {
      if (modeRef.current !== "editing") return;
      const next = ytext.toString();
      suppressYjsWrite.current = true;
      setSource(next);
      window.queueMicrotask(() => { suppressYjsWrite.current = false; });
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [ytext]);

  React.useEffect(() => {
    loadSource().catch((err) => setStatus(err.message));
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ documentId: string }>).detail;
      if (detail?.documentId === documentId) void loadSource(true).catch((err) => setStatus(err.message));
    };
    window.addEventListener("mdxdoc:source-updated", listener);
    return () => window.removeEventListener("mdxdoc:source-updated", listener);
  }, [documentId, ytext]);

  function updateSource(next: string) {
    setSource(next);
    if (mode === "editing" && !suppressYjsWrite.current) replaceSharedText(next);
  }

  async function applyChanges() {
    const liveSource = mode === "editing" ? ytext.toString() : source;
    setStatus("applying…");
    const res = await client.docs.putSource(documentId, { baseVersion: version, source: liveSource });
    setVersion(res.version);
    setSavedSource(res.source);
    replaceSharedText(res.source);
    setStatus(`applied version ${res.version}`);
    window.dispatchEvent(new CustomEvent("mdxdoc:source-updated", { detail: { documentId } }));
  }

  async function proposeSuggestion() {
    setStatus("saving suggestion…");
    const diff = sourceRangeDiff(savedSource, source);
    await client.docs.createSuggestion(documentId, {
      type: diff.type,
      anchor: { kind: "source_range", start: diff.start, end: diff.end, quote: diff.before || "insertion" },
      before: diff.before,
      after: diff.after,
      baseVersion: version
    });
    setSource(savedSource);
    setMode("editing");
    setStatus(`suggestion proposed on version ${version}`);
    window.dispatchEvent(new CustomEvent("mdxdoc:suggestions-updated", { detail: { documentId } }));
  }

  function publishSelection(element: HTMLTextAreaElement) {
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const quote = source.slice(start, end);
    window.dispatchEvent(new CustomEvent("mdxdoc:source-selection", { detail: { documentId, start, end, quote } }));
  }

  const changed = source !== savedSource;
  const disabled = documentId === "demo";

  return <div className="source-editor">
    <div className="source-toolbar">
      <div><strong>{mode === "editing" ? "Markdown editor" : "Suggesting changes"}</strong><span> · {mode === "editing" ? `${status} · live draft sync on` : status}</span></div>
      <div className="source-actions">
        <div className="mode-switch"><button className={mode === "editing" ? "active" : ""} onClick={() => { setMode("editing"); setSource(ytext.toString() || savedSource); }}>Editing</button><button className={mode === "suggesting" ? "active" : ""} onClick={() => { setMode("suggesting"); setSource(savedSource); }}>Suggesting</button></div>
        {mode === "editing" ? <Button onClick={applyChanges} disabled={disabled || !changed}>Apply changes</Button> : <><Button variant="outline" onClick={() => { setSource(savedSource); setMode("editing"); }} disabled={disabled}>Discard</Button><Button onClick={proposeSuggestion} disabled={disabled || !changed}>Propose suggestion</Button></>}
      </div>
    </div>
    {mode === "suggesting" && <div className="suggesting-banner">Suggesting mode: edit the Markdown below. Your changes will not affect the document until someone accepts the suggestion.</div>}
    <textarea className="source-textarea" spellCheck={false} value={source} onChange={(e) => updateSource(e.target.value)} onSelect={(event) => publishSelection(event.currentTarget)} onKeyUp={(event) => publishSelection(event.currentTarget)} onMouseUp={(event) => publishSelection(event.currentTarget)} />
  </div>;
}

function sourceRangeDiff(before: string, after: string) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return { type: "replace_source_range", start, end: beforeEnd, before: before.slice(start, beforeEnd), after: after.slice(start, afterEnd) };
}
