import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

if (existsSync("src/App.tsx")) {
  const build = spawnSync(
    process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm",
    process.platform === "win32" ? ["/d", "/s", "/c", "npm.cmd run build"] : ["run", "build"],
    { stdio: "inherit" },
  );
  if (build.error) console.error(build.error.message);
  if (build.status !== 0) process.exit(build.status ?? 1);
}
if (!existsSync("dist-server/index.js")) {
  console.error("缺少构建文件，请先 npm ci，再运行 npm run debug。");
  process.exit(1);
}
const server = spawn(process.execPath, ["dist-server/index.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    CLOCKTOWER_DEBUG: "1",
    PORT: process.env.DEBUG_PORT ?? "3002",
    DB_PATH:
      process.env.DEBUG_DB_PATH ?? resolve("data/clocktower-debug.sqlite"),
  },
});
server.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));
