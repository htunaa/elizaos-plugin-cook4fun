import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  // @elizaos/core is provided by the host agent at runtime; never bundle it.
  external: ["@elizaos/core"],
});
