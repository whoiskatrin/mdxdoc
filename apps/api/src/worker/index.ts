import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { routePartykitRequest } from "partyserver";
import { defaultRegistry, type DocumentRecord } from "@mdxdoc/document-model";
import { parseMdx, serializeMdx } from "@mdxdoc/mdx";
import { canRole, type ApiError, type EffectiveRole, type HealthResponse } from "@mdxdoc/protocol";
import { snapshotFromSource } from "../services/yjs-source-codec";
import { ArtifactStore, type ArtifactsBinding } from "../services/artifact-store";
import { D1ChangesetRepository, D1CommentRepository, D1DocumentRepository, D1PermissionRepository, D1SuggestionRepository, D1VersionRepository, D1WorkspaceRepository } from "../repositories/d1-repositories";
export { DocumentRoom } from "../durable-objects/document-room";

export class MdxdocWorkflow extends WorkflowEntrypoint<Env, unknown> {
  async run(_event: Readonly<WorkflowEvent<unknown>>, _step: WorkflowStep) {
    return { ok: true, status: "workflow scaffold" };
  }
}

export type Env = {
  DOCUMENT_ROOM: DurableObjectNamespace;
  DB: D1Database;
  SNAPSHOT_QUEUE: Queue;
  EXPORT_QUEUE: Queue;
  NOTIFICATION_QUEUE: Queue;
  ARTIFACTS: ArtifactsBinding;
};

type Actor = { userId: string; role: EffectiveRole | undefined };

