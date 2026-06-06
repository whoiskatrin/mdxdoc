import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  ...base,
  use: {
    ...base.use,
    baseURL: "http://127.0.0.1:5173"
  },
  webServer: {
    command: "cd apps/web && VITE_API_URL=https://mdxdoc-api.agents-b8a.workers.dev VITE_COLLAB_HOST=mdxdoc-api.agents-b8a.workers.dev pnpm exec vite --host 127.0.0.1 --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 120_000
  }
});
