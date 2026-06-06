import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const apiUrl = process.env.MDXDOC_CLI_SMOKE_API_URL;
const maybe = apiUrl ? describe : describe.skip;

async function run(args: string[]) {
  const { stdout } = await exec("node", ["apps/cli/bin/mdxdoc.js", "--api-url", apiUrl!, ...args], { cwd: new URL("../../..", import.meta.url).pathname });
  return JSON.parse(stdout);
}

maybe("mdxdoc CLI live smoke", () => {
  it("round-trips docs, source, comments, suggestions, changesets, and versions", async () => {
    const workspaces = await run(["workspaces"]);
    const workspaceId = workspaces.items[0]?.id;
    expect(workspaceId).toBeTruthy();

    const created = await run(["docs", "create", `CLI Smoke ${Date.now()}`, "--workspace", workspaceId]);
    expect(created.id).toBeTruthy();

    const dir = await mkdtemp(join(tmpdir(), "mdxdoc-cli-"));
    const pulled = join(dir, "pulled.mdx");
    await run(["pull", created.id, "--out", pulled]);
    expect(await readFile(pulled, "utf8")).toContain("#");

    const next = join(dir, "next.mdx");
    await writeFile(next, "# CLI smoke update\n");
    const suggestion = await run(["push", created.id, next]);
    expect(suggestion.mode).toBe("changeset");
    expect(suggestion.changeset.id).toBeTruthy();

    const versions = await run(["versions", created.id]);
    expect(versions.items.length).toBeGreaterThan(0);
    await run(["checkpoint", created.id]);

    const comment = await run(["comment", "add", created.id, "--message", "CLI smoke comment", "--quote", "CLI"]);
    expect(comment.id).toBeTruthy();
    await run(["comment", "resolve", comment.id]);

    const changeset = await run(["changeset", "create", created.id, "--title", "CLI smoke changeset"]);
    expect(changeset.id).toBeTruthy();
    await run(["changeset", "reject", changeset.id]);

    await run(["docs", "delete", created.id]);
  }, 60_000);
});
