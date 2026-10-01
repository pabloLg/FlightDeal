import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // playwright-core requires its own files at runtime (browsers.json and the
  // driver/registry files next to it). Bundling it breaks those relative
  // requires, so it stays external and the whole package is force-traced.
  serverExternalPackages: ["playwright-core"],
  // @sparticuz/chromium ships the browser as .br archives that the runtime
  // unpacks into /tmp; file tracing skips them unless they are listed here.
  // Every route that can reach the failover chain needs them, not just the cron.
  outputFileTracingIncludes: {
    "/api/scheduler/tick": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
      "./node_modules/playwright-core/**/*",
    ],
    "/api/admin/sources/retry": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
      "./node_modules/playwright-core/**/*",
    ],
  },
};

export default nextConfig;
