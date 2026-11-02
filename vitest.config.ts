import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/vendor/*.test.ts"],
    testTimeout: 15000,
  },
});
