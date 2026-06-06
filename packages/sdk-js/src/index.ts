import type { CreateDocumentRequest, CreateWorkspaceRequest, HealthResponse, PutSourceRequest, SourceResponse } from "@mdxdoc/protocol";

export type MdxdocClientOptions = {
  apiUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
};

export class MdxdocClient {
  private readonly apiUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MdxdocClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  health(): Promise<HealthResponse> {
    return this.request("/health", { apiPrefix: false });
  }

  workspaces = {
    list: () => this.request<{ items: unknown[] }>("/workspaces"),
    create: (body: CreateWorkspaceRequest) => this.request("/workspaces", { method: "POST", body })
  };

  docs = {
    list: (workspaceId: string) => this.request<{ items: unknown[] }>(`/workspaces/${workspaceId}/documents`),
    create: (workspaceId: string, body: CreateDocumentRequest) => this.request(`/workspaces/${workspaceId}/documents`, { method: "POST", body }),
    get: (documentId: string) => this.request(`/documents/${documentId}`),
    update: (documentId: string, body: { title?: string }) => this.request(`/documents/${documentId}`, { method: "PATCH", body }),
    delete: (documentId: string) => this.request<void>(`/documents/${documentId}`, { method: "DELETE" }),
    source: (documentId: string) => this.request<SourceResponse>(`/documents/${documentId}/source`),
    putSource: (documentId: string, body: PutSourceRequest) => this.request<SourceResponse>(`/documents/${documentId}/source`, { method: "PUT", body }),
    tree: (documentId: string) => this.request(`/documents/${documentId}/tree`),
    preview: (documentId: string) => this.request(`/documents/${documentId}/preview`, { method: "POST" }),
    session: (documentId: string) => this.request<{ host: string; prefix: string; party: string; room: string }>(`/documents/${documentId}/session`),
    comments: (documentId: string) => this.request<{ items: unknown[] }>(`/documents/${documentId}/comments`),
    createComment: (documentId: string, body: { body: string; anchor: unknown }) => this.request(`/documents/${documentId}/comments`, { method: "POST", body }),
    resolveComment: (commentThreadId: string) => this.request(`/comments/${commentThreadId}/resolve`, { method: "POST" }),
    suggestions: (documentId: string) => this.request<{ items: unknown[] }>(`/documents/${documentId}/suggestions`),
    createSuggestion: (documentId: string, body: { type: string; anchor: unknown; before?: unknown; after?: unknown; baseVersion: number }) => this.request(`/documents/${documentId}/suggestions`, { method: "POST", body }),
    acceptSuggestion: (suggestionId: string) => this.request(`/suggestions/${suggestionId}/accept`, { method: "POST" }),
    rejectSuggestion: (suggestionId: string) => this.request(`/suggestions/${suggestionId}/reject`, { method: "POST" }),
    changesets: (documentId: string) => this.request<{ items: unknown[] }>(`/documents/${documentId}/changesets`),
    createChangeset: (documentId: string, body: { title?: string; description?: string; baseVersion?: number }) => this.request(`/documents/${documentId}/changesets`, { method: "POST", body }),
    acceptChangeset: (changesetId: string) => this.request(`/changesets/${changesetId}/accept`, { method: "POST" }),
    rejectChangeset: (changesetId: string) => this.request(`/changesets/${changesetId}/reject`, { method: "POST" }),
    versions: (documentId: string) => this.request<{ items: unknown[] }>(`/documents/${documentId}/versions`),
    checkpoint: (documentId: string) => this.request(`/documents/${documentId}/versions`, { method: "POST" }),
    restore: (documentId: string, versionId: string) => this.request<SourceResponse>(`/documents/${documentId}/restore/${versionId}`, { method: "POST" })
  };

  private async request<T>(path: string, init: { method?: string; body?: unknown; apiPrefix?: boolean } = {}): Promise<T> {
    const url = `${this.apiUrl}${init.apiPrefix === false ? path : `/api/v1${path}`}`;
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const requestInit: RequestInit = { method: init.method ?? "GET", headers };
    if (init.body !== undefined) requestInit.body = JSON.stringify(init.body);
    const res = await this.fetchImpl(url, requestInit);
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const message = data?.error?.message ?? `HTTP ${res.status}`;
      throw new MdxdocApiError(message, res.status, data);
    }
    return data as T;
  }
}

export class MdxdocApiError extends Error {
  constructor(message: string, readonly status: number, readonly payload: unknown) {
    super(message);
    this.name = "MdxdocApiError";
  }
}
