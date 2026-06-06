import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const cli = ["tsx", "apps/cli/src/index.ts"];

async function run(args: string[]) {
  return exec(cli[0]!, [...cli.slice(1), ...args], { cwd: new URL("../../..", import.meta.url).pathname });
}

describe("mdxdoc CLI smoke", () => {
  it("prints top-level commands", async () => {
    const { stdout } = await run(["--help"]);
    expect(stdout).toContain("docs");
    expect(stdout).toContain("comment");
    expect(stdout).toContain("suggestion");
    expect(stdout).toContain("changeset");
    expect(stdout).toContain("versions");
    expect(stdout).toContain("push");
  });

  it("documents comment, suggestion, and changeset action commands", async () => {
    const comment = await run(["comment", "--help"]);
    expect(comment.stdout).toContain("add");
    expect(comment.stdout).toContain("resolve");
    const suggestion = await run(["suggestion", "--help"]);
    expect(suggestion.stdout).toContain("create");
    expect(suggestion.stdout).toContain("accept");
    expect(suggestion.stdout).toContain("reject");
    const changeset = await run(["changeset", "--help"]);
    expect(changeset.stdout).toContain("create");
    expect(changeset.stdout).toContain("accept");
    expect(changeset.stdout).toContain("reject");
  });
});