export default {
  async queue(batch: MessageBatch<unknown>, _env: Env, _ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) message.ack();
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);

    if (url.pathname.startsWith("/collab/")) {
      const routed = await routePartykitRequest(request, env, {
        prefix: "collab",
        onBeforeConnect: (req, room) => beforeCollabConnect(req, room.name, env)
      });
      if (routed) return routed;
    }

    try {
      if (request.method.toUpperCase() === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
      if (url.pathname === "/health") return json<HealthResponse>({ ok: true, service: "mdxdoc-api", version: "0.2.0" });
      if (!url.pathname.startsWith("/api/v1")) return jsonError("not_found", "Route not found", 404, requestId);

      const method = request.method.toUpperCase();
      const path = url.pathname.replace(/^\/api\/v1/, "");
      const actor = actorFromRequest(request);

      if (method === "GET" && path === "/workspaces") return json({ items: await repos(env).workspaces.list() });
      if (method === "POST" && path === "/workspaces") return createWorkspace(request, env, actor);

      const workspaceDocs = path.match(/^\/workspaces\/([^/]+)\/documents$/);
      if (workspaceDocs && method === "GET") return json({ items: await repos(env).documents.list(workspaceDocs[1]!) });
      if (workspaceDocs && method === "POST") return createDocument(request, env, workspaceDocs[1]!, actor);

      const doc = path.match(/^\/documents\/([^/]+)$/);
      if (doc && method === "GET") return getDocument(env, doc[1]!);
      if (doc && method === "PATCH") return withPermission(env, doc[1]!, actor, "edit", () => patchDocument(request, env, doc[1]!));
      if (doc && method === "DELETE") return withPermission(env, doc[1]!, actor, "manage", () => archiveDocument(env, doc[1]!));

      const source = path.match(/^\/documents\/([^/]+)\/source$/);
      if (source && method === "GET") return withPermission(env, source[1]!, actor, "view", () => getSource(env, source[1]!));
      if (source && method === "PUT") return withPermission(env, source[1]!, actor, "edit", () => putSource(request, env, source[1]!, actor));

      const exportDoc = path.match(/^\/documents\/([^/]+)\/export$/);
      if (exportDoc && method === "GET") return withPermission(env, exportDoc[1]!, actor, "view", () => exportSource(env, exportDoc[1]!, url.searchParams.get("format") ?? "mdx"));

      const tree = path.match(/^\/documents\/([^/]+)\/tree$/);
      if (tree && method === "GET") return withPermission(env, tree[1]!, actor, "view", () => getTree(env, tree[1]!));

      const preview = path.match(/^\/documents\/([^/]+)\/preview$/);
      if (preview && method === "POST") return withPermission(env, preview[1]!, actor, "view", () => createPreview(env, preview[1]!));

      const session = path.match(/^\/documents\/([^/]+)\/session$/);
      if (session && method === "GET") return withPermission(env, session[1]!, actor, "view", () => getSession(env, session[1]!, request));

      const comments = path.match(/^\/documents\/([^/]+)\/comments$/);
      if (comments && method === "GET") return withPermission(env, comments[1]!, actor, "view", async () => json({ items: await repos(env).comments.list(comments[1]!) }));
      if (comments && method === "POST") return withPermission(env, comments[1]!, actor, "comment", () => createComment(request, env, comments[1]!, actor));

      const commentMessage = path.match(/^\/comments\/([^/]+)\/messages$/);
      if (commentMessage && method === "POST") return replyToComment(request, env, commentMessage[1]!, actor);
      const commentResolve = path.match(/^\/comments\/([^/]+)\/resolve$/);
      if (commentResolve && method === "POST") return resolveComment(env, commentResolve[1]!, actor);
      const commentReopen = path.match(/^\/comments\/([^/]+)\/reopen$/);
      if (commentReopen && method === "POST") return reopenComment(env, commentReopen[1]!, actor);

      const suggestions = path.match(/^\/documents\/([^/]+)\/suggestions$/);
      if (suggestions && method === "GET") return withPermission(env, suggestions[1]!, actor, "view", async () => json({ items: await repos(env).suggestions.list(suggestions[1]!) }));
      if (suggestions && method === "POST") return withPermission(env, suggestions[1]!, actor, "suggest", () => createSuggestion(request, env, suggestions[1]!, actor));
      const suggestionAccept = path.match(/^\/suggestions\/([^/]+)\/accept$/);
      if (suggestionAccept && method === "POST") return setSuggestionStatus(env, suggestionAccept[1]!, "accepted", actor);
      const suggestionReject = path.match(/^\/suggestions\/([^/]+)\/reject$/);
      if (suggestionReject && method === "POST") return setSuggestionStatus(env, suggestionReject[1]!, "rejected", actor);

      const changesets = path.match(/^\/documents\/([^/]+)\/changesets$/);
      if (changesets && method === "GET") return withPermission(env, changesets[1]!, actor, "view", async () => json({ items: await repos(env).changesets.list(changesets[1]!) }));
      if (changesets && method === "POST") return withPermission(env, changesets[1]!, actor, "suggest", () => createChangeset(request, env, changesets[1]!, actor));
      const changesetAccept = path.match(/^\/changesets\/([^/]+)\/accept$/);
      if (changesetAccept && method === "POST") return setChangesetStatus(env, changesetAccept[1]!, "accepted", actor);
      const changesetReject = path.match(/^\/changesets\/([^/]+)\/reject$/);
      if (changesetReject && method === "POST") return setChangesetStatus(env, changesetReject[1]!, "rejected", actor);

      const versions = path.match(/^\/documents\/([^/]+)\/versions$/);
      if (versions && method === "GET") return withPermission(env, versions[1]!, actor, "view", async () => json({ items: await repos(env).versions.list(versions[1]!) }));
      if (versions && method === "POST") return withPermission(env, versions[1]!, actor, "edit", () => checkpointVersion(env, versions[1]!, actor, "manual"));
      const restore = path.match(/^\/documents\/([^/]+)\/restore\/([^/]+)$/);
      if (restore && method === "POST") return withPermission(env, restore[1]!, actor, "edit", () => restoreVersion(env, restore[1]!, restore[2]!, actor));

      const registry = path.match(/^\/workspaces\/([^/]+)\/component-registry$/);
      if (registry && method === "GET") return json({ registry: defaultRegistry });
      if (registry && method === "PUT") return json({ registry: await request.json() });
      if (path.match(/^\/workspaces\/([^/]+)\/component-registry\/validate$/) && method === "POST") return json({ ok: true });

      return jsonError("not_found", "Route not found", 404, requestId);
    } catch (error) {
      return jsonError("internal_error", error instanceof Error ? error.message : "Internal error", 500, requestId);
    } finally {
      ctx.waitUntil(Promise.resolve());
    }
  }
} satisfies ExportedHandler<Env>;

