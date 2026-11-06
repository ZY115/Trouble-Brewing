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

it("never returns previous-game private or public information after rematch, reconnect, or HTTP reload", async () => {
  const app = await server(),
    host = app.game.create(10, "Strict current round");
  app.game.execute(host.code, host.token, randomUUID(), {
    type: "open_registration",
  });
  const players = Array.from({ length: 10 }, (_, i) =>
    app.game.join(host.code, i + 1),
  );
  const player = players[0];
  const sendDirect = (
    session: Session,
    command: Parameters<typeof app.game.execute>[3],
  ) => app.game.execute(session.code, session.token, randomUUID(), command);
  sendDirect(player, { type: "add_note", body: "OLD_NOTE_SECRET" });
  sendDirect(player, {
    type: "send_message",
    to: "storyteller",
    content: "OLD_CHAT_SECRET",
  });
  sendDirect(host, {
    type: "edit_recap",
    expectedVersion: 0,
    day: 1,
    period: "NIGHT",
    text: "OLD_RECAP_SECRET",
  });
  const h = client(app.url, host),
    a = client(app.url, player);
  const [hs, first] = await Promise.all([h.state, a.state]);
  expect(JSON.stringify(first)).toContain("OLD_NOTE_SECRET");
  const emit = (command: unknown, gameNo: number) =>
    h.socket
      .timeout(2000)
      .emitWithAck("command", { gameNo, commandId: randomUUID(), command });
  expect(
    (
      await emit(
        {
          type: "finish_game",
          mode: "normal",
          winner: "good",
          reason: "测试结束",
          confirmed: true,
          expectedReviewKey: hs.storyteller!.endReview!.key,
        },
        1,
      )
    ).ok,
  ).toBe(true);
  const newState = (predicate: (room: RoomView) => boolean) =>
    new Promise<RoomView>((resolve) => {
      const listener = (room: RoomView) => {
        if (!predicate(room)) return;
        a.socket.off("state", listener);
        resolve(room);
      };
      a.socket.on("state", listener);
    });
  const clean = (room: RoomView) => {
    expect(room.gameNo).toBe(2);
    expect(room.notebook).toEqual([]);
    expect(room.pastNotebooks).toEqual([]);
    expect(room.pastPublicRecords).toEqual([]);
    expect(room.pastRecaps).toEqual([]);
    expect(room.messages).toEqual([]);
    expect(room.actions).toEqual([]);
    expect(JSON.stringify(room)).not.toContain("OLD_");
  };
  const waiting = newState(
    (room) => room.gameNo === 2 && room.phase === "SETUP",
  );
  expect((await emit({ type: "new_round", seatMode: "keep" }, 1)).ok).toBe(
    true,
  );
  clean(await waiting);
  const dealt = newState(
    (room) => room.gameNo === 2 && room.phase === "FIRST_NIGHT",
  );
  expect((await emit({ type: "open_registration" }, 2)).ok).toBe(true);
  clean(await dealt);
  a.socket.disconnect();
  clean(await client(app.url, player).state);
  const response = await fetch(`${app.url}/api/rooms/${host.code}/state`, {
    headers: { Authorization: `Bearer ${player.token}` },
  });
  expect(response.ok).toBe(true);
  expect(response.headers.get("cache-control")).toBe("no-store");
  clean(await response.json());
  expect(
    app.game.view(host.code, host.token).pastRecaps![0].entries[0].text,
  ).toBe("OLD_RECAP_SECRET");
});

