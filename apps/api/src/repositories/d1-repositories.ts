import type { Anchor, ChangeSet, CommentThread, EffectiveRole, Suggestion, SuggestionType } from "@mdxdoc/protocol";

type Db = D1Database;

export type CreateCommentInput = {
  documentId: string;
  authorId: string;
  anchor: Anchor;
  body: string;
};

export type CreateSuggestionInput = {
  documentId: string;
  authorId: string;
  changesetId?: string;
  type: SuggestionType;
  anchor: Anchor;
  before?: unknown;
  after?: unknown;
  baseVersion: number;
};

export class D1AuthRepository {
  constructor(private readonly db: Db) {}

  async createServiceAccount(input: { id: string; workspaceId: string; name: string; createdBy: string; now: string }) {
    await this.db.prepare("INSERT INTO service_accounts (id, workspace_id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(input.id, input.workspaceId, input.name, input.createdBy, input.now, input.now)
      .run();
    return { id: input.id, workspaceId: input.workspaceId, name: input.name, createdBy: input.createdBy, createdAt: input.now, updatedAt: input.now };
  }

  async createToken(input: { id: string; principalType: "service_account" | "user"; principalId: string; tokenHash: string; name: string; scopes: string[]; expiresAt?: string; now: string }) {
    await this.db.prepare("INSERT INTO api_tokens (id, principal_type, principal_id, token_hash, name, scopes_json, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(input.id, input.principalType, input.principalId, input.tokenHash, input.name, JSON.stringify(input.scopes), input.expiresAt ?? null, input.now)
      .run();
    return { id: input.id, principalType: input.principalType, principalId: input.principalId, name: input.name, scopes: input.scopes, ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}), createdAt: input.now };
  }

  async findToken(tokenHash: string) {
    const token = await this.db.prepare("SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)")
      .bind(tokenHash, new Date().toISOString())
      .first<Record<string, string | null>>();
    if (!token) return null;
    await this.db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").bind(new Date().toISOString(), token.id).run();
    if (token.principal_type === "service_account") {
      const account = await this.db.prepare("SELECT * FROM service_accounts WHERE id = ? AND disabled_at IS NULL").bind(token.principal_id).first<Record<string, string | null>>();
      if (!account) return null;
      return { tokenId: String(token.id), principalType: "service_account" as const, principalId: String(account.id), name: String(account.name), workspaceId: String(account.workspace_id), scopes: JSON.parse(String(token.scopes_json)) as string[], ...(token.expires_at ? { expiresAt: String(token.expires_at) } : {}) };
    }
    return { tokenId: String(token.id), principalType: "user" as const, principalId: String(token.principal_id), name: String(token.name), workspaceId: undefined, scopes: JSON.parse(String(token.scopes_json)) as string[], ...(token.expires_at ? { expiresAt: String(token.expires_at) } : {}) };
  }
}

export class D1WorkspaceRepository {
  constructor(private readonly db: Db) {}

  list() {
    return this.db.prepare("SELECT * FROM workspaces ORDER BY updated_at DESC").all().then((r) => r.results);
  }

  async create(input: { id: string; name: string; slug: string; createdBy: string; now: string }) {
    await this.db.prepare("INSERT INTO workspaces (id, name, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(input.id, input.name, input.slug, input.createdBy, input.now, input.now)
      .run();
  }
}

export class D1DocumentRepository {
  constructor(private readonly db: Db) {}

  list(workspaceId: string) {
    return this.db.prepare("SELECT * FROM documents WHERE workspace_id = ? AND status != 'deleted' ORDER BY updated_at DESC").bind(workspaceId).all().then((r) => r.results);
  }

  get(id: string) {
    return this.db.prepare("SELECT * FROM documents WHERE id = ? AND status != 'deleted'").bind(id).first<Record<string, unknown>>();
  }

  getForSource(id: string) {
    return this.db.prepare("SELECT id, workspace_id, format, current_version, latest_source_key, latest_tree_key, latest_snapshot_key, artifact_repo, artifact_remote, artifact_commit, artifact_manifest_path FROM documents WHERE id = ? AND status != 'deleted'")
      .bind(id)
      .first<{ id: string; workspace_id: string; format: "md" | "mdx"; current_version: number; latest_source_key: string | null; latest_tree_key: string | null; latest_snapshot_key: string | null; artifact_repo: string; artifact_remote: string | null; artifact_commit: string; artifact_manifest_path: string }>();
  }