async function beforeCollabConnect(_request: Request, roomName: string, env: Env): Promise<Response | void> {
  const ids = roomName.match(/^doc:([^:]+):([^:]+)$/);
  if (!ids) return jsonError("bad_room", "Expected room doc:{workspaceId}:{documentId}", 400, crypto.randomUUID());
  const row = await env.DB.prepare("SELECT id FROM documents WHERE workspace_id = ? AND id = ? AND status != 'deleted'").bind(ids[1], ids[2]).first();
  if (!row) return jsonError("not_found", "Document not found", 404, crypto.randomUUID());
}

function repos(env: Env) {
  return {
    workspaces: new D1WorkspaceRepository(env.DB),
    documents: new D1DocumentRepository(env.DB),
    permissions: new D1PermissionRepository(env.DB),
    comments: new D1CommentRepository(env.DB),
    suggestions: new D1SuggestionRepository(env.DB),
    changesets: new D1ChangesetRepository(env.DB),
    versions: new D1VersionRepository(env.DB)
  };
}

function actorFromRequest(request: Request): Actor {
  return { userId: request.headers.get("x-user-id") ?? "local-user", role: (request.headers.get("x-mdxdoc-role") as EffectiveRole | null) ?? undefined };
}

async function withPermission(env: Env, documentId: string, actor: Actor, action: Parameters<typeof canRole>[1], fn: () => Promise<Response>): Promise<Response> {
  const role = actor.role ?? await repos(env).permissions.effectiveRole(documentId, actor.userId);
  if (!canRole(role, action)) return jsonError("forbidden", `Role ${role} cannot ${action}`, 403, crypto.randomUUID());
  return fn();
}

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,idempotency-key,x-mdxdoc-role,x-user-id"
  };
}

function json<T>(body: T, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...corsHeaders(), ...init.headers } });
}
function jsonError(code: string, message: string, status: number, requestId: string): Response {
  const body: ApiError = { error: { code, message, requestId } };
  return json(body, { status });
}
async function readJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

async function createWorkspace(request: Request, env: Env, actor: Actor) {
  const body = await readJson<{ name: string; slug: string }>(request);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await repos(env).workspaces.create({ id, name: body.name, slug: body.slug, createdBy: actor.userId, now });
  return json({ id, ...body, createdAt: now, updatedAt: now }, { status: 201 });
}
async function createDocument(request: Request, env: Env, workspaceId: string, actor: Actor) {
  const body = await readJson<{ title: string; format: "md" | "mdx"; source?: string }>(request);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const source = body.source ?? `# ${body.title}\n`;
  const parsed = parseMdx(source);
  if (!parsed.ok) return jsonError("invalid_mdx", "Source did not parse", 422, crypto.randomUUID());
  const version = 1;
  const snapshot = snapshotFromSource(source);
  const artifact = await new ArtifactStore(env.ARTIFACTS).commitDocumentVersion({
    workspaceId,
    documentId: id,
    version,
    reason: "created",
    source,
    treeJson: JSON.stringify(parsed.tree),
    snapshot,
    author: { name: actor.userId, email: `${actor.userId}@mdxdoc.local` }
  });
  await repos(env).documents.create({ id, workspaceId, title: body.title, format: body.format, version, sourceKey: artifact.sourcePath, treeKey: artifact.treePath, snapshotKey: artifact.snapshotPath, artifactRepo: artifact.repo, artifactRemote: artifact.remote, artifactCommit: artifact.commit, artifactManifestPath: artifact.manifestPath, createdBy: actor.userId, now });
  await createVersionRecord(env, { documentId: id, version, artifact, createdBy: actor.userId, reason: "created", now });
  return json({ id, workspaceId, title: body.title, format: body.format, currentVersion: version, artifactRepo: artifact.repo, artifactCommit: artifact.commit, latestSnapshotKey: artifact.snapshotPath, latestTreeKey: artifact.treePath, latestSourceKey: artifact.sourcePath }, { status: 201 });
}
async function getDocument(env: Env, id: string) {
  const row = await repos(env).documents.get(id) as DocumentRecord | null;
  return row ? json(row) : jsonError("not_found", "Document not found", 404, crypto.randomUUID());
}
async function patchDocument(request: Request, env: Env, id: string) {
  const body = await readJson<{ title?: string }>(request);
  if (body.title) await repos(env).documents.patchTitle(id, body.title, new Date().toISOString());
  return getDocument(env, id);
}
async function archiveDocument(env: Env, id: string) {
  await repos(env).documents.archive(id, new Date().toISOString());
  return new Response(null, { status: 204, headers: corsHeaders() });
}
async function getSource(env: Env, id: string) {
  const row = await repos(env).documents.getForSource(id);
  if (!row?.latest_source_key) return jsonError("not_found", "Source not found", 404, crypto.randomUUID());
  const source = await new ArtifactStore(env.ARTIFACTS).readText({ repoName: row.artifact_repo, remote: row.artifact_remote ?? undefined, commit: row.artifact_commit, path: row.latest_source_key });
  return json({ documentId: row.id, version: row.current_version, source });
}
async function exportSource(env: Env, id: string, format: string) {
  const source = await getSource(env, id);
  if (!source.ok) return source;
  const payload = await source.clone().json() as { documentId: string; version: number; source: string };
  return json({ ...payload, format: format === "md" ? "md" : "mdx" });
}

