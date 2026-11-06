import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";

export async function start({ debug = false } = {}) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    console.error("请先安装 Node.js 24，然后重新打开启动文件。");
    process.exit(1);
  }
  const port = Number(debug ? process.env.DEBUG_PORT ?? 3002 : process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("端口必须是 1 到 65535 之间的整数。");
    process.exit(1);
  }
  const url = `http://localhost:${port}/host`;
  const label = debug ? "单人测试入口" : "说书人入口";
  function openBrowser(reused = false) {
    console.log(`${label}：${url}`);
    console.log(reused ? "服务已在运行，请保留原来的启动窗口。" : "关闭本窗口会停止服务。");
    if (process.env.CLOCKTOWER_NO_OPEN === "1") return;
    let browser;
    if (process.platform === "darwin") browser = spawn("open", [url], { stdio: "ignore" });
    if (process.platform === "win32") browser = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"start "" "${url}""`], { stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true });
    browser?.on("error", () => console.log(`请在浏览器打开 ${url}`));
  }
  async function running() {
    try {
      const response = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(700) });
      if (!response.ok) return null;
      const health = await response.json();
      return health.service === "clocktower-tb" ? health : null;
    } catch {
      return null;
    }
  }
  const existing = await running();
  if (existing) {
    if (existing.debug !== debug) {
      console.error("该端口已有不同模式或旧版服务，请先关闭原来的启动窗口。");
      process.exit(1);
    }
    openBrowser(true);
    return;
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
  if (!existsSync("node_modules/express") || (sourceCheckout && !existsSync("node_modules/vite")))
    run(sourceCheckout ? ["ci"] : ["ci", "--omit=dev"]);
  if (sourceCheckout) run(["run", "build"]);
  if (!existsSync("dist-server/index.js")) {
    console.error("缺少构建文件，请重新下载完整项目或发布包。");
    process.exit(1);
  }
  const server = spawn(process.execPath, ["dist-server/index.js"], {
    stdio: "inherit",
    env: {
      ...process.env,
      CLOCKTOWER_DEBUG: debug ? "1" : "0",
      PORT: String(port),
      ...(debug ? { DB_PATH: process.env.DEBUG_DB_PATH ?? resolve("data/clocktower-debug.sqlite") } : {}),
    },
  });
  server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  server.on("exit", (code) => process.exit(process.exitCode ?? code ?? 0));
  process.on("SIGINT", () => server.kill("SIGINT"));
  process.on("SIGTERM", () => server.kill("SIGTERM"));
  for (let attempt = 0; attempt < 30; attempt++) {
    const health = await running();
    if (health?.debug === debug) {
      openBrowser();
      return;
    }
    await setTimeout(300);
  }
  console.error("服务启动失败，请检查上方错误或端口占用。");
  process.exitCode = 1;
  server.kill();
}
