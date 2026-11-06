import { afterEach, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app";
import type { RoomView, Session } from "../shared/types";
const apps: ReturnType<typeof createApp>[] = [], sockets: Socket[] = [];
afterEach(async () => { sockets.splice(0).forEach(s => s.disconnect()); for (const app of apps.splice(0)) await app.close(); });
async function fixture() {
  const app = createApp(":memory:"); apps.push(app);
  await new Promise<void>(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const host = app.game.create(12, "Presence");
  app.game.execute(host.code, host.token, randomUUID(), { type: "open_registration" });
  const players = Array.from({ length: 12 }, (_, i) => app.game.join(host.code, i + 1));
  async function connect(session: Session) {
    const socket = io(url, { auth: session, autoConnect: false, transports: ["websocket"] }); sockets.push(socket);
    const client = { socket, latest: null as RoomView | null };
    const first = new Promise<void>((resolve, reject) => { socket.once("state", () => resolve()); socket.once("connect_error", reject); });
    socket.on("state", state => { client.latest = state; }); socket.connect(); await first; return client;
  }
  return { app, host, players, url, connect };
}
it("reports foreground/background/offline and device sync only to the host, correctly handles two tabs and syncs on return", async () => {
  const f = await fixture(), host = await f.connect(f.host), a = await f.connect(f.players[0]);
  const seat = a.latest!.viewer.seatId!;
  const presence = () => host.latest?.storyteller?.presence?.[seat];
  await expect.poll(() => presence()?.connection).toBe("foreground");
  expect(presence()?.synced).toBe(false);
  a.socket.emit("state_ack", { gameNo: a.latest!.gameNo, revision: a.latest!.revision });
  await expect.poll(() => presence()?.synced).toBe(true);
  expect(a.latest!.storyteller).toBeUndefined();
  a.socket.emit("visibility", false);
  await expect.poll(() => presence()?.connection).toBe("background");
  const second = await f.connect(f.players[0]);
  await expect.poll(() => presence()?.connection).toBe("foreground");
  second.socket.disconnect();
  await expect.poll(() => presence()?.connection).toBe("background");
  const ack = await a.socket.timeout(2000).emitWithAck("sync");
  expect(ack.ok).toBe(true); expect(ack.room.viewer.seatId).toBe(seat); expect(ack.room.storyteller).toBeUndefined();
  a.socket.emit("visibility", true);
  await expect.poll(() => presence()?.connection).toBe("foreground");
  a.socket.disconnect();
  await expect.poll(() => presence()?.connection).toBe("offline");
  expect(presence()?.lastSeenAt).toBeTypeOf("number");
});
it("checks command receipts across a reconnect without disclosing another player's receipts or replaying the command", async () => {
  const f = await fixture(), a = await f.connect(f.players[0]);
  const commandId = randomUUID(), command = { type: "send_message", to: "storyteller", content: "only once" };
  const result = await a.socket.timeout(2000).emitWithAck("command", { commandId, command, gameNo: 1 });
  expect(result.ok).toBe(true); a.socket.disconnect();
  const b = await f.connect(f.players[0]), other = await f.connect(f.players[1]);
  expect(await b.socket.timeout(2000).emitWithAck("command_status", { commandId })).toEqual({ ok: true, applied: true });
  expect(await other.socket.timeout(2000).emitWithAck("command_status", { commandId })).toEqual({ ok: true, applied: false });
  expect((await b.socket.timeout(2000).emitWithAck("command", { commandId, command, gameNo: 1 })).ok).toBe(true);
  expect(f.app.game.view(f.host.code, f.host.token).messages.filter(m => m.content === "only once")).toHaveLength(1);
});
it("keeps unaffected devices synchronized after a private notebook change and still requires public-state acknowledgements", async () => {
  const f = await fixture(), host = await f.connect(f.host), a = await f.connect(f.players[0]), b = await f.connect(f.players[1]);
  const acknowledge = (client: typeof a) => client.socket.emit("state_ack", { gameNo: client.latest!.gameNo, revision: client.latest!.revision });
  const seat = b.latest!.viewer.seatId!;
  const presence = () => host.latest?.storyteller?.presence?.[seat];
  acknowledge(a); acknowledge(b);
  await expect.poll(() => presence()?.synced).toBe(true);
  const before = b.latest!.revision;
  a.socket.on("state", () => acknowledge(a));
  expect((await a.socket.timeout(2000).emitWithAck("command", {
    commandId: randomUUID(), gameNo: 1, command: { type: "add_note", body: "private change" },
  })).ok).toBe(true);
  await expect.poll(() => host.latest!.revision).toBe(f.app.game.view(f.host.code, f.host.token).revision);
  expect(b.latest!.revision).toBe(before);
  expect(presence()?.synced).toBe(true);
  expect((await host.socket.timeout(2000).emitWithAck("command", {
    commandId: randomUUID(), gameNo: 1, command: { type: "evil_channel", enabled: false, confirm: false },
  })).ok).toBe(true);
  await expect.poll(() => b.latest!.revision).toBeGreaterThan(before);
  await expect.poll(() => presence()?.synced).toBe(false);
  acknowledge(b);
  await expect.poll(() => presence()?.synced).toBe(true);
});
it("delivers a night result after a backgrounded player's transport reconnects automatically", async () => {
  const f = await fixture(), host = await f.connect(f.host), player = await f.connect(f.players[0]);
  const seatId = player.latest!.viewer.seatId!;
  const target = player.latest!.seats.find(s => s.id !== seatId)!.id;
  const send = (client: typeof player, command: unknown) => client.socket.timeout(2000).emitWithAck("command", { commandId: randomUUID(), gameNo: 1, command });
  expect((await send(host, { type: "request_action", seatId, prompt: "选择查验目标", targetCount: 1, expectedPhaseVersion: host.latest!.storyteller!.phaseVersion })).ok).toBe(true);
  await expect.poll(() => player.latest!.actions.length).toBe(1);
  const actionId = player.latest!.actions[0].id;
  expect((await send(player, { type: "submit_action", actionId, targets: [target], expectedVersion: 0 })).ok).toBe(true);
  player.socket.emit("visibility", false);
  await expect.poll(() => host.latest!.storyteller!.presence![seatId].connection).toBe("background");
  player.socket.io.engine.close();
  expect((await send(host, { type: "send_action_response", actionId, response: "断线期间已经发出的结果", expectedVersion: 1, expectedContextVersion: host.latest!.storyteller!.contextVersion })).ok).toBe(true);
  await expect.poll(() => player.socket.connected, { timeout: 4000 }).toBe(true);
  await expect.poll(() => player.latest!.actions[0].status).toBe("DELIVERED");
  expect(player.latest!.actions[0].response).toBe("断线期间已经发出的结果");
  player.socket.emit("visibility", true);
  player.socket.emit("state_ack", { gameNo: player.latest!.gameNo, revision: player.latest!.revision });
  await expect.poll(() => host.latest!.storyteller!.presence![seatId]).toMatchObject({ connection: "foreground", synced: true });
  expect(player.latest!.storyteller).toBeUndefined();
  expect(player.latest!.viewer.seatId).toBe(seatId);
});
it("continues the latest unfinished game over HTTP on the server computer and keeps history from players", async () => {
  const f = await fixture();
  const request = (path: string, token: string, body?: unknown) => fetch(f.url + path, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const preview = await request("/api/host/latest", "", { sessions: [], resume: false });
  expect(preview.status).toBe(200);
  expect(await preview.json()).toMatchObject({ code: f.host.code, capacity: 12, phase: "FIRST_NIGHT" });
  const resumed = await request("/api/host/latest", "", { sessions: [], resume: true });
  const session = await resumed.json();
  expect(session.code).toBe(f.host.code);
  expect(f.app.game.view(session.code, session.token).viewer.kind).toBe("storyteller");
  expect((await request("/api/host/latest", "", { sessions: [{ code: "bad", token: "x" }], resume: false })).status).toBe(400);
  expect((await request(`/api/rooms/${f.host.code}/history/1`, f.players[0].token)).status).toBe(400);
});