it("revokes old player sockets on rescan while retaining the host and accepting round-bound HTTP registrations", async () => {
  const app = await server();
  const host = app.game.create(10, "Rescan transport");
  app.game.execute(host.code, host.token, randomUUID(), {
    type: "open_registration",
  });
  const players = Array.from({ length: 10 }, (_, i) =>
    app.game.join(host.code, i + 1),
  );
  app.game.execute(host.code, host.token, randomUUID(), { type: "end" });
  const h = client(app.url, host),
    a = client(app.url, players[0]),
    b = client(app.url, players[1]);
  await Promise.all([h.state, a.state, b.state]);
  const revokedA = new Promise<void>((resolve) =>
    a.socket.once("session_revoked", () => resolve()),
  );
  const revokedB = new Promise<void>((resolve) =>
    b.socket.once("session_revoked", () => resolve()),
  );
  const hostUpdate = new Promise<RoomView>((resolve) =>
    h.socket.once("state", resolve),
  );
  const emit = (command: unknown, gameNo: number) =>
    h.socket
      .timeout(2000)
      .emitWithAck("command", { commandId: randomUUID(), gameNo, command });
  expect((await emit({ type: "new_round", seatMode: "rescan" }, 1)).ok).toBe(
    true,
  );
  await Promise.all([revokedA, revokedB]);
  const reset = await hostUpdate;
  expect(reset).toMatchObject({
    gameNo: 2,
    phase: "SETUP",
    seats: [],
    roundSetup: { mode: "rescan" },
  });
  expect(h.socket.connected).toBe(true);
  await expect(client(app.url, players[0]).state).rejects.toThrow("会话无效");
  expect((await emit({ type: "open_registration" }, 2)).ok).toBe(true);
  const join = (body: unknown) =>
    fetch(`${app.url}/api/rooms/${host.code}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  expect((await join({ number: 1 })).ok).toBe(false);
  expect((await join({ number: 1, gameNo: 1 })).ok).toBe(false);
  const discovery = await (
    await fetch(`${app.url}/api/rooms/${host.code}`)
  ).json();
  expect(discovery.gameNo).toBe(2);
  const response = await join({ number: 1, gameNo: 2 });
  expect(response.status).toBe(201);
  const fresh = await client(app.url, (await response.json()) as Session).state;
  expect(fresh).toMatchObject({ gameNo: 2, phase: "SETUP" });
  expect(fresh.self!.perceivedRoleId).toBeUndefined();
  expect(fresh.notebook).toEqual([]);
  expect(fresh.storyteller).toBeUndefined();
});

it("publishes a normal ending and concise recap only after host confirmation, including reconnect and corrections", async () => {
  const app = await server();
  const host = app.game.create(10, "Recap transport");
  app.game.execute(host.code, host.token, randomUUID(), {
    type: "open_registration",
  });
  const players = Array.from({ length: 10 }, (_, i) =>
    app.game.join(host.code, i + 1),
  );
  app.game.execute(host.code, host.token, randomUUID(), {
    type: "edit_recap",
    expectedVersion: 0,
    day: 1,
    period: "NIGHT",
    text: "线下确认：2号向8号下毒",
  });
  const h = client(app.url, host),
    a = client(app.url, players[0]),
    b = client(app.url, players[1]);
  const [hostState, playerState, otherState] = await Promise.all([
    h.state,
    a.state,
    b.state,
  ]);
  expect(hostState.storyteller!.recapPreview!.entries).toHaveLength(1);
  expect(JSON.stringify([playerState, otherState])).not.toContain("线下确认");
  const command = {
    type: "finish_game",
    mode: "normal",
    winner: "good",
    reason: "线下胜负由说书人裁定",
    confirmed: true,
    expectedReviewKey: hostState.storyteller!.endReview!.key,
  };
  const emit = (socket: Socket, command: unknown) =>
    socket
      .timeout(2000)
      .emitWithAck("command", { gameNo: 1, commandId: randomUUID(), command });
  expect((await emit(a.socket, command)).ok).toBe(false);
  const updatedA = new Promise<RoomView>((resolve) =>
    a.socket.once("state", resolve),
  );
  const updatedB = new Promise<RoomView>((resolve) =>
    b.socket.once("state", resolve),
  );
  expect((await emit(h.socket, command)).ok).toBe(true);
  const [av, bv] = await Promise.all([updatedA, updatedB]);
  expect(av.phase).toBe("ENDED");
  expect(av.result).toMatchObject({ mode: "normal", winner: "good" });
  expect(av.recap!.seats).toHaveLength(10);
  expect(av.recap!.entries[0].text).toContain("2号向8号下毒");
  expect(av.recap).toEqual(bv.recap);
  expect(av.storyteller).toBeUndefined();
  a.socket.disconnect();
  expect((await client(app.url, players[0]).state).recap).toEqual(av.recap);
  const correction = new Promise<RoomView>((resolve) =>
    b.socket.once("state", resolve),
  );
  expect(
    (
      await emit(h.socket, {
        type: "edit_recap",
        entryId: av.recap!.entries[0].id,
        expectedVersion: av.recap!.version,
        day: 1,
        period: "NIGHT",
        text: "更正：2号向7号下毒",
      })
    ).ok,
  ).toBe(true);
  expect((await correction).recap!.entries[0].text).toBe("更正：2号向7号下毒");
});

it.each(["FIRST_NIGHT", "OTHER_NIGHT"] as const)(
  "delivers and corrects private results over live sockets during %s, before dawn",
  async (phase) => {
    const app = await server();
    const host = app.game.create(10, "Immediate night results");
    const execute = (command: Parameters<typeof app.game.execute>[3]) =>
      app.game.execute(host.code, host.token, randomUUID(), command);
    execute({ type: "open_registration" });
    const players = Array.from({ length: 10 }, (_, i) =>
      app.game.join(host.code, i + 1),
    );
    const hostView = () => app.game.view(host.code, host.token);
    const ids = hostView().seats.map((seat) => seat.id);
    if (phase === "OTHER_NIGHT")
      execute({
        type: "correct_phase",
        phase,
        day: 2,
        reason: "测试第二夜",
        expectedPhaseVersion: hostView().storyteller!.phaseVersion,
      });
    execute({
      type: "request_action",
      seatId: ids[0],
      referenceRoleId: "fortuneteller",
      prompt: "查验两人",
      targetCount: 2,
      expectedPhaseVersion: hostView().storyteller!.phaseVersion,
    });
    execute({ type: "set_alive", seatId: ids[1], alive: false });
    const h = client(app.url, host),
      a = client(app.url, players[0]),
      b = client(app.url, players[1]);
    const [, initial] = await Promise.all([h.state, a.state, b.state]);
    const actionId = initial.actions[0].id;
    const emit = (socket: Socket, command: unknown) =>
      socket.timeout(2000).emitWithAck("command", {
        gameNo: 1,
        commandId: randomUUID(),
        command,
      });
    expect(
      (
        await emit(a.socket, {
          type: "submit_action",
          actionId,
          targets: [ids[2], ids[3]],
          expectedVersion: 0,
        })
      ).ok,
    ).toBe(true);
    const resultState = (socket: Socket, version: number) =>
      new Promise<RoomView>((resolve) => {
        const listener = (room: RoomView) => {
          if (room.playerWorkspace?.results[0]?.version !== version) return;
          socket.off("state", listener);
          resolve(room);
        };
        socket.on("state", listener);
      });
    const delivered = resultState(a.socket, 1);
    expect(
      (
        await emit(h.socket, {
          type: "send_action_response",
          actionId,
          response: "wire-result",
          expectedVersion: 1,
          expectedContextVersion: hostView().storyteller!.contextVersion,
        })
      ).ok,
    ).toBe(true);
    const received = await delivered;
    expect(received.phase).toBe(phase);
    expect(received.playerWorkspace!.results[0].response).toBe("wire-result");
    expect(received.seats[1].alive).toBe(true);
    const corrected = resultState(a.socket, 2);
    expect(
      (
        await emit(h.socket, {
          type: "correct_action_response",
          actionId,
          response: "wire-correction",
          reason: "更正",
          expectedResponseVersion: 1,
          expectedContextVersion: hostView().storyteller!.contextVersion,
        })
      ).ok,
    ).toBe(true);
    expect((await corrected).playerWorkspace!.results[0].history).toHaveLength(
      2,
    );
    a.socket.disconnect();
    const reconnected = await client(app.url, players[0]).state;
    expect(reconnected.phase).toBe(phase);
    expect(reconnected.playerWorkspace!.results[0]).toMatchObject({
      response: "wire-correction",
      version: 2,
    });
    const other = await client(app.url, players[1]).state;
    expect(other.playerWorkspace!.results).toEqual([]);
    expect(JSON.stringify(other)).not.toContain("wire-result");
    expect(JSON.stringify(other)).not.toContain("wire-correction");
  },
);

it("rejects concurrent notebook edits without exposing the edits to other sockets", async () => {
  const app = await server();
  const host = app.game.create(10, "Concurrent notebook");
  app.game.execute(host.code, host.token, randomUUID(), {
    type: "open_registration",
  });
  const players = Array.from({ length: 10 }, (_, i) =>
    app.game.join(host.code, i + 1),
  );
  app.game.execute(host.code, players[0].token, randomUUID(), {
    type: "add_note",
    body: "original",
  });
  const h = client(app.url, host),
    a = client(app.url, players[0]),
    second = client(app.url, players[0]),
    b = client(app.url, players[1]);
  const [, own] = await Promise.all([h.state, a.state, second.state, b.state]);
  const hostUpdates: RoomView[] = [],
    otherUpdates: RoomView[] = [];
  h.socket.on("state", (room) => hostUpdates.push(room));
  b.socket.on("state", (room) => otherUpdates.push(room));
  const emit = (socket: Socket, body: string) =>
    socket.timeout(2000).emitWithAck("command", {
      gameNo: 1,
      commandId: randomUUID(),
      command: {
        type: "edit_notebook",
        entryId: own.notebook[0].id,
        expectedVersion: 1,
        patch: { body },
      },
    });
  const acknowledgements = await Promise.all([
    emit(a.socket, "first edit"),
    emit(second.socket, "second edit"),
  ]);
  expect(acknowledgements.filter((ack) => ack.ok)).toHaveLength(1);
  expect(acknowledgements.find((ack) => !ack.ok).error).toContain(
    "其他页面修改",
  );
  const persisted = app.game.view(host.code, players[0].token).notebook[0];
  expect(persisted.revisions).toHaveLength(2);
  expect(persisted.revisions[0].body).toBe("original");
  const barrierH = new Promise<void>((resolve) =>
    h.socket.once("state", () => resolve()),
  );
  const barrierB = new Promise<void>((resolve) =>
    b.socket.once("state", () => resolve()),
  );
  await h.socket.timeout(2000).emitWithAck("command", {
    gameNo: 1,
    commandId: randomUUID(),
    command: { type: "evil_channel", enabled: false, confirm: false },
  });
  await Promise.all([barrierH, barrierB]);
  expect(hostUpdates).toHaveLength(1);
  expect(otherUpdates).toHaveLength(1);
  expect(JSON.stringify([...hostUpdates, ...otherUpdates])).not.toContain(
    "edit",
  );
});
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
    for (let number = 3; number <= 10; number++)
      await request(`/api/rooms/${host.code}/join`, { number });
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
      "gameNo",
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
    for (const type of ["end", "new_round"]) {
      const result = await hostClient.socket
        .timeout(2000)
        .emitWithAck("command", {
          gameNo: 1,
          commandId: randomUUID(),
          command: { type },
        });
      expect(result.ok).toBe(true);
    }
    const revoked = new Promise<void>((resolve) =>
      playerB.socket.once("session_revoked", resolve),
    );
    const removed = await hostClient.socket
      .timeout(2000)
      .emitWithAck("command", {
        gameNo: 2,
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

it.each(["save_notebook", "add_note"])(
  "sends %s changes only to the owner's sessions, not the host or other players",
  async (type) => {
    const app = await server();
    const host = app.game.create(10, "Private optional tools");
    app.game.execute(host.code, host.token, randomUUID(), {
      type: "open_registration",
    });
    const p = app.game.join(host.code, 1),
      other = app.game.join(host.code, 2);
    for (let number = 3; number <= 10; number++)
      app.game.join(host.code, number);
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
      command:
        type === "add_note"
          ? { type, body: "no activity notification" }
          : {
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
      command: { type: "evil_channel", enabled: false, confirm: false },
    });
    await Promise.all([hostBarrier, otherBarrier]);
    expect(hostUpdates).toHaveLength(1);
    expect(otherUpdates).toHaveLength(1);
    expect(JSON.stringify(hostUpdates)).not.toContain(
      "no activity notification",
    );
    expect(
      hostUpdates[0].storyteller!.events.some(
        (e) => e.type === "save_notebook",
      ),
    ).toBe(false);
  },
);

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

it("locks a vote whose countdown ran out while the server was down, as soon as a device reconnects", async () => {
  const app = await server(),
    host = app.game.create(10, "Countdown restart");
  const act = (session: Session, command: Parameters<typeof app.game.execute>[3]) =>
    app.game.execute(session.code, session.token, randomUUID(), command);
  act(host, { type: "open_registration" });
  const players = Array.from({ length: 10 }, (_, i) => app.game.join(host.code, i + 1));
  const view = () => app.game.view(host.code, host.token);
  const ids = view().seats.map((s) => s.id);
  act(host, { type: "next_phase", expectedPhaseVersion: view().storyteller!.phaseVersion });
  act(host, { type: "open_vote", nominator: ids[0], nominee: ids[1] });
  act(players[2], { type: "raise_hand", voteId: view().liveVote!.id, raised: true });
  const room = app.game.store.get(host.code)!;
  room.liveVote!.closesAt = Date.now() - 1000;
  app.game.store.save(room);
  const h = client(app.url, host);
  await h.state;
  const locked = await new Promise<RoomView>((resolve) =>
    h.socket.on("state", (s: RoomView) => s.liveVote?.status === "COUNTING" && resolve(s)),
  );
  expect(locked.liveVote!.counted[ids[2]]).toBe(true);
});
