import { Buffer } from "buffer";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";

(globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer ??= Buffer;
import { MemoryFS } from "./memory-fs";

export type ArtifactFile = { path: string; content: string | Uint8Array };
export type ArtifactCommit = { repo: string; remote?: string; commit: string; files: string[] };
export type DocumentArtifactVersion = ArtifactCommit & {
  manifestPath: string;
  sourcePath: string;
  treePath: string;
  snapshotPath: string;
};

export type ArtifactsBinding = {
  create(name: string, opts?: { description?: string; readOnly?: boolean; setDefaultBranch?: string }): Promise<{ name: string; remote: string; token: string; defaultBranch?: string }>;
  get(name: string): Promise<{ createToken(scope?: "read" | "write", ttl?: number): Promise<{ plaintext: string; expiresAt: string }> }>;
  __memory?: Map<string, { remote: string; commits: Map<string, Map<string, string | Uint8Array>>; latest?: string }>;
};

export class ArtifactStore {
  constructor(private readonly artifacts: ArtifactsBinding) {}

  async commitDocumentVersion(input: {
    workspaceId: string;
    documentId: string;
    version: number;
    reason: string;
    source: string;
    treeJson: string;
    snapshot: Uint8Array;
    repoName?: string | undefined;
    remote?: string | undefined;
    author?: { name: string; email: string } | undefined;
  }): Promise<DocumentArtifactVersion> {
    const versionDir = `versions/${String(input.version).padStart(6, "0")}`;
    const sourcePath = `${versionDir}/source.mdx`;
    const treePath = `${versionDir}/tree.json`;
    const snapshotPath = `${versionDir}/snapshot.yjs.bin`;
    const manifestPath = `${versionDir}/manifest.json`;
    const repoName = input.repoName ?? documentArtifactRepoName(input.workspaceId, input.documentId);
    const manifest = JSON.stringify({
      workspaceId: input.workspaceId,
      documentId: input.documentId,
      version: input.version,
      reason: input.reason,
      createdBy: input.author?.name ?? "system",
      createdAt: new Date().toISOString(),
      sourcePath,
      treePath,
      snapshotPath
    }, null, 2);
    const commit = await this.commitFiles({
      repoName,
      remote: input.remote,
      message: `${input.reason}: version ${input.version}`,
      files: [
        { path: sourcePath, content: input.source },
        { path: treePath, content: input.treeJson },
        { path: snapshotPath, content: input.snapshot },
        { path: manifestPath, content: manifest }
      ],
      author: input.author
    });
    return { ...commit, manifestPath, sourcePath, treePath, snapshotPath };
  }

  async commitFiles(input: { repoName: string; remote?: string | undefined; message: string; files: ArtifactFile[]; author?: { name: string; email: string } | undefined }): Promise<ArtifactCommit> {
    if (this.artifacts.__memory instanceof Map) return this.commitToMemory(input);

    const repo = await this.ensureRepo(input.repoName, input.remote);
    const tokenSecret = repo.token.split("?expires=")[0]!;
    const dir = "/workspace";
    const fs = new MemoryFS();

    if (input.remote) {
      await git.clone({ fs, http, dir, url: input.remote, singleBranch: true, depth: 1, onAuth: () => ({ username: "x", password: tokenSecret }) });
    } else {
      await git.init({ fs, dir, defaultBranch: "main" });
    }

    for (const file of input.files) {
      await fs.promises.writeFile(`${dir}/${file.path}`, file.content);
      await git.add({ fs, dir, filepath: file.path });
    }
    const commit = await git.commit({ fs, dir, message: input.message, author: input.author ?? { name: "mdxdoc", email: "system@mdxdoc.local" } });
    await git.push({ fs, http, dir, url: repo.remote, ref: "main", onAuth: () => ({ username: "x", password: tokenSecret }) });
    return { repo: repo.name, remote: repo.remote, commit, files: input.files.map((file) => file.path) };
  }

  async readText(input: { repoName: string; remote?: string | undefined; commit?: string | undefined; path: string }): Promise<string> {
    const bytes = await this.readBytes(input);
    return new TextDecoder().decode(bytes);
  }

  async readBytes(input: { repoName: string; remote?: string | undefined; commit?: string | undefined; path: string }): Promise<Uint8Array> {
    if (this.artifacts.__memory instanceof Map) {
      const repo = this.artifacts.__memory.get(input.repoName);
      const commitId = input.commit ?? repo?.latest;
      const value = commitId ? repo?.commits.get(commitId)?.get(input.path) : undefined;
      if (value === undefined) throw new Error(`Artifact not found: ${input.repoName}:${input.path}`);
      return typeof value === "string" ? new TextEncoder().encode(value) : value;
    }

    if (!input.remote) throw new Error("Artifact remote is required for git reads");
    const repo = await this.artifacts.get(input.repoName);
    const token = await repo.createToken("read", 600);
    const dir = "/workspace";
    const fs = new MemoryFS();
    await git.clone({ fs, http, dir, url: input.remote, singleBranch: true, depth: 1, onAuth: () => ({ username: "x", password: token.plaintext.split("?expires=")[0]! }) });
    if (input.commit) {
      const blob = await git.readBlob({ fs, dir, oid: input.commit, filepath: input.path });
      return blob.blob;
    }
    return await fs.promises.readFile(`${dir}/${input.path}`) as Uint8Array;
  }

  private async ensureRepo(repoName: string, remote?: string | undefined) {
    if (remote) {
      const repo = await this.artifacts.get(repoName);
      const token = await repo.createToken("write", 600);
      return { name: repoName, remote, token: token.plaintext };
    }
    return this.artifacts.create(repoName, { setDefaultBranch: "main", description: "mdxdoc document artifact repo" });
  }

  private async commitToMemory(input: { repoName: string; remote?: string | undefined; message: string; files: ArtifactFile[] }): Promise<ArtifactCommit> {
    const repos = this.artifacts.__memory!;
    const repo = repos.get(input.repoName) ?? { remote: input.remote ?? `memory://${input.repoName}`, commits: new Map<string, Map<string, string | Uint8Array>>() };
    const previous = repo.latest ? repo.commits.get(repo.latest) : undefined;
    const files = new Map(previous ? [...previous.entries()] : []);
    for (const file of input.files) files.set(file.path, file.content);
    const commit = crypto.randomUUID();
    repo.commits.set(commit, files);
    repo.latest = commit;
    repos.set(input.repoName, repo);
    return { repo: input.repoName, remote: repo.remote, commit, files: input.files.map((file) => file.path) };
  }
}

export function documentArtifactRepoName(workspaceId: string, documentId: string) {
  return `mdxdoc-${workspaceId}-${documentId}`.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
}
