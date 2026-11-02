import { networkInterfaces } from "node:os";
import { createApp } from "./app";
const port = Number(process.env.PORT ?? 3001);
const app = createApp();
app.server.listen(port, "0.0.0.0", () => {
  console.log(`说书人入口：http://localhost:${port}/host`);
  for (const list of Object.values(networkInterfaces()))
    for (const address of list ?? [])
      if (address.family === "IPv4" && !address.internal)
        console.log(
          `LAN: http://${address.address}:${port} (dev UI: port 5173)`,
        );
});
process.on("SIGTERM", () => void app.close().then(() => process.exit(0)));
process.on("SIGINT", () => void app.close().then(() => process.exit(0)));
