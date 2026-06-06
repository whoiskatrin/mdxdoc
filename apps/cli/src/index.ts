#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { MdxdocClient } from "@mdxdoc/sdk-js";

const EXIT = { OK: 0, API: 10 } as const;
const DEFAULT_API_URL = "https://mdxdoc-api.agents-b8a.workers.dev";
type GlobalOpts = { apiUrl?: string; token?: string; json?: boolean };
type CliConfig = { apiUrl?: string; token?: string; userId?: string; defaultWorkspaceId?: string };

const program = new Command();
program
  .name("mdxdoc")
  .description("Collaborative Markdown/MDX docs CLI")
  .option("--api-url <url>", "API URL")
  .option("--token <token>", "API token")
  .option("--json", "Print JSON output", true);

program.command("health").description("Check API health").action(async () => output(await client().health()));
program.command("login").description("Store API URL/token in config").option("--api-url <url>", "API URL", DEFAULT_API_URL).option("--token <token>", "API token", "local-dev-token").option("--user <user>", "User id", "local-user").action(async (opts) => {
  await saveConfig({ ...loadConfigSync(), apiUrl: opts.apiUrl, token: opts.token, userId: opts.user });
  output({ ok: true, apiUrl: opts.apiUrl, userId: opts.user });
});
program.command("logout").description("Clear local config").action(async () => { await saveConfig({}); output({ ok: true }); });
program.command("whoami").description("Show active CLI identity/config").action(() => {
  const config = loadConfigSync();
  output({ userId: config.userId ?? "local-user", apiUrl: globals().apiUrl ?? config.apiUrl ?? DEFAULT_API_URL, authenticated: Boolean(globals().token ?? config.token), defaultWorkspaceId: config.defaultWorkspaceId ?? null });
});
program.command("workspaces").description("List workspaces").action(async () => output(await client().workspaces.list()));

const docs = program.command("docs").description("Document commands");
docs.command("list").option("--workspace <workspace>", "Workspace id").action(async (opts) => output(await client().docs.list(await workspaceId(opts.workspace))));
docs.command("create").argument("<title>").option("--workspace <workspace>", "Workspace id").option("--format <format>", "md or mdx", "mdx").option("--source <file>", "Source file to import").action(async (title, opts) => {
  const source = opts.source ? await readFile(opts.source, "utf8") : undefined;
  output(await client().docs.create(await workspaceId(opts.workspace), { title, format: opts.format, ...(source ? { source } : {}) }));
});
docs.command("get").argument("doc").action(async (doc) => output(await client().docs.get(doc)));
docs.command("rename").argument("doc").argument("title").action(async (doc, title) => output(await client().docs.update(doc, { title })));
docs.command("delete").argument("doc").alias("remove").action(async (doc) => { await client().docs.delete(doc); output({ ok: true, documentId: doc }); });

program.command("pull").argument("doc").requiredOption("--out <file>").description("Write document source to a local file").action(async (doc, opts) => {
  const res = await client().docs.source(doc);
  await writeFile(opts.out, res.source);
  output({ ok: true, out: opts.out, version: res.version });
});

program.command("push").argument("doc").argument("file").option("--title <title>", "Changeset title").option("--apply", "Directly apply instead of creating a reviewable changeset").description("Safe default: create a changeset + suggestion. Use --apply for direct overwrite.").action(async (doc, file, opts) => {
  const source = await readFile(file, "utf8");
  const current = await client().docs.source(doc);
  if (opts.apply) return output(await client().docs.putSource(doc, { baseVersion: current.version, source }));
  output(await proposeSourceChange(doc, source, current.source, current.version, opts.title ?? `CLI push ${new Date().toLocaleString()}`));
});

program.command("propose").argument("doc").argument("file").option("--title <title>", "Changeset title").option("--description <description>").description("Create a reviewable changeset from a local file").action(async (doc, file, opts) => {
  const source = await readFile(file, "utf8");
  const current = await client().docs.source(doc);
  output(await proposeSourceChange(doc, source, current.source, current.version, opts.title ?? "CLI proposal", opts.description));
});

program.command("import").argument("file").option("--workspace <workspace>", "Workspace id").option("--title <title>").action(async (file, opts) => {
  const source = await readFile(file, "utf8");
  const title = opts.title ?? file.split(/[\\/]/).pop()?.replace(/\.mdx?$/, "") ?? "Imported document";
  output(await client().docs.create(await workspaceId(opts.workspace), { title, format: file.endsWith(".md") ? "md" : "mdx", source }));
});
program.command("export").argument("doc").option("--format <format>", "md or mdx", "mdx").requiredOption("--out <file>").description("Export through GET /documents/:id/export").action(async (doc, opts) => {
  const res = await client().docs.export(doc, opts.format);
  await writeFile(opts.out, res.source);
  output({ ok: true, out: opts.out, version: res.version, format: res.format });
});
program.command("preview").argument("doc").option("--out <file>", "Write preview HTML to a file").description("Render document preview HTML").action(async (doc, opts) => {
  const res = await client().docs.preview(doc) as { html: string };
  if (opts.out) {
    await writeFile(opts.out, res.html);
    output({ ok: true, out: opts.out });
  } else output(res);
});

