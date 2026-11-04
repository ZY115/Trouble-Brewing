import { networkInterfaces } from "node:os";
import { createApp } from "./app";
const debug = process.env.CLOCKTOWER_DEBUG === "1";
const port = Number(process.env.PORT ?? (debug ? 3002 : 3001));
const app = createApp(
  process.env.DB_PATH ??
    (debug ? "data/clocktower-debug.sqlite" : "data/clocktower.sqlite"),
  { debug },
);
app.server.listen(port, debug ? "127.0.0.1" : "0.0.0.0", () => {
  if (debug) console.log("单人调试模式 · 仅本机访问 · 使用独立测试数据库");
  console.log(`说书人入口：http://localhost:${port}/host`);
  if (debug) return;
  for (const list of Object.values(networkInterfaces()))
    for (const address of list ?? [])
      if (address.family === "IPv4" && !address.internal)
        console.log(
          `LAN: http://${address.address}:${port} (dev UI: port 5173)`,
        );
});
process.on("SIGTERM", () => void app.close().then(() => process.exit(0)));
process.on("SIGINT", () => void app.close().then(() => process.exit(0)));
