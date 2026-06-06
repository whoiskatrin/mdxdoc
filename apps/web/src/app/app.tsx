import * as React from "react";
import * as Y from "yjs";
import YProvider from "y-partyserver/provider";
import { MdxdocClient } from "@mdxdoc/sdk-js";
import { FilePlus, MoreHorizontal, Search } from "lucide-react";
import { toast, Toaster } from "sonner";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { PreviewFrame } from "../editor/preview-frame";
import { SourceEditor } from "../editor/source-editor";
type Surface = "source" | "preview";
type Workspace = { id: string; name: string; slug?: string };
type DocListItem = {
  id: string;
  workspaceId: string;
  title: string;
  format: "md" | "mdx";
  updatedAt?: string;
  currentVersion?: number;
};
type OpenDocument = DocListItem & { artifactRepo?: string };

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
const client = new MdxdocClient({ apiUrl });

export function App() {
  const [surface, setSurface] = React.useState<Surface>("source");
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([]);
  const [docs, setDocs] = React.useState<DocListItem[]>([]);
  const [document, setDocument] = React.useState<OpenDocument | null>(null);
  const [room, setRoom] = React.useState("");
  const [status, setStatus] = React.useState("Loading documents…");
  const [busy, setBusy] = React.useState(false);
  const [renameTarget, setRenameTarget] = React.useState<DocListItem | OpenDocument | null>(null);
  const [renameTitle, setRenameTitle] = React.useState("");
  const [removeTarget, setRemoveTarget] = React.useState<DocListItem | null>(null);
  const [bulkRemoveOpen, setBulkRemoveOpen] = React.useState(false);
  const [selectedDocIds, setSelectedDocIds] = React.useState<Set<string>>(() => new Set());
  const [commandOpen, setCommandOpen] = React.useState(false);
  const openRequestId = React.useRef(0);
  const ydoc = React.useMemo(() => new Y.Doc(), []);

  React.useEffect(() => {
    void refreshDocuments();
    const sharedDoc = new URLSearchParams(window.location.search).get("doc");
    if (sharedDoc) void openDocument(sharedDoc);
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function refreshDocuments() {
    setBusy(true);
    setStatus("Loading documents…");
    try {
      const workspaceRes = await client.workspaces.list() as { items: Record<string, unknown>[] };
      const nextWorkspaces = workspaceRes.items.map(toWorkspace);
      setWorkspaces(nextWorkspaces);
      const nested = await Promise.all(nextWorkspaces.map(async (workspace) => {
        const res = await client.docs.list(workspace.id) as { items: Record<string, unknown>[] };
        return res.items.map((doc) => toDocListItem(doc, workspace.id));
      }));
      const nextDocs = nested.flat().sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
      setDocs(nextDocs);
      setSelectedDocIds((current) => new Set([...current].filter((id) => nextDocs.some((doc) => doc.id === id))));
      setStatus(nextDocs.length ? `${nextDocs.length} document${nextDocs.length === 1 ? "" : "s"}` : "No documents yet. Create your first MDX doc.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load documents");
    } finally {
      setBusy(false);
    }
  }

  async function ensureWorkspace() {
    if (workspaces[0]) return workspaces[0];
    const created = await client.workspaces.create({ name: "My Workspace", slug: `workspace-${Date.now()}` }) as Record<string, unknown>;
    const workspace = toWorkspace(created);
    setWorkspaces([workspace]);
    return workspace;
  }

  async function createDocument() {
    setBusy(true);
    setStatus("Creating document…");
    try {
      const workspace = await ensureWorkspace();
      const created = await client.docs.create(workspace.id, {
        title: "Untitled document",
        format: "mdx",
        source: "# Untitled document\n\nStart writing here.\n\n## Notes\n\n- This is raw Markdown/MDX.\n- Switch to Preview to see the rendered document.\n"
      }) as Record<string, unknown>;
      const item = toDocListItem(created, workspace.id);
      setDocs((current) => [item, ...current.filter((doc) => doc.id !== item.id)]);
      await openDocument(item.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not create document");
    } finally {
      setBusy(false);
    }
  }

  async function openDocument(documentId: string) {
    const requestId = ++openRequestId.current;
    setBusy(true);
    setStatus("Opening document…");
    try {
      const [doc, session] = await Promise.all([
        client.docs.get(documentId) as Promise<Record<string, unknown>>,
        client.docs.session(documentId)
      ]);
      if (requestId !== openRequestId.current) return;
      const opened = toOpenDocument(doc);
      setDocument(opened);
      setRoom(session.room);
      window.history.replaceState(null, "", `?doc=${encodeURIComponent(opened.id)}`);
      setSurface("source");
      setStatus("Collaboration ready");
    } catch (error) {
      if (requestId === openRequestId.current) setStatus(error instanceof Error ? error.message : "Could not open document");
    } finally {
      if (requestId === openRequestId.current) setBusy(false);
    }
  }

  function requestRename(target: DocListItem | OpenDocument) {
    setRenameTarget(target);
    setRenameTitle(target.title);
  }

  async function submitRename() {
    const target = renameTarget;
    const title = renameTitle.trim();
    if (!target || !title || title === target.title) { setRenameTarget(null); return; }
    const previousDocs = docs;
    setRenameTarget(null);
    setDocs((current) => current.map((doc) => doc.id === target.id ? { ...doc, title } : doc));
    setDocument((current) => current?.id === target.id ? { ...current, title } : current);
    toast.success("Document renamed");
    try {
      const updated = await client.docs.update(target.id, { title }) as Record<string, unknown>;
      const item = toDocListItem(updated, String(updated.workspace_id ?? updated.workspaceId ?? ""));
      setDocs((current) => current.map((doc) => doc.id === target.id ? { ...doc, title: item.title } : doc));
      setDocument((current) => current?.id === target.id ? { ...current, title: item.title } : current);
    } catch (error) {
      setDocs(previousDocs);
      setStatus(error instanceof Error ? error.message : "Could not rename document");
      toast.error(error instanceof Error ? error.message : "Could not rename document");
    }
  }

  async function removeDocument(documentId: string) {
    const previousDocs = docs;
    const nextDocs = docs.filter((doc) => doc.id !== documentId);
    setRemoveTarget(null);
    setDocs(nextDocs);
    setSelectedDocIds((current) => { const next = new Set(current); next.delete(documentId); return next; });
    setStatus(nextDocs.length ? `${nextDocs.length} document${nextDocs.length === 1 ? "" : "s"}` : "No documents yet. Create your first MDX doc.");
    toast.success("Document removed");
    void client.docs.delete(documentId).catch((error) => {
      setDocs(previousDocs);
      setStatus(error instanceof Error ? error.message : "Could not remove document");
      toast.error(error instanceof Error ? error.message : "Could not remove document");
    });
  }

  function toggleDocSelection(documentId: string) {
    setSelectedDocIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  }

  function toggleAllDocuments() {
    setSelectedDocIds((current) => current.size === docs.length ? new Set() : new Set(docs.map((doc) => doc.id)));
  }

  function removeSelectedDocuments() {
    const ids = selectedDocIds;
    if (!ids.size) return;
    const previousDocs = docs;
    const nextDocs = docs.filter((doc) => !ids.has(doc.id));
    setBulkRemoveOpen(false);
    setDocs(nextDocs);
    setSelectedDocIds(new Set());
    setStatus(nextDocs.length ? `${nextDocs.length} document${nextDocs.length === 1 ? "" : "s"}` : "No documents yet. Create your first MDX doc.");
    toast.success(`${ids.size} document${ids.size === 1 ? "" : "s"} removed`);
    void Promise.all([...ids].map((id) => client.docs.delete(id))).catch((error) => {
      setDocs(previousDocs);
      setSelectedDocIds(new Set(ids));
      setStatus(error instanceof Error ? error.message : "Could not remove selected documents");
      toast.error(error instanceof Error ? error.message : "Could not remove selected documents");
    });
  }

  function closeDocument() {
    openRequestId.current += 1;
    setDocument(null);
    setRoom("");
    window.history.replaceState(null, "", window.location.pathname);
    setStatus(docs.length ? `${docs.length} document${docs.length === 1 ? "" : "s"}` : "No documents yet. Create your first MDX doc.");
  }

  const content = !document
    ? <Dashboard docs={docs} selectedDocIds={selectedDocIds} status={status} busy={busy} onRefresh={refreshDocuments} onCreate={createDocument} onOpen={openDocument} onRename={requestRename} onRemove={setRemoveTarget} onToggleSelect={toggleDocSelection} onToggleAll={toggleAllDocuments} onRemoveSelected={() => setBulkRemoveOpen(true)} />
    : <EditorApp document={document} surface={surface} status={status} room={room} ydoc={ydoc} onSurface={setSurface} onRename={requestRename} onBack={closeDocument} />;

  return <>{content}<Toaster richColors position="bottom-right" /><CommandPalette open={commandOpen} docs={docs} hasDocument={Boolean(document)} onOpenChange={setCommandOpen} onCreate={createDocument} onRefresh={refreshDocuments} onBack={closeDocument} onOpenDoc={openDocument} /><RenameDialog target={renameTarget} title={renameTitle} onTitle={setRenameTitle} onOpenChange={(open) => !open && setRenameTarget(null)} onSubmit={submitRename} /><RemoveDialog target={removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)} onConfirm={() => removeTarget && removeDocument(removeTarget.id)} /><BulkRemoveDialog count={selectedDocIds.size} open={bulkRemoveOpen} onOpenChange={setBulkRemoveOpen} onConfirm={removeSelectedDocuments} /></>;
}

function CommandPalette({ open, docs, hasDocument, onOpenChange, onCreate, onRefresh, onBack, onOpenDoc }: { open: boolean; docs: DocListItem[]; hasDocument: boolean; onOpenChange: (open: boolean) => void; onCreate: () => void; onRefresh: () => void; onBack: () => void; onOpenDoc: (id: string) => void }) {
  const run = (action: () => void) => { onOpenChange(false); action(); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="command-dialog p-0"><DialogTitle className="sr-only">Command palette</DialogTitle><DialogDescription className="sr-only">Quickly create, refresh, navigate, or open a document.</DialogDescription><Command><CommandInput autoFocus placeholder="Search documents or actions…" /><CommandList><CommandEmpty>No matching command.</CommandEmpty><CommandGroup heading="Actions"><CommandItem onSelect={() => run(onCreate)}><FilePlus className="h-4 w-4" /> New document</CommandItem><CommandItem onSelect={() => run(onRefresh)}><Search className="h-4 w-4" /> Refresh documents</CommandItem>{hasDocument && <CommandItem onSelect={() => run(onBack)}><span className="inline-block w-4">←</span> Back to docs</CommandItem>}</CommandGroup><CommandGroup heading="Documents">{docs.slice(0, 8).map((doc) => <CommandItem key={doc.id} value={`${doc.title} ${doc.format}`} onSelect={() => run(() => onOpenDoc(doc.id))}><span className="command-doc-icon">{doc.format.toUpperCase()}</span>{doc.title}</CommandItem>)}</CommandGroup></CommandList></Command></DialogContent></Dialog>;
}

function RenameDialog({ target, title, onTitle, onOpenChange, onSubmit }: { target: DocListItem | OpenDocument | null; title: string; onTitle: (title: string) => void; onOpenChange: (open: boolean) => void; onSubmit: () => void }) {
  return <Dialog open={Boolean(target)} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Rename document</DialogTitle><DialogDescription>Give this document a clear name for your workspace.</DialogDescription></DialogHeader><Input autoFocus value={title} onChange={(event) => onTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSubmit(); }} placeholder="Document name" /><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={onSubmit}>Save name</Button></DialogFooter></DialogContent></Dialog>;
}

function RemoveDialog({ target, onOpenChange, onConfirm }: { target: DocListItem | null; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  return <Dialog open={Boolean(target)} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Remove document?</DialogTitle><DialogDescription>“{target?.title ?? "This document"}” will be hidden from the document list. This can be replaced by restore/archive controls later.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="destructive" onClick={onConfirm}>Remove</Button></DialogFooter></DialogContent></Dialog>;
}

function BulkRemoveDialog({ count, open, onOpenChange, onConfirm }: { count: number; open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Remove selected documents?</DialogTitle><DialogDescription>{count} selected document{count === 1 ? "" : "s"} will be hidden from the document list.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="destructive" onClick={onConfirm}>Remove selected</Button></DialogFooter></DialogContent></Dialog>;
}

function Dashboard({ docs, selectedDocIds, status, busy, onCreate, onOpen, onRefresh, onRename, onRemove, onToggleSelect, onToggleAll, onRemoveSelected }: { docs: DocListItem[]; selectedDocIds: Set<string>; status: string; busy: boolean; onCreate: () => void; onOpen: (id: string) => void; onRefresh: () => void; onRename: (doc: DocListItem) => void; onRemove: (doc: DocListItem) => void; onToggleSelect: (id: string) => void; onToggleAll: () => void; onRemoveSelected: () => void }) {
  return <main className="docs-page"><header className="docs-topbar"><div className="brand"><div className="brand-mark">m</div><div><strong>mdxdoc</strong><span>Markdown/MDX documents</span></div></div><div className="top-actions"><Button variant="outline" onClick={onRefresh} disabled={busy}>Refresh</Button><Button onClick={onCreate} disabled={busy}>{busy ? "Working…" : "New document"}</Button></div></header><section className="docs-hero"><div><span className="eyebrow">Your documents</span><h1>Recent docs</h1><p>{status}</p></div><button className="new-doc-card" onClick={onCreate} disabled={busy}><span>+</span><strong>Blank Markdown/MDX doc</strong><small>Write raw Markdown and preview it instantly.</small></button></section><section className="docs-card"><div className="docs-card-header"><div><h2>All documents</h2>{selectedDocIds.size > 0 && <p>{selectedDocIds.size} selected</p>}</div><div className="docs-card-actions"><Button variant="outline" size="sm" onClick={onToggleAll} disabled={!docs.length}>{selectedDocIds.size === docs.length && docs.length ? "Deselect all" : "Select all"}</Button>{selectedDocIds.size > 0 && <Button variant="destructive" size="sm" onClick={onRemoveSelected}>Remove selected</Button>}<span>{docs.length}</span></div></div>{docs.length === 0 ? <EmptyDocs onCreate={onCreate} busy={busy} /> : <div className="doc-grid">{docs.map((doc) => <Card className="doc-tile" role="button" tabIndex={0} key={doc.id} onClick={() => onOpen(doc.id)} onKeyDown={(event) => { if (event.key === "Enter") onOpen(doc.id); }}><label className="doc-select" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${doc.title}`} checked={selectedDocIds.has(doc.id)} onChange={() => onToggleSelect(doc.id)} /><span /></label><DropdownMenu><DropdownMenuTrigger asChild><Button className="doc-menu-trigger" variant="ghost" size="sm" title={`More actions for ${doc.title}`} onClick={(event) => event.stopPropagation()}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => onRename(doc)}>Rename</DropdownMenuItem><DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onRemove(doc)}>Remove</DropdownMenuItem></DropdownMenuContent></DropdownMenu><div className="doc-icon">{doc.format.toUpperCase()}</div><strong>{doc.title}</strong><span>{formatDate(doc.updatedAt)}</span><small>Version {doc.currentVersion ?? 1}</small></Card>)}</div>}</section></main>;
}

function EditorApp({ document, surface, status, room, ydoc, onSurface, onRename, onBack }: { document: OpenDocument; surface: Surface; status: string; room: string; ydoc: Y.Doc; onSurface: (surface: Surface) => void; onRename: (doc: OpenDocument) => void; onBack: () => void }) {
  const { provider, connected } = useCollabProvider(room, ydoc, Boolean(room));
  const [shareStatus, setShareStatus] = React.useState("Share");

  React.useEffect(() => {
    if (!connected || !provider?.wsconnected) return;
    provider.sendMessage(JSON.stringify({ type: "presence.update", mode: "edit", surface }));
  }, [provider, connected, surface]);

  async function share() {
    const url = `${window.location.origin}${window.location.pathname}?doc=${encodeURIComponent(document.id)}`;
    await navigator.clipboard.writeText(url);
    setShareStatus("Copied link");
    window.setTimeout(() => setShareStatus("Share"), 1800);
  }

  return <main className="editor-page"><header className="editor-topbar"><div className="editor-title"><Button variant="outline" onClick={onBack}>← Docs</Button><div><strong>{document.title}</strong><span>{document.id}</span></div><Button variant="outline" size="sm" onClick={() => onRename(document)}>Rename</Button></div><div className="editor-actions"><span className={`sync-pill ${connected ? "online" : "offline"}`}><i />{connected ? "Live" : "Connecting"}</span><Button variant="outline" onClick={share}>{shareStatus}</Button><Segmented value={surface} onChange={onSurface} /></div></header><section className="editor-meta"><div><span>Editing</span><strong>Raw Markdown/MDX</strong></div><div><span>Storage</span><strong>Cloudflare Artifacts</strong></div><div><span>Tip</span><strong>Apply source, then switch to Preview</strong></div></section><section className="editor-layout"><div className="editor-card"><div className="editor-surface">{surface === "source" && <SourceEditor documentId={document.id} ydoc={ydoc} />}{surface === "preview" && <PreviewFrame documentId={document.id} />}</div></div><CollabPanel documentId={document.id} /></section></main>;
}

function CollabPanel({ documentId }: { documentId: string }) {
  const [tab, setTab] = React.useState<"comments" | "suggestions" | "versions" | "changesets">("comments");
  const [comments, setComments] = React.useState<Record<string, unknown>[]>([]);
  const [suggestions, setSuggestions] = React.useState<Record<string, unknown>[]>([]);
  const [versions, setVersions] = React.useState<Record<string, unknown>[]>([]);
  const [changesets, setChangesets] = React.useState<Record<string, unknown>[]>([]);
  const [commentBody, setCommentBody] = React.useState("");
  const [selection, setSelection] = React.useState<{ start: number; end: number; quote: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    void refresh();
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ documentId: string }>).detail;
      if (detail?.documentId === documentId) void refresh();
    };
    const selectionListener = (event: Event) => {
      const detail = (event as CustomEvent<{ documentId: string; start: number; end: number; quote: string }>).detail;
      if (detail?.documentId !== documentId) return;
      setSelection(detail.quote ? { start: detail.start, end: detail.end, quote: detail.quote } : null);
    };
    window.addEventListener("mdxdoc:suggestions-updated", listener);
    window.addEventListener("mdxdoc:source-selection", selectionListener);
    return () => {
      window.removeEventListener("mdxdoc:suggestions-updated", listener);
      window.removeEventListener("mdxdoc:source-selection", selectionListener);
    };
  }, [documentId]);

  async function refresh() {
    const [commentRes, suggestionRes, versionRes, changesetRes] = await Promise.all([client.docs.comments(documentId), client.docs.suggestions(documentId), client.docs.versions(documentId), client.docs.changesets(documentId)]);
    setComments(commentRes.items as Record<string, unknown>[]);
    setSuggestions(suggestionRes.items as Record<string, unknown>[]);
    setVersions(versionRes.items as Record<string, unknown>[]);
    setChangesets(changesetRes.items as Record<string, unknown>[]);
  }

  async function withBusy(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); await refresh(); }
    finally { setBusy(false); }
  }

  async function addComment() {
    if (!commentBody.trim()) return;
    await withBusy(async () => {
      await client.docs.createComment(documentId, { body: commentBody, anchor: selection ? { kind: "source_range", start: selection.start, end: selection.end, quote: selection.quote } : { kind: "block", nodeId: "document" } });
      setCommentBody("");
    });
  }

  async function resolveComment(id: string) {
    await withBusy(async () => { await client.docs.resolveComment(id); });
  }

  async function acceptSuggestion(suggestion: Record<string, unknown>) {
    const after = typeof suggestion.after === "string" ? suggestion.after : "";
    const id = String(suggestion.id);
    if (!after || !id) return;
    await withBusy(async () => {
      const source = await client.docs.source(documentId);
      await client.docs.putSource(documentId, { baseVersion: source.version, source: after });
      await client.docs.acceptSuggestion(id);
      window.dispatchEvent(new CustomEvent("mdxdoc:source-updated", { detail: { documentId } }));
    });
  }

  async function rejectSuggestion(id: string) {
    await withBusy(async () => { await client.docs.rejectSuggestion(id); });
  }

  async function checkpoint() {
    await withBusy(async () => { await client.docs.checkpoint(documentId); toast.success("Checkpoint created"); });
  }

  async function restore(versionId: string) {
    await withBusy(async () => {
      await client.docs.restore(documentId, versionId);
      window.dispatchEvent(new CustomEvent("mdxdoc:source-updated", { detail: { documentId } }));
      toast.success("Version restored");
    });
  }

  async function createChangeset() {
    await withBusy(async () => { await client.docs.createChangeset(documentId, { title: `Changeset ${new Date().toLocaleString()}` }); toast.success("Changeset created"); });
  }

  async function transitionChangeset(id: string, action: "accept" | "reject") {
    await withBusy(async () => {
      if (action === "accept") await client.docs.acceptChangeset(id);
      else await client.docs.rejectChangeset(id);
    });
  }

  return <aside className="collab-panel">
    <Tabs value={tab} onValueChange={(next) => setTab(next as "comments" | "suggestions" | "versions" | "changesets")}><TabsList className="collab-tabs"><TabsTrigger value="comments">Comments</TabsTrigger><TabsTrigger value="suggestions">Suggestions</TabsTrigger><TabsTrigger value="versions">Versions</TabsTrigger><TabsTrigger value="changesets">Changesets</TabsTrigger></TabsList></Tabs>
    {tab === "comments" ? <div className="collab-section">
      <div className="comment-target">{selection ? <><strong>Commenting on selected text</strong><blockquote>{selection.quote}</blockquote><button onClick={() => setSelection(null)}>Use general comment</button></> : <><strong>General comment</strong><span>Select text in the Markdown editor to attach this comment to a passage.</span></>}</div>
      <Textarea placeholder={selection ? "Comment on this selection…" : "Ask a question or leave feedback…"} value={commentBody} onChange={(e) => setCommentBody(e.target.value)} />
      <Button className="w-full" disabled={busy || !commentBody.trim()} onClick={addComment}>{selection ? "Comment on selection" : "Add comment"}</Button>
      <div className="collab-list">{comments.length === 0 ? <p>No comments yet.</p> : comments.map((comment) => <CommentCard key={String(comment.id)} comment={comment} busy={busy} onResolve={resolveComment} />)}</div>
    </div> : tab === "suggestions" ? <div className="collab-section">
      <div className="suggestion-help"><strong>Suggest edits in the document</strong><span>Switch the Markdown editor to Suggesting, make changes, then click Propose suggestion.</span></div>
      <div className="collab-list">{suggestions.length === 0 ? <p>No suggestions yet.</p> : suggestions.map((suggestion) => <SuggestionCard key={String(suggestion.id)} suggestion={suggestion} busy={busy} onAccept={acceptSuggestion} onReject={rejectSuggestion} />)}</div>
    </div> : tab === "versions" ? <div className="collab-section"><Button className="w-full" onClick={checkpoint} disabled={busy}>Create checkpoint</Button><div className="collab-list">{versions.length === 0 ? <p>No versions yet.</p> : versions.map((version) => <VersionCard key={String(version.id)} version={version} busy={busy} onRestore={restore} />)}</div></div> : <div className="collab-section"><Button className="w-full" onClick={createChangeset} disabled={busy}>Create changeset</Button><div className="collab-list">{changesets.length === 0 ? <p>No changesets yet.</p> : changesets.map((changeset) => <ChangesetCard key={String(changeset.id)} changeset={changeset} busy={busy} onTransition={transitionChangeset} />)}</div></div>}
  </aside>;
}

function VersionCard({ version, busy, onRestore }: { version: Record<string, unknown>; busy: boolean; onRestore: (id: string) => void }) {
  return <div className="collab-item"><div className="collab-item-head"><strong>Version {String(version.versionNumber ?? version.version_number ?? "?")}</strong><Badge variant="secondary">{String(version.reason ?? "checkpoint")}</Badge></div><span className="collab-meta">{formatDate(String(version.createdAt ?? version.created_at ?? ""))}</span><Button className="mt-3" variant="outline" size="sm" disabled={busy} onClick={() => onRestore(String(version.id ?? version.versionNumber))}>Restore</Button></div>;
}

function ChangesetCard({ changeset, busy, onTransition }: { changeset: Record<string, unknown>; busy: boolean; onTransition: (id: string, action: "accept" | "reject") => void }) {
  const status = String(changeset.status ?? "pending");
  return <div className="collab-item"><div className="collab-item-head"><strong>{String(changeset.title ?? "Changeset")}</strong><Badge variant="outline" className={status}>{friendlyStatus(status)}</Badge></div><span className="collab-meta">{formatDate(String(changeset.updatedAt ?? changeset.updated_at ?? ""))}</span>{status === "pending" && <div className="suggestion-actions"><Button size="sm" disabled={busy} onClick={() => onTransition(String(changeset.id), "accept")}>Accept</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => onTransition(String(changeset.id), "reject")}>Reject</Button></div>}</div>;
}

function CommentCard({ comment, busy, onResolve }: { comment: Record<string, unknown>; busy: boolean; onResolve: (id: string) => void }) {
  const status = String(comment.status ?? "open");
  const quote = commentQuote(comment);
  return <div className="collab-item"><div className="collab-item-head"><strong>{commentTitle(comment)}</strong><Badge variant={status === "resolved" ? "secondary" : "outline"} className={status === "resolved" ? "resolved" : "open"}>{status === "resolved" ? "Resolved" : "Open"}</Badge></div>{quote && <blockquote className="comment-quote">{quote}</blockquote>}{status !== "resolved" && <Button className="mt-3" variant="outline" size="sm" disabled={busy} onClick={() => onResolve(String(comment.id))}>Resolve</Button>}</div>;
}

function SuggestionCard({ suggestion, busy, onAccept, onReject }: { suggestion: Record<string, unknown>; busy: boolean; onAccept: (suggestion: Record<string, unknown>) => void; onReject: (id: string) => void }) {
  const status = String(suggestion.status ?? "pending");
  const after = typeof suggestion.after === "string" ? suggestion.after : "";
  return <div className="collab-item"><div className="collab-item-head"><strong>Replace document source</strong><Badge variant="outline" className={status}>{friendlyStatus(status)}</Badge></div>{after && <pre className="suggestion-preview">{after.slice(0, 220)}{after.length > 220 ? "…" : ""}</pre>}{status === "pending" && <div className="suggestion-actions"><Button size="sm" disabled={busy || !after} onClick={() => onAccept(suggestion)}>Accept</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => onReject(String(suggestion.id))}>Reject</Button></div>}</div>;
}

function commentTitle(comment: Record<string, unknown>) {
  const messages = Array.isArray(comment.messages) ? comment.messages as Array<Record<string, unknown>> : [];
  return String(messages[0]?.body ?? "Comment");
}

function commentQuote(comment: Record<string, unknown>) {
  const anchor = comment.anchor as Record<string, unknown> | undefined;
  return typeof anchor?.quote === "string" ? anchor.quote : "";
}

function friendlyStatus(status: string) {
  if (status === "pending") return "Needs review";
  if (status === "accepted") return "Accepted";
  if (status === "rejected") return "Rejected";
  return status;
}

function Segmented({ value, onChange }: { value: Surface; onChange: (surface: Surface) => void }) {
  return <Tabs value={value} onValueChange={(next) => onChange(next as Surface)}><TabsList><TabsTrigger value="source">Markdown</TabsTrigger><TabsTrigger value="preview">Preview</TabsTrigger></TabsList></Tabs>;
}

function EmptyDocs({ onCreate, busy }: { onCreate: () => void; busy: boolean }) {
  return <div className="empty-docs"><div>✦</div><h2>No documents yet</h2><p>Create your first document. You’ll edit raw Markdown/MDX and switch to Preview when you want to check the rendered result.</p><Button onClick={onCreate} disabled={busy}>Create document</Button></div>;
}

function useCollabProvider(room: string, doc: Y.Doc, enabled: boolean) {
  const [provider, setProvider] = React.useState<YProvider | null>(null);
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    if (!enabled) {
      setProvider(null);
      setConnected(false);
      return;
    }
    const host = (import.meta.env.VITE_COLLAB_HOST as string | undefined) ?? window.location.host;
    const next = new YProvider(host, room, doc, { connect: false, prefix: `/collab/document-room/${room}`, params: async () => ({ token: "local-dev-token" }) });
    const handleStatus = ({ status }: { status: string }) => setConnected(status === "connected");
    const handleClose = () => setConnected(false);
    next.on("status", handleStatus);
    next.on("connection-close", handleClose);
    next.connect();
    setProvider(next);
    return () => {
      next.off("status", handleStatus);
      next.off("connection-close", handleClose);
      next.disconnect();
      next.destroy?.();
      setConnected(false);
    };
  }, [room, doc, enabled]);

  return { provider, connected };
}

function toWorkspace(row: Record<string, unknown>): Workspace {
  return { id: String(row.id), name: String(row.name ?? "Workspace"), ...(typeof row.slug === "string" ? { slug: row.slug } : {}) };
}

function toDocListItem(row: Record<string, unknown>, fallbackWorkspaceId: string): DocListItem {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id ?? row.workspaceId ?? fallbackWorkspaceId),
    title: String(row.title ?? "Untitled document"),
    format: row.format === "md" ? "md" : "mdx",
    ...(typeof row.updated_at === "string" ? { updatedAt: row.updated_at } : typeof row.updatedAt === "string" ? { updatedAt: row.updatedAt } : {}),
    ...(typeof row.current_version === "number" ? { currentVersion: row.current_version } : typeof row.currentVersion === "number" ? { currentVersion: row.currentVersion } : {})
  };
}

function toOpenDocument(row: Record<string, unknown>): OpenDocument {
  return { ...toDocListItem(row, String(row.workspace_id ?? row.workspaceId ?? "workspace")), ...(typeof row.artifact_repo === "string" ? { artifactRepo: row.artifact_repo } : {}) };
}

function formatDate(value?: string) {
  if (!value) return "Recently edited";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
