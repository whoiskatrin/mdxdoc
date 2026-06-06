import { YServer } from "y-partyserver";
import type { Connection } from "partyserver";
import * as Y from "yjs";
import type { ClientWsEvent, PresenceState } from "@mdxdoc/protocol";
import { ArtifactStore, type ArtifactsBinding } from "../services/artifact-store";

type Env = {
  DB: D1Database;
  ARTIFACTS: ArtifactsBinding;
  SNAPSHOT_QUEUE: Queue;
  EXPORT_QUEUE: Queue;
  NOTIFICATION_QUEUE: Queue;
};

const SNAPSHOT_DEBOUNCE_MS = 2_000;
const SNAPSHOT_MAX_WAIT_MS = 10_000;

export class DocumentRoom extends YServer {
  static callbackOptions = {
    debounceWait: SNAPSHOT_DEBOUNCE_MS,
    debounceMaxWait: SNAPSHOT_MAX_WAIT_MS,
    timeout: 5_000
  };

  private serverSeq = 0;

  async onLoad() {
    const ids = parseRoomName(this.name);
    if (!ids) return;

    const env = getEnv(this);
    const meta = await env.DB.prepare("SELECT latest_snapshot_key, artifact_repo, artifact_remote, artifact_commit FROM documents WHERE id = ? AND workspace_id = ? AND status != 'deleted'")
      .bind(ids.documentId, ids.workspaceId)
      .first<{ latest_snapshot_key: string | null; artifact_repo: string; artifact_remote: string | null; artifact_commit: string | null }>();
    if (!meta?.latest_snapshot_key) return;

    const bytes = await new ArtifactStore(env.ARTIFACTS).readBytes({ repoName: meta.artifact_repo, remote: meta.artifact_remote ?? undefined, commit: meta.artifact_commit ?? undefined, path: meta.latest_snapshot_key });
    if (bytes.byteLength) Y.applyUpdate(this.document, bytes);
  }

  async onSave() {
    const ids = parseRoomName(this.name);
    if (!ids) return;

    const env = getEnv(this);
    const meta = await env.DB.prepare("SELECT artifact_repo, artifact_remote FROM documents WHERE id = ? AND workspace_id = ? AND status != 'deleted'")
      .bind(ids.documentId, ids.workspaceId)
      .first<{ artifact_repo: string; artifact_remote: string | null }>();
    if (!meta?.artifact_repo) return;

    const update = Y.encodeStateAsUpdate(this.document);
    const version = Date.now();
    const snapshotPath = `hot-snapshots/${version}.yjs.bin`;
    const commit = await new ArtifactStore(env.ARTIFACTS).commitFiles({
      repoName: meta.artifact_repo,
      remote: meta.artifact_remote ?? undefined,
      message: `Hot Yjs snapshot ${version}`,
      files: [{ path: snapshotPath, content: update }]
    });
    await env.SNAPSHOT_QUEUE.send({
      jobId: crypto.randomUUID(),
      idempotencyKey: `snapshot:${ids.documentId}:${version}`,
      workspaceId: ids.workspaceId,
      documentId: ids.documentId,
      artifactRepo: commit.repo,
      artifactCommit: commit.commit,
      snapshotPath,
      createdAt: new Date().toISOString()
    });
  }

  onCustomMessage(connection: Connection, message: string): void {
    const parsed = safeJson<ClientWsEvent>(message);
    if (!parsed) return this.sendCustomMessage(connection, JSON.stringify({ type: "error", code: "bad_message", message: "Expected JSON websocket event" }));

    if (parsed.type === "ping") {
      return this.sendCustomMessage(connection, JSON.stringify({ type: "pong" }));
    }

    if (parsed.type === "presence.update") {
      const presence: PresenceState = {
        sessionId: connection.id,
        userId: "local-user" as never,
        name: "Local user",
        cursor: parsed.cursor,
        selection: parsed.selection,
        mode: parsed.mode,
        surface: parsed.surface,
        updatedAt: new Date().toISOString()
      };
      this.broadcastCustomMessage(JSON.stringify({ type: "presence.broadcast", users: [presence], serverSeq: ++this.serverSeq }));
      return;
    }

    this.broadcastCustomMessage(JSON.stringify({ type: "op.ack", serverSeq: ++this.serverSeq, version: Date.now() }));
  }
}

export function parseRoomName(name: string): { workspaceId: string; documentId: string } | null {
  const match = name.match(/^doc:([^:]+):([^:]+)$/);
  if (!match) return null;
  return { workspaceId: match[1]!, documentId: match[2]! };
}

function getEnv(room: DocumentRoom): Env {
  return (room as unknown as { env: Env }).env;
}

function safeJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