async function putSource(request: Request, env: Env, id: string, _actor: Actor) {
  const body = await readJson<{ baseVersion: number; source: string }>(request);
  const doc = await repos(env).documents.getForSource(id);
  if (!doc) return jsonError("not_found", "Document not found", 404, crypto.randomUUID());
  if (body.baseVersion !== doc.current_version) return jsonError("version_conflict", "baseVersion does not match current version", 409, crypto.randomUUID());
  const parsed = parseMdx(body.source);
  if (!parsed.ok) return jsonError("invalid_mdx", "Source did not parse", 422, crypto.randomUUID());
  const version = doc.current_version + 1;
  const snapshot = snapshotFromSource(body.source);
  const artifact = await new ArtifactStore(env.ARTIFACTS).commitDocumentVersion({
    workspaceId: doc.workspace_id,
    documentId: id,
    version,
    reason: "source_apply",
    source: body.source,
    treeJson: JSON.stringify(parsed.tree),
    snapshot,
    repoName: doc.artifact_repo,
    remote: doc.artifact_remote ?? undefined
  });
  const now = new Date().toISOString();
  await repos(env).documents.updateArtifacts({ id, version, sourceKey: artifact.sourcePath, treeKey: artifact.treePath, snapshotKey: artifact.snapshotPath, artifactRepo: artifact.repo, artifactRemote: artifact.remote, artifactCommit: artifact.commit, artifactManifestPath: artifact.manifestPath, now });
  await createVersionRecord(env, { documentId: id, version, artifact, createdBy: _actor.userId, reason: "source_apply", now });
  return json({ documentId: id, version, source: body.source });
}
async function getTree(env: Env, id: string) {
  const row = await repos(env).documents.getForSource(id);
  if (!row?.latest_tree_key) return jsonError("not_found", "Tree not found", 404, crypto.randomUUID());
  const text = await new ArtifactStore(env.ARTIFACTS).readText({ repoName: row.artifact_repo, remote: row.artifact_remote ?? undefined, commit: row.artifact_commit, path: row.latest_tree_key });
  return json(JSON.parse(text));
}
async function createPreview(env: Env, id: string) {
  const sourceRes = await getSource(env, id);
  if (!sourceRes.ok) return sourceRes;
  const payload = (await sourceRes.clone().json()) as { source: string };
  const parsed = parseMdx(payload.source);
  const html = parsed.ok ? renderPreviewHtml(serializeMdx(parsed.tree)) : "<p>Invalid MDX</p>";
  return json({ html, sandbox: "" });
}
async function getSession(env: Env, id: string, request: Request) {
  const doc = await repos(env).documents.getForSource(id);
  if (!doc) return jsonError("not_found", "Document not found", 404, crypto.randomUUID());
  const host = new URL(request.url).host;
  return json({ room: `doc:${doc.workspace_id}:${id}`, party: "document-room", prefix: "/collab", host });
}
async function createComment(request: Request, env: Env, documentId: string, actor: Actor) {
  const body = await readJson<{ anchor: unknown; body: string }>(request);
  return json(await repos(env).comments.create({ documentId, authorId: actor.userId, anchor: body.anchor as never, body: body.body }), { status: 201 });
}
async function replyToComment(request: Request, env: Env, threadId: string, actor: Actor) {
  const body = await readJson<{ body: string }>(request);
  await repos(env).comments.addMessage(threadId, actor.userId, body.body);
  return json({ ok: true });
}
async function resolveComment(env: Env, threadId: string, actor: Actor) {
  await repos(env).comments.resolve(threadId, actor.userId);
  return json({ ok: true });
}
async function reopenComment(env: Env, threadId: string, _actor: Actor) {
  await repos(env).comments.reopen(threadId);
  return json({ ok: true });
}
async function createVersionRecord(env: Env, input: { documentId: string; version: number; artifact: { sourcePath: string; treePath: string; snapshotPath: string; repo: string; commit: string; manifestPath: string }; createdBy: string; reason: string; now: string }) {
  return repos(env).versions.create({ id: crypto.randomUUID(), documentId: input.documentId, versionNumber: input.version, sourceKey: input.artifact.sourcePath, treeKey: input.artifact.treePath, snapshotKey: input.artifact.snapshotPath, artifactRepo: input.artifact.repo, artifactCommit: input.artifact.commit, artifactManifestPath: input.artifact.manifestPath, createdBy: input.createdBy, reason: input.reason, now: input.now });
}

