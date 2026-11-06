import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
const port = Number(process.env.PORT ?? 3001);
const url = `http://localhost:${port}/host`;
function openBrowser() {
  if (process.platform === "darwin" && process.env.CLOCKTOWER_NO_OPEN !== "1")
    spawn("open", [url], { stdio: "ignore" });
  console.log(
    `说书人入口：${url}\n玩家请扫描房间内的二维码。关闭本窗口会停止服务。`,
  );
}
async function running() {
  try {
    const response = await fetch(`http://localhost:${port}/api/health`, {
      signal: AbortSignal.timeout(700),
    });
    return response.ok && (await response.json()).service === "clocktower-tb";
  } catch {
    return false;
  }
}
if (await running()) {
  openBrowser();
  process.exit(0);
}
const sourceCheckout = existsSync("src/App.tsx");
function run(args) {
  const result = spawnSync(
    process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm",
    process.platform === "win32" ? ["/d", "/s", "/c", `npm.cmd ${args.join(" ")}`] : args,
    { stdio: "inherit" },
  );
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (
  !existsSync("node_modules/express") ||
  (sourceCheckout && !existsSync("node_modules/vite"))
)
  run(sourceCheckout ? ["ci"] : ["ci", "--omit=dev"]);
if (sourceCheckout) run(["run", "build"]);
if (!existsSync("dist-server/index.js")) {
  console.error("缺少服务端构建文件。请先 npm run build，或使用完整发布包。");
  process.exit(1);
}
const server = spawn(process.execPath, ["dist-server/index.js"], {
  stdio: "inherit",
  env: process.env,
});
server.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  if (await running()) {
    ready = true;
    break;
  }
  await setTimeout(300);
}
if (ready) openBrowser();
else {
  console.error("服务启动失败，请检查上方错误或端口占用。");
  server.kill();
  process.exitCode = 1;
}
