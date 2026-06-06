import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": new URL("./apps/api/test/cloudflare-workers-mock.ts", import.meta.url).pathname,
      "partyserver": new URL("./apps/api/test/partyserver-mock.ts", import.meta.url).pathname,
      "y-partyserver": new URL("./apps/api/test/y-partyserver-mock.ts", import.meta.url).pathname
    }
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node"
  }
});
