import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @sparticuz/chromium ships the browser as .br archives that the runtime
  // unpacks into /tmp; file tracing skips them unless they are listed here.
  outputFileTracingIncludes: {
    "/api/scheduler/tick": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