  async create(input: { id: string; workspaceId: string; title: string; format: "md" | "mdx"; version: number; sourceKey: string; treeKey: string; snapshotKey: string; artifactRepo: string; artifactRemote?: string | undefined; artifactCommit: string; artifactManifestPath: string; createdBy: string; now: string }) {
    await this.db.prepare("INSERT INTO documents (id, workspace_id, title, format, status, current_version, latest_snapshot_key, latest_tree_key, latest_source_key, artifact_repo, artifact_remote, artifact_commit, artifact_manifest_path, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(input.id, input.workspaceId, input.title, input.format, input.version, input.snapshotKey, input.treeKey, input.sourceKey, input.artifactRepo, input.artifactRemote ?? null, input.artifactCommit, input.artifactManifestPath, input.createdBy, input.now, input.now)
      .run();
  }

  async updateArtifacts(input: { id: string; version: number; sourceKey: string; treeKey: string; snapshotKey: string; artifactRepo: string; artifactRemote?: string | undefined; artifactCommit: string; artifactManifestPath: string; now: string }) {
    await this.db.prepare("UPDATE documents SET current_version = ?, latest_source_key = ?, latest_tree_key = ?, latest_snapshot_key = ?, artifact_repo = ?, artifact_remote = ?, artifact_commit = ?, artifact_manifest_path = ?, updated_at = ? WHERE id = ?")
      .bind(input.version, input.sourceKey, input.treeKey, input.snapshotKey, input.artifactRepo, input.artifactRemote ?? null, input.artifactCommit, input.artifactManifestPath, input.now, input.id)
      .run();
  }

  async patchTitle(id: string, title: string, now: string) {
    await this.db.prepare("UPDATE documents SET title = ?, updated_at = ? WHERE id = ?").bind(title, now, id).run();
  }

  async archive(id: string, now: string) {
    await this.db.prepare("UPDATE documents SET status = 'deleted', updated_at = ? WHERE id = ?").bind(now, id).run();
  }
}

export class D1PermissionRepository {
  constructor(private readonly db: Db) {}

  async effectiveRole(documentId: string, userId: string): Promise<EffectiveRole> {
    const explicit = await this.db.prepare("SELECT role FROM document_permissions WHERE document_id = ? AND principal_type = 'user' AND principal_id = ?")
      .bind(documentId, userId)
      .first<{ role: EffectiveRole }>();
    if (explicit?.role) return explicit.role;
    const owner = await this.db.prepare("SELECT id FROM documents WHERE id = ? AND created_by = ? AND status != 'deleted'")
      .bind(documentId, userId)
      .first<{ id: string }>();
    if (owner) return "owner";
    return "owner"; // no-auth prototype fallback; replace with workspace membership in hardening phase.
  }
}

export class D1CommentRepository {
  constructor(private readonly db: Db) {}

  async list(documentId: string): Promise<CommentThread[]> {
    const threads = await this.db.prepare("SELECT * FROM comment_threads WHERE document_id = ? AND status != 'deleted' ORDER BY updated_at DESC").bind(documentId).all<Record<string, string>>();
    const messages = await this.db.prepare("SELECT * FROM comment_messages WHERE thread_id IN (SELECT id FROM comment_threads WHERE document_id = ?) AND deleted_at IS NULL ORDER BY created_at ASC").bind(documentId).all<Record<string, string>>();
    const byThread = new Map<string, Record<string, string>[]>();
    for (const msg of messages.results) byThread.set(msg.thread_id!, [...(byThread.get(msg.thread_id!) ?? []), msg]);
    return threads.results.map((row) => ({
      id: row.id!,
      documentId: row.document_id! as never,
      authorId: row.author_id! as never,
      anchor: JSON.parse(row.anchor_json!) as Anchor,
      anchorStatus: row.anchor_status! as CommentThread["anchorStatus"],
      status: row.status! as CommentThread["status"],
      messages: (byThread.get(row.id!) ?? []).map((msg) => ({ id: msg.id!, threadId: msg.thread_id!, authorId: msg.author_id! as never, body: msg.body!, createdAt: msg.created_at!, updatedAt: msg.updated_at!, ...(msg.deleted_at ? { deletedAt: msg.deleted_at } : {}) })),
      createdAt: row.created_at!,
      updatedAt: row.updated_at!
    }));
  }