program.command("comments").argument("doc").description("List comments").action(async (doc) => output(await client().docs.comments(doc)));
const comment = program.command("comment").description("Comment actions");
comment.command("add").argument("doc").requiredOption("--message <message>").option("--quote <quote>").action(async (doc, opts) => {
  const anchor = opts.quote ? await sourceQuoteAnchor(doc, opts.quote) : { kind: "block", nodeId: "document" };
  output(await client().docs.createComment(doc, { body: opts.message, anchor }));
});
comment.command("resolve").argument("commentId").action(async (commentId) => output(await client().docs.resolveComment(commentId)));

program.command("suggestions").argument("doc").description("List suggestions").action(async (doc) => output(await client().docs.suggestions(doc)));
const suggestion = program.command("suggestion").description("Suggestion actions");
suggestion.command("create").argument("doc").argument("file").option("--title <title>").action(async (doc, file, opts) => {
  const source = await readFile(file, "utf8");
  const current = await client().docs.source(doc);
  output(await proposeSourceChange(doc, source, current.source, current.version, opts.title ?? "CLI suggestion"));
});
suggestion.command("accept").argument("suggestionId").action(async (suggestionId) => output(await client().docs.acceptSuggestion(suggestionId)));
suggestion.command("reject").argument("suggestionId").action(async (suggestionId) => output(await client().docs.rejectSuggestion(suggestionId)));

program.command("changesets").argument("doc").description("List changesets").action(async (doc) => output(await client().docs.changesets(doc)));
const changeset = program.command("changeset").description("Changeset actions");
changeset.command("create").argument("doc").option("--title <title>").option("--description <description>").action(async (doc, opts) => output(await client().docs.createChangeset(doc, { title: opts.title, description: opts.description })));
changeset.command("accept").argument("changesetId").action(async (changesetId) => output(await client().docs.acceptChangeset(changesetId)));
changeset.command("reject").argument("changesetId").action(async (changesetId) => output(await client().docs.rejectChangeset(changesetId)));
program.command("versions").argument("doc").description("List versions").action(async (doc) => output(await client().docs.versions(doc)));
program.command("checkpoint").argument("doc").description("Create a manual checkpoint").action(async (doc) => output(await client().docs.checkpoint(doc)));
program.command("restore").argument("doc").argument("version").description("Restore version").action(async (doc, version) => output(await client().docs.restore(doc, version)));

program.exitOverride();
program.parseAsync().catch((error) => {
  console.error(error.message);
  process.exitCode = error.code === "commander.helpDisplayed" ? EXIT.OK : EXIT.API;
});

async function proposeSourceChange(doc: string, source: string, before: string, baseVersion: number, title: string, description?: string) {
  const changeset = await client().docs.createChangeset(doc, { title, baseVersion, ...(description ? { description } : {}) });
  const changesetId = String((changeset as { id?: unknown }).id);
  const suggestion = await client().docs.createSuggestion(doc, { changesetId, type: "replace_document_source", anchor: { kind: "source_range", start: 0, end: before.length, quote: "document" }, before, after: source, baseVersion });
  return { ok: true, mode: "changeset", changeset, suggestion };
}

async function sourceQuoteAnchor(doc: string, quote: string) {
  const source = await client().docs.source(doc);
  const start = source.source.indexOf(quote);
  return { kind: "source_range", start: Math.max(0, start), end: start >= 0 ? start + quote.length : 0, quote };
}

async function workspaceId(explicit?: string) {
  if (explicit) return explicit;
  const config = loadConfigSync();
  if (config.defaultWorkspaceId) return config.defaultWorkspaceId;
  const workspaces = await client().workspaces.list();
  const first = workspaces.items[0] as { id?: string } | undefined;
  if (!first?.id) throw new Error("No workspace found. Create one through the API or pass --workspace.");
  return first.id;
}

function globals(): GlobalOpts { return program.opts<GlobalOpts>(); }
function client(): MdxdocClient {
  const config = loadConfigSync();
  const opts = globals();
  const token = opts.token ?? config.token;
  return new MdxdocClient({ apiUrl: opts.apiUrl ?? config.apiUrl ?? DEFAULT_API_URL, ...(token ? { token } : {}) });
}
function output(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}
function loadConfigSync(): CliConfig {
  try { return existsSync(configPath()) ? JSON.parse(readFileSync(configPath(), "utf8")) as CliConfig : {}; }
  catch { return {}; }
}
async function saveConfig(config: CliConfig) {
  await mkdir(dirname(configPath()), { recursive: true });
  await writeFile(configPath(), JSON.stringify(config, null, 2));
}
function configPath() { return join(homedir(), ".config", "mdxdoc", "config.json"); }
