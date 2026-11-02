import { afterEach, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app";
import type { RoomView, Session } from "../shared/types";
const apps: ReturnType<typeof createApp>[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.disconnect());
  for (const app of apps.splice(0)) await app.close();
});
async function server() {
  const app = createApp(":memory:");
  apps.push(app);
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  return {
    ...app,
    url: `http://127.0.0.1:${(app.server.address() as { port: number }).port}`,
  };
}
function client(url: string, session: Session) {
  const socket = connect(url, {
    auth: session,
    transports: ["websocket"],
    reconnection: false,
    autoConnect: false,
  });
  sockets.push(socket);
  const state = new Promise<RoomView>((resolve, reject) => {
    socket.once("state", resolve);
    socket.once("connect_error", reject);
  });
  socket.connect();
  return { socket, state };
}
describe("HTTP and real Socket.IO transport", () => {
  it("creates, joins, connects, rejects unauthorized commands and privately delivers updates", async () => {
    const app = await server();
    const request = async (path: string, body: unknown) => {
      const response = await fetch(app.url + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(201);
      return response.json() as Promise<Session>;
    };
    const host = await request("/api/host/rooms", {
      title: "Wire test",
      capacity: 10,
    });
    app.game.execute(host.code, host.token, randomUUID(), {
      type: "open_registration",
    });
    const a = await request(`/api/rooms/${host.code}/join`, {
      number: 1,
    });
    const b = await request(`/api/rooms/${host.code}/join`, {
      number: 2,
    });
    const hostClient = client(app.url, host);
    const playerA = client(app.url, a);
    const playerB = client(app.url, b);
    const [hostState, aState, bState] = await Promise.all([
      hostClient.state,
      playerA.state,
      playerB.state,
    ]);
    expect(hostState.storyteller).toBeTruthy();
    expect(aState.storyteller).toBeUndefined();
    const rejected = await playerA.socket.timeout(2000).emitWithAck("command", {
      gameNo: 1,
      commandId: randomUUID(),
      command: { type: "end" },
    });
    expect(rejected.ok).toBe(false);
    const updateB = new Promise<RoomView>((resolve) =>
      playerB.socket.once("state", resolve),
    );
    const updateHost = new Promise<RoomView>((resolve) =>
      hostClient.socket.once("state", resolve),
    );
    const ack = await playerA.socket.timeout(2000).emitWithAck("command", {
      gameNo: 1,
      commandId: randomUUID(),
      command: {
        type: "send_message",
        to: bState.viewer.seatId,
        content: "transport-secret",
      },
    });
    expect(ack.ok).toBe(true);
    expect((await updateB).messages[0].content).toBe("transport-secret");
    expect((await updateHost).messages).toEqual([]);
    const bad = client(app.url, { code: host.code, token: "x".repeat(43) });
    await expect(bad.state).rejects.toThrow("会话无效");
    const discovery = await (
      await fetch(`${app.url}/api/rooms/${host.code}`)
    ).json();
    expect(Object.keys(discovery).sort()).toEqual([
      "capacity",
      "code",
      "phase",
      "registration",
      "title",
    ]);
    const unauthorized = await fetch(`${app.url}/api/rooms/${host.code}/state`);
    expect(unauthorized.ok).toBe(false);
    playerA.socket.disconnect();
    const reconnected = client(app.url, a);
    const restored = await reconnected.state;
    expect(restored.viewer).toEqual(aState.viewer);
    expect(restored.messages).toHaveLength(1);
    const revoked = new Promise<void>((resolve) =>
      playerB.socket.once("session_revoked", resolve),
    );
    const removed = await hostClient.socket
      .timeout(2000)
      .emitWithAck("command", {
        gameNo: 1,
        commandId: randomUUID(),
        command: { type: "remove_player", seatId: bState.viewer.seatId },
      });
    expect(removed.ok).toBe(true);
    await revoked;
    const revokedClient = client(app.url, b);
    await expect(revokedClient.state).rejects.toThrow("会话无效");
    const forged = await fetch(`${app.url}/api/rooms/${host.code}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number: 2, kind: "storyteller" }),
    });
    expect(forged.ok).toBe(false);
    const oldCreate = await fetch(`${app.url}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capacity: 10 }),
    });
    expect(oldCreate.status).toBe(404);
  });
});

