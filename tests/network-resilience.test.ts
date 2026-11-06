import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { io, type Socket } from "socket.io-client";
import { createApp } from "../server/app";
import type { Command } from "../shared/commands";
import type { RoomView, Session } from "../shared/types";

it("restores sessions, notes, an interrupted countdown and unacknowledged commands after a real server restart", async () => {
  const folder = mkdtempSync(join(tmpdir(), "clocktower-restart-"));
  const database = join(folder, "rooms.sqlite");
  let app: ReturnType<typeof createApp> | undefined = createApp(database);
  const sockets: Socket[] = [];
  try {
    await new Promise<void>(resolve => app!.server.listen(0, "127.0.0.1", resolve));
    const port = (app.server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}`;
    const hostSession = app.game.create(12, "Restart recovery");
    app.game.execute(hostSession.code, hostSession.token, randomUUID(), { type: "open_registration" });
    const players = Array.from({ length: 12 }, (_, i) => app!.game.join(hostSession.code, i + 1));
    async function connect(session: Session) {
      const socket = io(url, { auth: session, autoConnect: false, transports: ["websocket"], reconnectionDelay: 20, reconnectionDelayMax: 40, randomizationFactor: 0 });
      sockets.push(socket);
      const client = { socket, latest: null as RoomView | null };
      socket.on("state", (state: RoomView) => {
        client.latest = state;
        socket.emit("state_ack", { gameNo: state.gameNo, revision: state.revision });
      });
      const first = new Promise<void>((resolve, reject) => { socket.once("state", () => resolve()); socket.once("connect_error", reject); });
      socket.connect(); await first;
      return client;
    }
    const host = await connect(hostSession), player = await connect(players[0]), other = await connect(players[1]);
    const seatId = player.latest!.viewer.seatId!;
    const originalIdentity = player.latest!.self;
    const send = (client: typeof player, command: Command, gameNo = 1, commandId = randomUUID()) =>
      client.socket.timeout(2000).emitWithAck("command", { commandId, command, gameNo });
    expect((await send(player, { type: "add_note", body: "durable private notebook" })).ok).toBe(true);
    expect((await send(host, { type: "next_phase", expectedPhaseVersion: host.latest!.storyteller!.phaseVersion })).ok).toBe(true);
    expect((await send(host, { type: "open_vote", nominator: seatId, nominee: other.latest!.viewer.seatId! })).ok).toBe(true);
    const voteId = host.latest!.liveVote!.id;
    expect((await send(player, { type: "raise_hand", voteId, raised: true })).ok).toBe(true);
    expect((await send(host, { type: "start_countdown", voteId, seconds: 3 })).ok).toBe(true);
    const due = host.latest!.liveVote!.closesAt!;
    const commandId = randomUUID();
    const command: Command = { type: "send_message", to: "storyteller", content: "committed without acknowledgement" };
    const disconnectBeforeAck = (state: RoomView) => {
      if (!state.messages.some(m => m.content === command.content)) return;
      player.socket.off("state", disconnectBeforeAck);
      player.socket.disconnect();
    };
    player.socket.on("state", disconnectBeforeAck);
    await expect(send(player, command, 1, commandId)).rejects.toThrow();
    expect(app.game.view(hostSession.code, hostSession.token).messages.filter(m => m.content === command.content)).toHaveLength(1);
    const oldTimer = vi.spyOn(app.game, "lockDueVote");
    await app.close(); app = undefined;
    await expect.poll(() => host.socket.connected).toBe(false);
    await delay(Math.max(0, due - Date.now()) + 30);
    expect(oldTimer).not.toHaveBeenCalled();
    app = createApp(database);
    await new Promise<void>(resolve => app!.server.listen(port, "127.0.0.1", resolve));
    player.socket.connect();
    await expect.poll(() => host.socket.connected && player.socket.connected && other.socket.connected).toBe(true);
    await expect.poll(() => player.latest?.liveVote?.status).toBe("COUNTING");
    expect(player.latest!.self).toEqual(originalIdentity);
    expect(player.latest!.viewer.seatId).toBe(seatId);
    expect(player.latest!.notebook[0].revisions[0].body).toBe("durable private notebook");
    expect(player.latest!.liveVote!.counted[seatId]).toBe(true);
    expect(JSON.stringify(other.latest)).not.toContain("durable private notebook");
    expect(player.latest!.storyteller).toBeUndefined();
    expect(await player.socket.timeout(2000).emitWithAck("command_status", { commandId })).toEqual({ ok: true, applied: true });
    const revision = app.game.view(hostSession.code, hostSession.token).revision;
    expect((await send(player, command, 1, commandId)).ok).toBe(true);
    expect(app.game.view(hostSession.code, hostSession.token).revision).toBe(revision);
    expect(app.game.view(hostSession.code, hostSession.token).messages.filter(m => m.content === command.content)).toHaveLength(1);
    const lateVote = await send(player, { type: "raise_hand", voteId, raised: false });
    expect(lateVote).toMatchObject({ ok: false });
    expect(lateVote.error).toContain("锁定");
    expect((await send(host, { type: "finish_vote", voteId, voters: [seatId] })).ok).toBe(true);
    expect((await send(host, { type: "end" })).ok).toBe(true);
    expect((await send(host, { type: "new_round", seatMode: "keep" })).ok).toBe(true);
    expect((await send(host, { type: "open_registration" }, 2)).ok).toBe(true);
    await expect.poll(() => player.latest!.gameNo).toBe(2);
    expect(player.latest!.notebook).toEqual([]);
    const obsolete = await send(player, { type: "add_note", body: "stale round" }, 1);
    expect(obsolete.ok).toBe(false);
    expect(obsolete.error).toContain("新一局");
    expect((await send(player, command, 1, commandId)).ok).toBe(true);
    expect(player.latest!.messages).toEqual([]);
    expect(player.latest!.notebook).toEqual([]);
  } finally {
    sockets.forEach(socket => socket.disconnect());
    await app?.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
