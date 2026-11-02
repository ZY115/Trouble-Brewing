import express from "express";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { Server } from "socket.io";
import { z } from "zod";
import { envelopeSchema } from "../shared/commands";
import { Store } from "./store";
import { GameService } from "./game";
export function createApp(
  database = process.env.DB_PATH ?? "data/clocktower.sqlite",
) {
  const store = new Store(database);
  const game = new GameService(store);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "24kb" }));
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  const limits = new Map<string, { count: number; until: number }>();
  app.use("/api", (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of limits)
      if (value.until < now) limits.delete(key);
    const key = req.ip ?? "local";
    const entry = limits.get(key) ?? { count: 0, until: now + 60000 };
    entry.count++;
    limits.set(key, entry);
    if (entry.count > 120) {
      res.status(429).json({ error: "请求过于频繁，请稍后重试" });
      return;
    }
    next();
  });
  const server = createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 24000 });
  const auth = z.object({
    code: z.string().regex(/^[A-Z2-9]{6}$/),
    token: z.string().min(40).max(100),
  });
  const credentials = (req: express.Request) => ({
    code: String(req.params.code),
    token: (req.headers.authorization ?? "").replace(/^Bearer /, ""),
  });
  const broadcast = (code: string) => {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.auth.code === code) {
        try {
          socket.emit("state", game.view(code, socket.data.auth.token));
        } catch {
          socket.emit("session_revoked");
          socket.disconnect(true);
        }
      }
    }
  };
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, service: "clocktower-tb" }),
  );
  app.get("/api/network", (_req, res) =>
    res.json({
      addresses: Object.values(networkInterfaces())
        .flatMap((items) => items ?? [])
        .filter(
          (a) =>
            a.family === "IPv4" &&
            !a.internal &&
            /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address),
        )
        .map((a) => a.address),
    }),
  );
  app.post("/api/host/rooms", (req, res, next) => {
    try {
      const body = z
        .object({
          capacity: z.number().int().min(10).max(13),
          title: z.string().trim().min(1).max(40).optional(),
        })
        .strict()
        .parse(req.body);
      res
        .status(201)
        .json(
          game.create(
            body.capacity,
            body.title ?? `暗流涌动 · ${body.capacity} 人局`,
          ),
        );
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/rooms/:code", (req, res, next) => {
    try {
      res.json(game.discovery(req.params.code.toUpperCase()));
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/rooms/:code/join", (req, res, next) => {
    try {
      const body = z
        .object({
          number: z.number().int().min(1).max(13),
        })
        .strict()
        .parse(req.body);
      const session = game.join(req.params.code.toUpperCase(), body.number);
      broadcast(session.code);
      res.status(201).json(session);
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/rooms/:code/recovery", (req, res, next) => {
    try {
      const c = auth.parse(credentials(req)),
        body = z
          .object({ seatId: z.string().min(1).max(100) })
          .strict()
          .parse(req.body);
      const result = game.issueRecovery(c.code, c.token, body.seatId);
      broadcast(c.code);
      res.json(result);
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/rooms/:code/recover", (req, res, next) => {
    try {
      const body = z
        .object({ recoveryToken: z.string().min(40).max(100) })
        .strict()
        .parse(req.body);
      const session = game.recover(
        req.params.code.toUpperCase(),
        body.recoveryToken,
      );
      broadcast(session.code);
      res.json(session);
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/rooms/:code/state", (req, res, next) => {
    try {
      const c = auth.parse(credentials(req));
      res.json(game.view(c.code, c.token));
    } catch (e) {
      next(e);
    }
  });
  io.use((socket, next) => {
    try {
      const c = auth.parse(socket.handshake.auth);
      game.view(c.code, c.token);
      socket.data.auth = c;
      next();
    } catch {
      next(new Error("会话无效"));
    }
  });
  io.on("connection", (socket) => {
    const { code, token } = socket.data.auth;
    socket.emit("state", game.view(code, token));
    let count = 0;
    let windowAt = Date.now();
    socket.on("command", (input, ack) => {
      if (typeof ack !== "function") return;
      try {
        if (Date.now() - windowAt > 10000) {
          count = 0;
          windowAt = Date.now();
        }
        if (++count > 50) throw new Error("操作过于频繁，请稍后重试");
        const body = envelopeSchema.parse(input);
        game.execute(code, token, body.commandId, body.command, body.gameNo);
        if (["save_note", "save_notebook"].includes(body.command.type)) {
          for (const connected of io.sockets.sockets.values())
            if (
              connected.data.auth?.code === code &&
              connected.data.auth?.token === token
            )
              connected.emit("state", game.view(code, token));
        } else broadcast(code);
        ack({ ok: true });
      } catch (e) {
        ack({
          ok: false,
          error:
            e instanceof z.ZodError ? "请求格式不正确" : (e as Error).message,
        });
      }
    });
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "接口不存在" });
  });
  app.use(express.static(resolve("dist")));
  app.get("*", (_req, res) => res.sendFile(resolve("dist/index.html")));
  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(400).json({
        error: error instanceof z.ZodError ? "请求格式不正确" : error.message,
      });
    },
  );
  return {
    app,
    server,
    io,
    game,
    store,
    close: () =>
      new Promise<void>((resolveClose) =>
        io.close(() => {
          store.close();
          resolveClose();
        }),
      ),
  };
}