async function checkpointVersion(env: Env, id: string, actor: Actor, reason: string) {
  const doc = await repos(env).documents.getForSource(id);
  if (!doc) return jsonError("not_found", "Document not found", 404, crypto.randomUUID());
  const item = await repos(env).versions.create({ id: crypto.randomUUID(), documentId: id, versionNumber: doc.current_version, sourceKey: doc.latest_source_key!, treeKey: doc.latest_tree_key!, snapshotKey: doc.latest_snapshot_key!, artifactRepo: doc.artifact_repo, artifactCommit: doc.artifact_commit, artifactManifestPath: doc.artifact_manifest_path, createdBy: actor.userId, reason, now: new Date().toISOString() });
  return json(item, { status: 201 });
}

async function restoreVersion(env: Env, id: string, versionId: string, actor: Actor) {
  const version = await repos(env).versions.get(id, versionId);
  const doc = await repos(env).documents.getForSource(id);
  if (!version || !doc) return jsonError("not_found", "Version not found", 404, crypto.randomUUID());
  const source = await new ArtifactStore(env.ARTIFACTS).readText({ repoName: version.artifactRepo || doc.artifact_repo, commit: version.artifactCommit || doc.artifact_commit, path: version.sourceKey });
  const parsed = parseMdx(source);
  if (!parsed.ok) return jsonError("invalid_mdx", "Version source did not parse", 422, crypto.randomUUID());
  const nextVersion = doc.current_version + 1;
  const snapshot = snapshotFromSource(source);
  const artifact = await new ArtifactStore(env.ARTIFACTS).commitDocumentVersion({ workspaceId: doc.workspace_id, documentId: id, version: nextVersion, reason: "restore", source, treeJson: JSON.stringify(parsed.tree), snapshot, repoName: doc.artifact_repo, remote: doc.artifact_remote ?? undefined });
  const now = new Date().toISOString();
  await repos(env).documents.updateArtifacts({ id, version: nextVersion, sourceKey: artifact.sourcePath, treeKey: artifact.treePath, snapshotKey: artifact.snapshotPath, artifactRepo: artifact.repo, artifactRemote: artifact.remote, artifactCommit: artifact.commit, artifactManifestPath: artifact.manifestPath, now });
  await createVersionRecord(env, { documentId: id, version: nextVersion, artifact, createdBy: actor.userId, reason: `restore:${version.versionNumber}`, now });
  return json({ documentId: id, version: nextVersion, source });
}

async function createChangeset(request: Request, env: Env, documentId: string, actor: Actor) {
  const body = await readJson<{ title?: string; description?: string; baseVersion?: number }>(request);
  const doc = await repos(env).documents.getForSource(documentId);
  if (!doc) return jsonError("not_found", "Document not found", 404, crypto.randomUUID());
  return json(await repos(env).changesets.create({ id: crypto.randomUUID(), documentId, authorId: actor.userId, title: body.title ?? "Untitled changeset", ...(body.description ? { description: body.description } : {}), baseVersion: body.baseVersion ?? doc.current_version, now: new Date().toISOString() }), { status: 201 });
}