it("serializes simultaneous mutual invites, duplicate accepts and old-round transport packets", async () => {
  const app = await server();
  const host = app.game.create(10, "Concurrent transport");
  app.game.execute(host.code, host.token, randomUUID(), {
    type: "open_registration",
  });
  const players = Array.from({ length: 10 }, (_, i) =>
    app.game.join(host.code, i + 1),
  );
  const a = client(app.url, players[0]),
    b = client(app.url, players[1]);
  const [av, bv] = await Promise.all([a.state, b.state]);
  const emit = (
    socket: Socket,
    command: unknown,
    gameNo = 1,
    commandId = randomUUID(),
  ) =>
    socket.timeout(2000).emitWithAck("command", { commandId, gameNo, command });
  const results = await Promise.all([
    emit(a.socket, {
      type: "create_group",
      name: "A",
      invitees: [bv.viewer.seatId],
    }),
    emit(b.socket, {
      type: "create_group",
      name: "B",
      invitees: [av.viewer.seatId],
    }),
  ]);
  expect(results.every((r) => r.ok)).toBe(true);
  const view = (s: Session) => app.game.view(s.code, s.token);
  const acceptA = {
    type: "respond_invite",
    invitationId: view(players[0]).invitations.find(
      (i) => i.to === av.viewer.seatId,
    )!.id,
    accept: true,
  };
  const acceptB = {
    type: "respond_invite",
    invitationId: view(players[1]).invitations.find(
      (i) => i.to === bv.viewer.seatId,
    )!.id,
    accept: true,
  };
  const accepted = await Promise.all([
    emit(a.socket, acceptA),
    emit(b.socket, acceptB),
    emit(a.socket, acceptA),
    emit(b.socket, acceptB),
  ]);
  expect(accepted.every((r) => r.ok)).toBe(true);
  expect(view(players[0]).groups).toHaveLength(2);
  expect(view(players[1]).groups).toHaveLength(2);
  const id = randomUUID(),
    message = {
      type: "send_message",
      to: view(players[0]).groups[0].id,
      content: "exactly once",
    };
  await Promise.all([
    emit(a.socket, message, 1, id),
    emit(a.socket, message, 1, id),
  ]);
  expect(view(players[1]).messages).toHaveLength(1);
  app.game.execute(host.code, host.token, randomUUID(), { type: "end" });
  app.game.execute(host.code, host.token, randomUUID(), { type: "new_round" });
  const late = await emit(a.socket, {
    type: "send_message",
    to: bv.viewer.seatId,
    content: "stale",
  });
  expect(late.ok).toBe(false);
  expect(late.error).toContain("新一局");
  expect(view(players[1]).messages).toEqual([]);
});

it("sends notebook changes only to the owner's sessions, not the host or other players", async () => {
  const app = await server();
  const host = app.game.create(10, "Private optional tools");
  app.game.execute(host.code, host.token, randomUUID(), {
    type: "open_registration",
  });
  const p = app.game.join(host.code, 1),
    other = app.game.join(host.code, 2);
  const h = client(app.url, host),
    a = client(app.url, p),
    second = client(app.url, p),
    b = client(app.url, other);
  await Promise.all([h.state, a.state, second.state, b.state]);
  const hostUpdates: RoomView[] = [],
    otherUpdates: RoomView[] = [];
  h.socket.on("state", (r) => hostUpdates.push(r));
  b.socket.on("state", (r) => otherUpdates.push(r));
  const ownUpdate = new Promise<RoomView>((resolve) =>
    second.socket.once("state", resolve),
  );
  const reply = await a.socket.timeout(2000).emitWithAck("command", {
    gameNo: 1,
    commandId: randomUUID(),
    command: {
      type: "save_notebook",
      kind: "text",
      target: "",
      expectedVersion: 0,
      day: 1,
      period: "NIGHT",
      roleId: "",
      source: "suspected",
      body: "no activity notification",
      info: {},
    },
  });
  expect(reply.ok).toBe(true);
  expect((await ownUpdate).notebook).toHaveLength(1);
  const hostBarrier = new Promise<RoomView>((resolve) =>
    h.socket.once("state", resolve),
  );
  const otherBarrier = new Promise<RoomView>((resolve) =>
    b.socket.once("state", resolve),
  );
  await h.socket.timeout(2000).emitWithAck("command", {
    gameNo: 1,
    commandId: randomUUID(),
    command: { type: "close_registration" },
  });
  await Promise.all([hostBarrier, otherBarrier]);
  expect(hostUpdates).toHaveLength(1);
  expect(otherUpdates).toHaveLength(1);
  expect(JSON.stringify(hostUpdates)).not.toContain("no activity notification");
  expect(
    hostUpdates[0].storyteller!.events.some((e) => e.type === "save_notebook"),
  ).toBe(false);
});

it("recovers a seat over HTTP, revokes its old live socket, and rejects reused tickets", async () => {
  const app = await server();
  const host = app.game.create(10, "Recovery transport");
  app.game.execute(host.code, host.token, randomUUID(), {
    type: "open_registration",
  });
  const players = Array.from({ length: 10 }, (_, i) =>
    app.game.join(host.code, i + 1),
  );
  const old = client(app.url, players[0]);
  const before = await old.state;
  const issue = (session: Session) =>
    fetch(`${app.url}/api/rooms/${host.code}/recovery`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ seatId: before.viewer.seatId }),
    });
  expect((await issue(players[1])).ok).toBe(false);
  const response = await issue(host);
  expect(response.ok).toBe(true);
  const ticket = await response.json();
  const revoked = new Promise<void>((resolve) =>
    old.socket.once("session_revoked", resolve),
  );
  const recover = () =>
    fetch(`${app.url}/api/rooms/${host.code}/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recoveryToken: ticket.recoveryToken }),
    });
  const restoredResponse = await recover();
  expect(restoredResponse.ok).toBe(true);
  const restored = (await restoredResponse.json()) as Session;
  await revoked;
  const fresh = client(app.url, restored),
    state = await fresh.state;
  expect(state.viewer).toEqual(before.viewer);
  expect(state.self).toEqual(before.self);
  expect(state.storyteller).toBeUndefined();
  expect((await recover()).ok).toBe(false);
  const obsolete = client(app.url, players[0]);
  await expect(obsolete.state).rejects.toThrow("会话无效");
});
