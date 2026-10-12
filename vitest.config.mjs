import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Private snapshots and generated/runtime trees can contain historical
    // copies of tests. They are evidence, not the current source suite.
    exclude: ["**/node_modules/**", "**/dist/**", "**/runtime/**", "**/work/**", "**/logs/**"]
  }
});