async function setChangesetStatus(env: Env, id: string, status: "accepted" | "rejected", actor: Actor) {
  const store = repos(env);
  const changeset = await store.changesets.get(id);
  if (!changeset) return jsonError("not_found", "Changeset not found", 404, crypto.randomUUID());
  if (status === "rejected") {
    for (const suggestion of await store.suggestions.listForChangeset(id)) if (suggestion.status === "pending") await store.suggestions.setStatus(suggestion.id, "rejected");
    await store.changesets.setStatus(id, "rejected", new Date().toISOString());
    return json({ ok: true, changesetId: id, status: "rejected" });
  }
  let accepted = 0;
  let conflicted = 0;
  for (const suggestion of await store.suggestions.listForChangeset(id)) {
    if (suggestion.status !== "pending") continue;
    const result = await applySuggestion(env, suggestion.id, actor);
    if (result.ok) accepted += 1;
    else conflicted += 1;
  }
  const nextStatus = conflicted > 0 ? "conflicted" : "accepted";
  await store.changesets.setStatus(id, nextStatus, new Date().toISOString());
  return json({ ok: conflicted === 0, changesetId: id, status: nextStatus, accepted, conflicted });
}

async function createSuggestion(request: Request, env: Env, documentId: string, actor: Actor) {
  const body = await readJson<{ type: never; anchor: unknown; before?: unknown; after?: unknown; baseVersion: number; changesetId?: string }>(request);
  return json(await repos(env).suggestions.create({ documentId, authorId: actor.userId, type: body.type, anchor: body.anchor as never, before: body.before, after: body.after, baseVersion: body.baseVersion, ...(body.changesetId ? { changesetId: body.changesetId } : {}) }), { status: 201 });
}
async function setSuggestionStatus(env: Env, suggestionId: string, status: "accepted" | "rejected", actor: Actor) {
  if (actor.role && !canRole(actor.role, "accept")) return jsonError("forbidden", `Role ${actor.role} cannot accept`, 403, crypto.randomUUID());
  if (status === "rejected") {
    await repos(env).suggestions.setStatus(suggestionId, "rejected");
    return json({ ok: true, suggestionId, status });
  }
  const result = await applySuggestion(env, suggestionId, actor);
  if (!result.ok) return json({ ok: false, suggestionId, status: "conflicted", conflictReason: result.reason }, { status: 409 });
  return json({ ok: true, suggestionId, status: "accepted", documentId: result.documentId, version: result.version, source: result.source });
}

async function applySuggestion(env: Env, suggestionId: string, actor: Actor): Promise<{ ok: true; documentId: string; version: number; source: string } | { ok: false; reason: string }> {
  const store = repos(env);
  const suggestion = await store.suggestions.get(suggestionId);
  if (!suggestion) return { ok: false, reason: "Suggestion not found" };
  const doc = await store.documents.getForSource(String(suggestion.documentId));
  if (!doc) return { ok: false, reason: "Document not found" };
  const current = await new ArtifactStore(env.ARTIFACTS).readText({ repoName: doc.artifact_repo, remote: doc.artifact_remote ?? undefined, commit: doc.artifact_commit, path: doc.latest_source_key! });
  const next = applySourceSuggestion(current, suggestion);
  if (!next.ok) {
    await store.suggestions.setStatus(suggestionId, "conflicted", next.reason);
    return { ok: false, reason: next.reason };
  }
  const parsed = parseMdx(next.source);
  if (!parsed.ok) {
    await store.suggestions.setStatus(suggestionId, "conflicted", "Accepted source would not parse as MDX");
    return { ok: false, reason: "Accepted source would not parse as MDX" };
  }
  const version = doc.current_version + 1;
  const snapshot = snapshotFromSource(next.source);
  const artifact = await new ArtifactStore(env.ARTIFACTS).commitDocumentVersion({ workspaceId: doc.workspace_id, documentId: doc.id, version, reason: `suggestion:${suggestionId}`, source: next.source, treeJson: JSON.stringify(parsed.tree), snapshot, repoName: doc.artifact_repo, remote: doc.artifact_remote ?? undefined });
  const now = new Date().toISOString();
  await store.documents.updateArtifacts({ id: doc.id, version, sourceKey: artifact.sourcePath, treeKey: artifact.treePath, snapshotKey: artifact.snapshotPath, artifactRepo: artifact.repo, artifactRemote: artifact.remote, artifactCommit: artifact.commit, artifactManifestPath: artifact.manifestPath, now });
  await createVersionRecord(env, { documentId: doc.id, version, artifact, createdBy: actor.userId, reason: `suggestion:${suggestionId}`, now });
  await store.suggestions.setStatus(suggestionId, "accepted");
  return { ok: true, documentId: doc.id, version, source: next.source };
}

