import { describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker/index";

type FakeArtifactsRepo = { remote: string; commits: Map<string, Map<string, string | Uint8Array>>; latest?: string };

function fakeArtifacts() {
  const memory = new Map<string, FakeArtifactsRepo>();
  return {
    __memory: memory,
    async create(name: string) {
      const repo = memory.get(name) ?? { remote: `memory://${name}`, commits: new Map<string, Map<string, string | Uint8Array>>() };
      memory.set(name, repo);
      return { name, remote: repo.remote, token: `memory-token-${name}` };
    },
    async get(name: string) {
      if (!memory.has(name)) throw new Error("missing repo");
      return { createToken: async () => ({ plaintext: `memory-token-${name}`, expiresAt: new Date(Date.now() + 600_000).toISOString() }) };
    }
  };
}

type Row = Record<string, any>;
class FakeD1 {
  workspaces: Row[] = [];
  documents: Row[] = [];
  comment_threads: Row[] = [];
  comment_messages: Row[] = [];
  suggestions: Row[] = [];
  changesets: Row[] = [];
  document_versions: Row[] = [];
  document_permissions: Row[] = [];

  prepare(sql: string) {
    const db = this;
    return {
      values: [] as unknown[],
      bind(...values: unknown[]) { this.values = values; return this; },
      async run() { return db.run(sql, this.values); },
      async first<T>() { return db.all(sql, this.values).results[0] as T | null ?? null; },
      async all<T>() { return db.all(sql, this.values) as { results: T[] }; }
    };
  }

  async batch(statements: Array<{ run(): Promise<unknown> }>) {
    return Promise.all(statements.map((statement) => statement.run()));
  }

  run(sql: string, v: unknown[]) {
    if (sql.startsWith("INSERT INTO workspaces")) this.workspaces.push({ id: v[0], name: v[1], slug: v[2], created_by: v[3], created_at: v[4], updated_at: v[5] });
    else if (sql.startsWith("INSERT INTO documents")) this.documents.push({ id: v[0], workspace_id: v[1], title: v[2], format: v[3], status: "active", current_version: v[4], latest_snapshot_key: v[5], latest_tree_key: v[6], latest_source_key: v[7], artifact_repo: v[8], artifact_remote: v[9], artifact_commit: v[10], artifact_manifest_path: v[11], created_by: v[12], created_at: v[13], updated_at: v[14] });
    else if (sql.startsWith("UPDATE documents SET current_version")) Object.assign(this.findDoc(v[9]), { current_version: v[0], latest_source_key: v[1], latest_tree_key: v[2], latest_snapshot_key: v[3], artifact_repo: v[4], artifact_remote: v[5], artifact_commit: v[6], artifact_manifest_path: v[7], updated_at: v[8] });
    else if (sql.startsWith("UPDATE documents SET title")) Object.assign(this.findDoc(v[2]), { title: v[0], updated_at: v[1] });
    else if (sql.startsWith("UPDATE documents SET status")) Object.assign(this.findDoc(v[1]), { status: "deleted", updated_at: v[0] });
    else if (sql.startsWith("INSERT INTO comment_threads")) this.comment_threads.push({ id: v[0], document_id: v[1], author_id: v[2], anchor_json: v[3], anchor_status: "attached", status: "open", created_at: v[4], updated_at: v[5] });
    else if (sql.startsWith("INSERT INTO comment_messages")) this.comment_messages.push({ id: v[0], thread_id: v[1], author_id: v[2], body: v[3], created_at: v[4], updated_at: v[5] });
    else if (sql.startsWith("UPDATE comment_threads SET updated_at")) Object.assign(this.comment_threads.find((r) => r.id === v[1])!, { updated_at: v[0] });
    else if (sql.startsWith("UPDATE comment_threads SET status = 'resolved'")) Object.assign(this.comment_threads.find((r) => r.id === v[3])!, { status: "resolved", anchor_status: "resolved", resolved_by: v[0], resolved_at: v[1], updated_at: v[2] });
    else if (sql.startsWith("UPDATE comment_threads SET status = 'open'")) Object.assign(this.comment_threads.find((r) => r.id === v[1])!, { status: "open", anchor_status: "attached", resolved_by: null, resolved_at: null, updated_at: v[0] });
    else if (sql.startsWith("INSERT OR IGNORE INTO document_versions")) { if (!this.document_versions.some((r) => r.document_id === v[1] && r.version_number === v[2])) this.document_versions.push({ id: v[0], document_id: v[1], version_number: v[2], snapshot_key: v[3], tree_key: v[4], source_key: v[5], artifact_repo: v[6], artifact_commit: v[7], artifact_manifest_path: v[8], created_by: v[9], reason: v[10], created_at: v[11] }); }
    else if (sql.startsWith("INSERT INTO changesets")) this.changesets.push({ id: v[0], document_id: v[1], author_id: v[2], title: v[3], description: v[4], status: "pending", base_version: v[5], created_at: v[6], updated_at: v[7] });
    else if (sql.startsWith("UPDATE changesets SET status")) Object.assign(this.changesets.find((r) => r.id === v[2])!, { status: v[0], updated_at: v[1] });
    else if (sql.startsWith("INSERT INTO suggestions")) this.suggestions.push({ id: v[0], document_id: v[1], changeset_id: v[2], author_id: v[3], type: v[4], anchor_json: v[5], before_json: v[6], after_json: v[7], status: "pending", base_version: v[8], created_at: v[9], updated_at: v[10] });
    else if (sql.startsWith("UPDATE suggestions SET status")) Object.assign(this.suggestions.find((r) => r.id === v[3])!, { status: v[0], conflict_reason: v[1], updated_at: v[2] });
    return { success: true };
  }

  all(sql: string, v: unknown[]) {
    if (sql.startsWith("SELECT * FROM workspaces")) return { results: this.workspaces };
    if (sql.startsWith("SELECT * FROM documents WHERE workspace_id")) return { results: this.documents.filter((d) => d.workspace_id === v[0] && d.status !== "deleted") };
    if (sql.startsWith("SELECT * FROM documents WHERE id")) return { results: this.documents.filter((d) => d.id === v[0] && d.status !== "deleted") };
    if (sql.startsWith("SELECT id, workspace_id")) return { results: this.documents.filter((d) => d.id === v[0] && d.status !== "deleted") };
    if (sql.startsWith("SELECT id FROM documents WHERE workspace_id")) return { results: this.documents.filter((d) => d.workspace_id === v[0] && d.id === v[1] && d.status !== "deleted").map((d) => ({ id: d.id })) };
    if (sql.startsWith("SELECT id FROM documents WHERE id = ? AND created_by")) return { results: this.documents.filter((d) => d.id === v[0] && d.created_by === v[1] && d.status !== "deleted").map((d) => ({ id: d.id })) };
    if (sql.startsWith("SELECT role FROM document_permissions")) return { results: this.document_permissions.filter((p) => p.document_id === v[0] && p.principal_id === v[1]) };
    if (sql.startsWith("SELECT * FROM comment_threads")) return { results: this.comment_threads.filter((c) => c.document_id === v[0] && c.status !== "deleted") };
    if (sql.startsWith("SELECT * FROM comment_messages")) return { results: this.comment_messages.filter((m) => this.comment_threads.some((t) => t.document_id === v[0] && t.id === m.thread_id) && !m.deleted_at) };
    if (sql.startsWith("SELECT * FROM document_versions WHERE document_id = ? AND")) return { results: this.document_versions.filter((r) => r.document_id === v[0] && (r.id === v[1] || String(r.version_number) === v[2])) };
    if (sql.startsWith("SELECT * FROM document_versions")) return { results: this.document_versions.filter((r) => r.document_id === v[0]).sort((a, b) => b.version_number - a.version_number) };
    if (sql.startsWith("SELECT * FROM suggestions")) return { results: this.suggestions.filter((s) => s.document_id === v[0]) };
    if (sql.startsWith("SELECT * FROM changesets")) return { results: this.changesets.filter((c) => c.document_id === v[0]) };
    return { results: [] };
  }

  private findDoc(id: unknown) {
    const doc = this.documents.find((row) => row.id === id);
    if (!doc) throw new Error(`doc not found: ${String(id)}`);
    return doc;
  }
}

function env(): Env {
  return {
    DB: new FakeD1() as never,
    ARTIFACTS: fakeArtifacts() as never,
    DOCUMENT_ROOM: {} as never,
    SNAPSHOT_QUEUE: { send: async () => undefined } as never,
    EXPORT_QUEUE: { send: async () => undefined } as never,
    NOTIFICATION_QUEUE: { send: async () => undefined } as never
  };
}

function ctx(): ExecutionContext {
  return { waitUntil() {}, passThroughOnException() {}, props: {} } as never;
}

async function json(res: Response) { return res.json() as Promise<any>; }

describe("worker integration with local D1/Artifacts fakes", () => {
  it("creates a document and writes source/tree/snapshot artifacts", async () => {
    const e = env();
    await worker.fetch(new Request("http://local/api/v1/workspaces", { method: "POST", body: JSON.stringify({ name: "Acme", slug: "acme" }) }), e, ctx());
    const created = await json(await worker.fetch(new Request("http://local/api/v1/workspaces/ws1/documents", { method: "POST", body: JSON.stringify({ title: "Launch", format: "mdx", source: "# Launch\n" }) }), e, ctx()));
    expect(created.latestSourceKey).toBe("versions/000001/source.mdx");
    expect(created.artifactRepo).toContain("mdxdoc-ws1-");

    const source = await json(await worker.fetch(new Request(`http://local/api/v1/documents/${created.id}/source`), e, ctx()));
    expect(source.source).toBe("# Launch\n");
  });

  it("permission-gates comments and creates first-class comment records", async () => {
    const e = env();
    const created = await json(await worker.fetch(new Request("http://local/api/v1/workspaces/ws1/documents", { method: "POST", body: JSON.stringify({ title: "Launch", format: "mdx" }) }), e, ctx()));
    const denied = await worker.fetch(new Request(`http://local/api/v1/documents/${created.id}/comments`, { method: "POST", headers: { "x-mdxdoc-role": "viewer" }, body: JSON.stringify({ body: "Question", anchor: { kind: "block", nodeId: "node_1" } }) }), e, ctx());
    expect(denied.status).toBe(403);

    const ok = await json(await worker.fetch(new Request(`http://local/api/v1/documents/${created.id}/comments`, { method: "POST", headers: { "x-mdxdoc-role": "commenter" }, body: JSON.stringify({ body: "Question", anchor: { kind: "block", nodeId: "node_1" } }) }), e, ctx()));
    expect(ok.status).toBe("open");
    expect(ok.messages[0].body).toBe("Question");
  });

  it("renames documents through PATCH", async () => {
    const e = env();
    const created = await json(await worker.fetch(new Request("http://local/api/v1/workspaces/ws1/documents", { method: "POST", body: JSON.stringify({ title: "Untitled document", format: "mdx" }) }), e, ctx()));
    const renamed = await json(await worker.fetch(new Request(`http://local/api/v1/documents/${created.id}`, { method: "PATCH", body: JSON.stringify({ title: "Team plan" }) }), e, ctx()));
    expect(renamed.title).toBe("Team plan");
  });

  it("deletes documents with CORS headers and hides them from lists", async () => {
    const e = env();
    const created = await json(await worker.fetch(new Request("http://local/api/v1/workspaces/ws1/documents", { method: "POST", body: JSON.stringify({ title: "Delete me", format: "mdx" }) }), e, ctx()));
    const deleted = await worker.fetch(new Request(`http://local/api/v1/documents/${created.id}`, { method: "DELETE" }), e, ctx());
    expect(deleted.status).toBe(204);
    expect(deleted.headers.get("access-control-allow-origin")).toBe("*");
    const list = await json(await worker.fetch(new Request("http://local/api/v1/workspaces/ws1/documents"), e, ctx()));
    expect(list.items).toHaveLength(0);
  });

  it("creates, lists, accepts, and rejects suggestions", async () => {
    const e = env();
    const created = await json(await worker.fetch(new Request("http://local/api/v1/workspaces/ws1/documents", { method: "POST", body: JSON.stringify({ title: "Suggest", format: "mdx", source: "# Before\n" }) }), e, ctx()));
    const suggestion = await json(await worker.fetch(new Request(`http://local/api/v1/documents/${created.id}/suggestions`, { method: "POST", headers: { "x-mdxdoc-role": "commenter" }, body: JSON.stringify({ type: "replace_document_source", anchor: { kind: "source_range", start: 0, end: 9, quote: "# Before" }, before: "# Before\n", after: "# After\n", baseVersion: 1 }) }), e, ctx()));
    expect(suggestion.status).toBe("pending");
    const list = await json(await worker.fetch(new Request(`http://local/api/v1/documents/${created.id}/suggestions`), e, ctx()));
    expect(list.items).toHaveLength(1);
    const accepted = await json(await worker.fetch(new Request(`http://local/api/v1/suggestions/${suggestion.id}/accept`, { method: "POST" }), e, ctx()));
    expect(accepted.status).toBe("accepted");
    const rejected = await json(await worker.fetch(new Request(`http://local/api/v1/suggestions/${suggestion.id}/reject`, { method: "POST" }), e, ctx()));
    expect(rejected.status).toBe("rejected");
  });

  it("lists versions, checkpoints, and restores versions", async () => {
    const e = env();
    const created = await json(await worker.fetch(new Request("http://local/api/v1/workspaces/ws1/documents", { method: "POST", body: JSON.stringify({ title: "Versions", format: "mdx", source: "# One\n" }) }), e, ctx()));
    let versions = await json(await worker.fetch(new Request(`http://local/api/v1/documents/${created.id}/versions`), e, ctx()));
    expect(versions.items[0].versionNumber).toBe(1);
    const current = await json(await worker.fetch(new Request(`http://local/api/v1/documents/${created.id}/source`), e, ctx()));
    await worker.fetch(new Request(`http://local/api/v1/documents/${created.id}/source`, { method: "PUT", body: JSON.stringify({ baseVersion: current.version, source: "# Two\n" }) }), e, ctx());
    versions = await json(await worker.fetch(new Request(`http://local/api/v1/documents/${created.id}/versions`), e, ctx()));
    expect(versions.items).toHaveLength(2);
    await worker.fetch(new Request(`http://local/api/v1/documents/${created.id}/restore/1`, { method: "POST" }), e, ctx());
    const restored = await json(await worker.fetch(new Request(`http://local/api/v1/documents/${created.id}/source`), e, ctx()));
    expect(restored.source).toBe("# One\n");
    expect(restored.version).toBe(3);
  });

  it("creates and transitions changesets", async () => {
    const e = env();
    const created = await json(await worker.fetch(new Request("http://local/api/v1/workspaces/ws1/documents", { method: "POST", body: JSON.stringify({ title: "Changeset", format: "mdx" }) }), e, ctx()));
    const changeset = await json(await worker.fetch(new Request(`http://local/api/v1/documents/${created.id}/changesets`, { method: "POST", body: JSON.stringify({ title: "Review intro" }) }), e, ctx()));
    expect(changeset.status).toBe("pending");
    const accepted = await json(await worker.fetch(new Request(`http://local/api/v1/changesets/${changeset.id}/accept`, { method: "POST" }), e, ctx()));
    expect(accepted.status).toBe("accepted");
    const rejected = await json(await worker.fetch(new Request(`http://local/api/v1/changesets/${changeset.id}/reject`, { method: "POST" }), e, ctx()));
    expect(rejected.status).toBe("rejected");
  });
});
