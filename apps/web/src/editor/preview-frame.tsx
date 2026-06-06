import * as React from "react";
import { MdxdocClient } from "@mdxdoc/sdk-js";

const client = new MdxdocClient({ apiUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8787" });
const emptyPreview = "<!doctype html><html><head><meta charset='utf-8'><style>html,body{margin:0;background:white;}</style></head><body></body></html>";
const previewCache = new Map<string, string>();

export function PreviewFrame({ documentId }: { documentId: string }) {
  const [html, setHtml] = React.useState(() => previewCache.get(documentId) ?? emptyPreview);

  React.useEffect(() => {
    let cancelled = false;
    if (!documentId || documentId === "demo") {
      setHtml(emptyPreview);
      return;
    }
    const cached = previewCache.get(documentId);
    if (cached) setHtml(cached);
    else setHtml(emptyPreview);
    client.docs.preview(documentId)
      .then((res) => {
        const next = (res as { html: string }).html || emptyPreview;
        previewCache.set(documentId, next);
        if (!cancelled) setHtml(next);
      })
      .catch((err) => {
        const errorHtml = `<!doctype html><html><body style="margin:0;padding:32px;font:14px ui-monospace;color:#b3261e;background:#fff"><pre>${escapeHtml(err.message)}</pre></body></html>`;
        if (!cancelled) setHtml(errorHtml);
      });
    return () => { cancelled = true; };
  }, [documentId]);

  return <iframe className="preview-frame" title="MDX preview" sandbox="" srcDoc={html} />;
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[ch]!);
}
