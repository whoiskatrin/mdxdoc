import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const requiredPaths = [
  ["get", "/workspaces"],
  ["post", "/workspaces"],
  ["get", "/workspaces/{workspaceId}/documents"],
  ["post", "/workspaces/{workspaceId}/documents"],
  ["get", "/documents/{documentId}"],
  ["patch", "/documents/{documentId}"],
  ["delete", "/documents/{documentId}"],
  ["get", "/documents/{documentId}/source"],
  ["put", "/documents/{documentId}/source"],
  ["post", "/documents/{documentId}/preview"],
  ["get", "/documents/{documentId}/comments"],
  ["post", "/documents/{documentId}/comments"],
  ["post", "/comments/{commentId}/resolve"],
  ["get", "/documents/{documentId}/suggestions"],
  ["post", "/documents/{documentId}/suggestions"],
  ["post", "/suggestions/{suggestionId}/accept"],
  ["post", "/suggestions/{suggestionId}/reject"],
  ["get", "/documents/{documentId}/changesets"],
  ["post", "/documents/{documentId}/changesets"],
  ["post", "/changesets/{changesetId}/accept"],
  ["post", "/changesets/{changesetId}/reject"],
  ["get", "/documents/{documentId}/versions"],
  ["post", "/documents/{documentId}/versions"],
  ["post", "/documents/{documentId}/restore/{versionId}"]
] as const;

describe("OpenAPI contract", () => {
  it("documents every implemented UI/API route used by the MVP", async () => {
    const spec = YAML.parse(await readFile("openapi/openapi.yaml", "utf8"));
    expect(spec.openapi).toBe("3.1.0");
    for (const [method, path] of requiredPaths) {
      expect(spec.paths?.[path]?.[method], `${method.toUpperCase()} ${path}`).toBeTruthy();
    }
  });

  it("defines request schemas for mutating routes", async () => {
    const spec = YAML.parse(await readFile("openapi/openapi.yaml", "utf8"));
    for (const name of ["CreateWorkspaceRequest", "CreateDocumentRequest", "PatchDocumentRequest", "PutSourceRequest", "CreateCommentRequest", "CreateSuggestionRequest", "CreateChangesetRequest"]) {
      expect(spec.components?.schemas?.[name], name).toBeTruthy();
    }
  });
});