function applySourceSuggestion(current: string, suggestion: { type: string; anchor: unknown; before?: unknown; after?: unknown; baseVersion: number }): { ok: true; source: string } | { ok: false; reason: string } {
  const before = typeof suggestion.before === "string" ? suggestion.before : "";
  const after = typeof suggestion.after === "string" ? suggestion.after : "";
  if (suggestion.type === "replace_document_source") {
    if (before && current !== before) return { ok: false, reason: "Document changed since suggestion was created" };
    return { ok: true, source: after };
  }
  if (suggestion.type === "replace_source_range" || suggestion.type === "replace_text") {
    const anchor = suggestion.anchor as { kind?: string; start?: number; end?: number };
    if (anchor.kind !== "source_range" || typeof anchor.start !== "number" || typeof anchor.end !== "number") return { ok: false, reason: "Suggestion is missing a source range" };
    if (current.slice(anchor.start, anchor.end) === before) return { ok: true, source: current.slice(0, anchor.start) + after + current.slice(anchor.end) };
    if (before) {
      const first = current.indexOf(before);
      if (first >= 0 && first === current.lastIndexOf(before)) return { ok: true, source: current.slice(0, first) + after + current.slice(first + before.length) };
    }
    return { ok: false, reason: "Source range no longer matches the suggested text" };
  }
  return { ok: false, reason: `Unsupported suggestion type ${suggestion.type}` };
}
function renderPreviewHtml(source: string) {
  const body = renderMarkdown(source);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root { color: #202124; background: white; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; padding: 56px 72px; }
    article { max-width: 820px; margin: 0 auto; }
    h1 { font-size: 44px; line-height: 1.05; letter-spacing: -0.04em; margin: 0 0 28px; }
    h2 { font-size: 28px; line-height: 1.18; letter-spacing: -0.03em; margin: 34px 0 14px; }
    h3 { font-size: 22px; margin: 28px 0 12px; }
    p, li { font-size: 18px; line-height: 1.72; }
    p { margin: 0 0 18px; }
    ul, ol { margin: 0 0 22px 24px; padding: 0; }
    pre { background: #202124; color: #f8fafd; border-radius: 14px; padding: 16px; overflow: auto; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .mdx-card { border: 1px solid #dfe3ea; border-radius: 14px; padding: 14px 16px; margin: 18px 0; background: #f8fafd; color: #5f6368; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; }
  </style></head><body><article>${body}</article></body></html>`;
}

function renderMarkdown(source: string) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;
  let codeLang = "";

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    out.push(`<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (code) {
      if (trimmed.startsWith("```")) {
        out.push(`<pre><code${codeLang ? ` data-lang="${escapeHtml(codeLang)}"` : ""}>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = null;
        codeLang = "";
      } else code.push(raw);
      continue;
    }
    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      code = [];
      codeLang = trimmed.slice(3).trim();
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    if (/^<\/?[A-Z][\s\S]*>$/.test(trimmed) || /^\{[\s\S]*\}$/.test(trimmed) || /^(import|export)\s/.test(trimmed)) {
      flushParagraph();
      flushList();
      out.push(`<div class="mdx-card">${escapeHtml(trimmed)}</div>`);
      continue;
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1]!.length, 3);
      out.push(`<h${level}>${renderInline(heading[2]!)}</h${level}>`);
      continue;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]!);
      continue;
    }
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  if (code) out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  return out.join("\n");
}

function renderInline(value: string) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[ch]!);
}