  async create(input: CreateCommentInput): Promise<CommentThread> {
    const now = new Date().toISOString();
    const threadId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    await this.db.batch([
      this.db.prepare("INSERT INTO comment_threads (id, document_id, author_id, anchor_json, anchor_status, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'attached', 'open', ?, ?)")
        .bind(threadId, input.documentId, input.authorId, JSON.stringify(input.anchor), now, now),
      this.db.prepare("INSERT INTO comment_messages (id, thread_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(messageId, threadId, input.authorId, input.body, now, now)
    ]);
    return (await this.list(input.documentId)).find((thread) => thread.id === threadId)!;
  }

  async addMessage(threadId: string, authorId: string, body: string) {
    const now = new Date().toISOString();
    await this.db.prepare("INSERT INTO comment_messages (id, thread_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), threadId, authorId, body, now, now)
      .run();
    await this.db.prepare("UPDATE comment_threads SET updated_at = ? WHERE id = ?").bind(now, threadId).run();
  }

  async resolve(threadId: string, userId: string) {
    const now = new Date().toISOString();
    await this.db.prepare("UPDATE comment_threads SET status = 'resolved', anchor_status = 'resolved', resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?")
      .bind(userId, now, now, threadId)
      .run();
  }

  async reopen(threadId: string) {
    const now = new Date().toISOString();
    await this.db.prepare("UPDATE comment_threads SET status = 'open', anchor_status = 'attached', resolved_by = NULL, resolved_at = NULL, updated_at = ? WHERE id = ?")
      .bind(now, threadId)
      .run();
  }
}

export class D1SuggestionRepository {
  constructor(private readonly db: Db) {}

  async list(documentId: string): Promise<Suggestion[]> {
    const rows = await this.db.prepare("SELECT * FROM suggestions WHERE document_id = ? ORDER BY updated_at DESC").bind(documentId).all<Record<string, string | number | null>>();
    return rows.results.map(suggestionRow);
  }

  async listForChangeset(changesetId: string): Promise<Suggestion[]> {
    const rows = await this.db.prepare("SELECT * FROM suggestions WHERE changeset_id = ? ORDER BY created_at ASC").bind(changesetId).all<Record<string, string | number | null>>();
    return rows.results.map(suggestionRow);
  }

  async get(id: string): Promise<Suggestion | null> {
    const row = await this.db.prepare("SELECT * FROM suggestions WHERE id = ?").bind(id).first<Record<string, string | number | null>>();
    return row ? suggestionRow(row) : null;
  }

  async create(input: CreateSuggestionInput): Promise<Suggestion> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await this.db.prepare("INSERT INTO suggestions (id, document_id, changeset_id, author_id, type, anchor_json, before_json, after_json, status, base_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)")
      .bind(id, input.documentId, input.changesetId ?? null, input.authorId, input.type, JSON.stringify(input.anchor), input.before === undefined ? null : JSON.stringify(input.before), input.after === undefined ? null : JSON.stringify(input.after), input.baseVersion, now, now)
      .run();
    return (await this.list(input.documentId)).find((suggestion) => suggestion.id === id)!;
  }

  async setStatus(id: string, status: Suggestion["status"], conflictReason?: string) {
    await this.db.prepare("UPDATE suggestions SET status = ?, conflict_reason = ?, updated_at = ? WHERE id = ?")
      .bind(status, conflictReason ?? null, new Date().toISOString(), id)
      .run();
  }
}

function suggestionRow(row: Record<string, string | number | null>): Suggestion {
  return {
    id: row.id as never,
    documentId: row.document_id as never,
    authorId: row.author_id as never,
    ...(row.changeset_id ? { changesetId: row.changeset_id as never } : {}),
    type: row.type as SuggestionType,
    anchor: JSON.parse(String(row.anchor_json)) as Anchor,
    ...(row.before_json ? { before: JSON.parse(String(row.before_json)) as unknown } : {}),
    ...(row.after_json ? { after: JSON.parse(String(row.after_json)) as unknown } : {}),
    status: row.status as Suggestion["status"],
    ...(row.conflict_reason ? { conflictReason: String(row.conflict_reason) } : {}),
    baseVersion: Number(row.base_version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export class D1ChangesetRepository {
  constructor(private readonly db: Db) {}

  async list(documentId: string): Promise<ChangeSet[]> {
    const rows = await this.db.prepare("SELECT * FROM changesets WHERE document_id = ? ORDER BY updated_at DESC").bind(documentId).all<Record<string, string | number>>();
    const suggestions = await this.db.prepare("SELECT id, changeset_id FROM suggestions WHERE document_id = ? AND changeset_id IS NOT NULL").bind(documentId).all<Record<string, string>>();
    const byChangeset = new Map<string, string[]>();
    for (const suggestion of suggestions.results) if (suggestion.changeset_id && suggestion.id) byChangeset.set(suggestion.changeset_id, [...(byChangeset.get(suggestion.changeset_id) ?? []), suggestion.id]);
    return rows.results.map((row) => changesetRow(row, byChangeset.get(String(row.id)) ?? []));
  }

  async get(id: string): Promise<ChangeSet | null> {
    const row = await this.db.prepare("SELECT * FROM changesets WHERE id = ?").bind(id).first<Record<string, string | number>>();
    if (!row) return null;
    const suggestions = await this.db.prepare("SELECT id FROM suggestions WHERE changeset_id = ? ORDER BY created_at ASC").bind(id).all<Record<string, string>>();
    return changesetRow(row, suggestions.results.map((suggestion) => suggestion.id).filter((value): value is string => Boolean(value)));
  }

  async create(input: { id: string; documentId: string; authorId: string; title: string; description?: string; baseVersion: number; now: string }) {
    await this.db.prepare("INSERT INTO changesets (id, document_id, author_id, title, description, status, base_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)")
      .bind(input.id, input.documentId, input.authorId, input.title, input.description ?? null, input.baseVersion, input.now, input.now)
      .run();
    return { id: input.id, documentId: input.documentId, authorId: input.authorId, title: input.title, ...(input.description ? { description: input.description } : {}), suggestionIds: [], status: "pending" as const, baseVersion: input.baseVersion, createdAt: input.now, updatedAt: input.now };
  }

  async setStatus(id: string, status: ChangeSet["status"], now: string) {
    await this.db.prepare("UPDATE changesets SET status = ?, updated_at = ? WHERE id = ?").bind(status, now, id).run();
  }
}

function changesetRow(row: Record<string, string | number>, suggestionIds: string[]): ChangeSet {
  return { id: row.id as never, documentId: row.document_id as never, authorId: row.author_id as never, title: String(row.title), ...(row.description ? { description: String(row.description) } : {}), suggestionIds: suggestionIds as never[], status: row.status as ChangeSet["status"], baseVersion: Number(row.base_version), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export class D1VersionRepository {
  constructor(private readonly db: Db) {}

  async list(documentId: string) {
    return this.db.prepare("SELECT * FROM document_versions WHERE document_id = ? ORDER BY version_number DESC")
      .bind(documentId)
      .all<Record<string, string | number | null>>()
      .then((rows) => rows.results.map(versionRow));
  }

  async get(documentId: string, versionId: string) {
    const rows = await this.db.prepare("SELECT * FROM document_versions WHERE document_id = ? AND (id = ? OR CAST(version_number AS TEXT) = ?)")
      .bind(documentId, versionId, versionId)
      .all<Record<string, string | number | null>>();
    return rows.results[0] ? versionRow(rows.results[0]) : null;
  }

  async create(input: { id: string; documentId: string; versionNumber: number; snapshotKey: string; treeKey: string; sourceKey: string; artifactRepo: string; artifactCommit: string; artifactManifestPath: string; createdBy: string; reason: string; now: string }) {
    await this.db.prepare("INSERT OR IGNORE INTO document_versions (id, document_id, version_number, snapshot_key, tree_key, source_key, artifact_repo, artifact_commit, artifact_manifest_path, created_by, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(input.id, input.documentId, input.versionNumber, input.snapshotKey, input.treeKey, input.sourceKey, input.artifactRepo, input.artifactCommit, input.artifactManifestPath, input.createdBy, input.reason, input.now)
      .run();
    return { id: input.id, documentId: input.documentId, versionNumber: input.versionNumber, snapshotKey: input.snapshotKey, treeKey: input.treeKey, sourceKey: input.sourceKey, artifactRepo: input.artifactRepo, artifactCommit: input.artifactCommit, artifactManifestPath: input.artifactManifestPath, createdBy: input.createdBy, reason: input.reason, createdAt: input.now };
  }
}

function versionRow(row: Record<string, string | number | null>) {
  return { id: String(row.id), documentId: String(row.document_id), versionNumber: Number(row.version_number), snapshotKey: String(row.snapshot_key), treeKey: String(row.tree_key), sourceKey: String(row.source_key), artifactRepo: String(row.artifact_repo ?? ""), artifactCommit: String(row.artifact_commit ?? ""), artifactManifestPath: String(row.artifact_manifest_path ?? ""), createdBy: String(row.created_by), reason: String(row.reason), createdAt: String(row.created_at) };
}
