import { expect, test, type Page } from "@playwright/test";

const unique = (prefix: string) => `${prefix} ${Date.now()} ${Math.random().toString(36).slice(2, 7)}`;
const diagnostics = new WeakMap<Page, { consoleErrors: string[]; requestFailures: string[] }>();

test.beforeEach(async ({ page }) => {
  const state = { consoleErrors: [] as string[], requestFailures: [] as string[] };
  diagnostics.set(page, state);
  page.on("console", (message) => {
    if (message.type() === "error") state.consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    const errorText = request.failure()?.errorText ?? "failed";
    if (errorText === "net::ERR_ABORTED") return;
    if (url.includes("/api/") || url.startsWith("wss://") || url.startsWith("ws://")) {
      state.requestFailures.push(`${request.method()} ${url}: ${errorText}`);
    }
  });
});

test.afterEach(async ({ page }) => {
  const state = diagnostics.get(page);
  expect.soft(state?.consoleErrors ?? [], "browser console errors").toEqual([]);
  expect.soft(state?.requestFailures ?? [], "failed API/WebSocket requests").toEqual([]);
});

async function waitForEditor(page: Page) {
  await expect(page.locator(".source-textarea")).toBeVisible();
}

async function waitForLoadedSource(page: Page) {
  await waitForEditor(page);
  await expect(page.locator(".source-textarea")).toHaveValue(/Start writing here\./);
}

async function createDocument(page: Page, title: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  await waitForLoadedSource(page);
  const patch = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/api/v1/documents/"));
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByPlaceholder("Document name").fill(title);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText(title).first()).toBeVisible();
  await patch;
  return page.url();
}

async function deleteCurrentDocumentFromDashboard(page: Page, title: string) {
  await waitForEditor(page);
  await page.getByRole("button", { name: "← Docs" }).click();
  const card = page.locator(".doc-tile", { hasText: title }).first();
  await expect(card).toBeVisible();
  await card.locator(".doc-menu-trigger").click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText(title).first()).toBeHidden();
}

test("create, rename, share, open, and delete without refresh", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const title = unique("E2E doc");
  const docUrl = await createDocument(page, title);
  expect(new URL(docUrl).searchParams.get("doc")).toBeTruthy();

  await page.keyboard.press("Control+K");
  await expect(page.getByText("Command palette")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("button", { name: "Copied link" })).toBeVisible();

  await page.goto(docUrl);
  await expect(page.getByText(title).first()).toBeVisible();
  await deleteCurrentDocumentFromDashboard(page, title);
});

test("select docs and bulk remove without refresh", async ({ page }) => {
  const first = unique("Bulk doc A");
  const second = unique("Bulk doc B");
  await createDocument(page, first);
  await page.getByRole("button", { name: "← Docs" }).click();
  await createDocument(page, second);
  await page.getByRole("button", { name: "← Docs" }).click();

  await page.getByLabel(`Select ${first}`).check();
  await page.getByLabel(`Select ${second}`).check();
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.getByRole("button", { name: "Remove selected" }).click();
  await page.getByRole("button", { name: "Remove selected" }).click();
  await expect(page.getByText(first).first()).toBeHidden();
  await expect(page.getByText(second).first()).toBeHidden();
});

test("two tabs see live Markdown typing in editing mode", async ({ page, context }) => {
  const title = unique("Live typing doc");
  const docUrl = await createDocument(page, title);
  const collaborator = await context.newPage();
  await collaborator.goto(docUrl);
  await expect(collaborator.locator(".source-textarea")).toBeVisible();

  const liveSource = `# ${title}\n\nLive typing ${Date.now()}\n`;
  await page.locator(".source-textarea").fill(liveSource);
  await expect(collaborator.locator(".source-textarea")).toHaveValue(liveSource);

  await collaborator.close();
  await deleteCurrentDocumentFromDashboard(page, title);
});

test("comments can attach to selected Markdown text and resolve", async ({ page }) => {
  const title = unique("Comment doc");
  await createDocument(page, title);
  const editor = page.locator(".source-textarea");
  await expect(editor).toBeVisible();
  await editor.evaluate((node: HTMLTextAreaElement) => {
    const start = node.value.indexOf("Start writing here.");
    node.focus();
    node.setSelectionRange(start, start + "Start writing here.".length);
    window.dispatchEvent(new CustomEvent("mdxdoc:source-selection", { detail: { documentId: new URL(window.location.href).searchParams.get("doc"), start, end: start + "Start writing here.".length, quote: "Start writing here." } }));
  });

  await expect(page.getByText("Commenting on selected text")).toBeVisible();
  await expect(page.locator("blockquote", { hasText: "Start writing here." })).toBeVisible();
  await page.getByPlaceholder("Comment on this selection…").fill("Make this intro more specific.");
  await page.getByRole("button", { name: "Comment on selection" }).click();
  await expect(page.getByText("Make this intro more specific.")).toBeVisible();
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByText("Resolved")).toBeVisible();

  await deleteCurrentDocumentFromDashboard(page, title);
});

test("versions and changesets are visible in sidebar", async ({ page }) => {
  const title = unique("Versions doc");
  await createDocument(page, title);

  await page.getByRole("tab", { name: "Versions" }).click();
  await expect(page.getByText(/Version 1/)).toBeVisible();
  await page.getByRole("button", { name: "Create checkpoint" }).click();
  await expect(page.getByText("Checkpoint created")).toBeVisible();

  await page.getByRole("tab", { name: "Changesets" }).click();
  await page.getByRole("button", { name: "Create changeset" }).click();
  await expect(page.getByText("Changeset created")).toBeVisible();
  await expect(page.getByText(/Changeset/).first()).toBeVisible();

  await deleteCurrentDocumentFromDashboard(page, title);
});

test("source suggestions do not mutate until accepted", async ({ page }) => {
  const title = unique("Suggestion doc");
  await createDocument(page, title);
  const original = await page.locator(".source-textarea").inputValue();
  const proposed = `# ${title}\n\nAccepted suggestion ${Date.now()}\n`;

  await page.getByRole("button", { name: "Suggesting" }).click();
  await expect(page.getByText("Suggesting mode:")).toBeVisible();
  await page.locator(".source-textarea").fill(proposed);
  await expect(page.locator(".source-textarea")).toHaveValue(proposed);
  await expect(page.getByRole("button", { name: "Propose suggestion" })).toBeEnabled();
  await page.getByRole("button", { name: "Propose suggestion" }).click();
  await expect(page.locator(".source-textarea")).toHaveValue(original);

  await page.getByRole("tab", { name: "Suggestions" }).click();
  await expect(page.getByText(/Replace (document source|source range)/)).toBeVisible();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.locator(".source-textarea")).toHaveValue(proposed);

  await deleteCurrentDocumentFromDashboard(page, title);
});
