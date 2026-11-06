import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { createApp } from "../server/app";
import { commandWithContext } from "../shared/command-context";
import { phaseReview } from "../shared/phase-review";
import type { Command } from "../shared/commands";
import type { RoomView, Session } from "../shared/types";

const apps: ReturnType<typeof createApp>[] = [];
const sockets: Socket[] = [];
type Reply = { ok: boolean; error?: string };
type Client = { socket: Socket; latest: RoomView; send: (command: Command, commandId?: string) => Promise<Reply> };

afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.disconnect());
  for (const app of apps.splice(0)) await app.close();
});

async function fixture() {
  const app = createApp(":memory:");
  apps.push(app);
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const session = app.game.create(12, "Concurrent players");
  app.game.execute(session.code, session.token, randomUUID(), { type: "open_registration" });
  const sessions = Array.from({ length: 12 }, (_, i) => app.game.join(session.code, i + 1));
  const view = (s = session) => app.game.view(s.code, s.token, false);
  async function connect(s: Session): Promise<Client> {
    const socket = io(url, { auth: s, autoConnect: false, reconnection: false, transports: ["websocket"] });
    sockets.push(socket);
    const client = { socket, latest: undefined as unknown as RoomView } as Client;
    const initial = new Promise<void>((resolve, reject) => {
      socket.once("state", () => resolve());
      socket.once("connect_error", reject);
    });
    socket.on("state", (room: RoomView) => {
      client.latest = room;
      socket.emit("state_ack", { gameNo: room.gameNo, revision: room.revision });
    });
    client.send = (command, commandId = randomUUID()) => socket.timeout(5000).emitWithAck("command", {
      commandId, command: commandWithContext(command, client.latest), gameNo: client.latest.gameNo,
    });
    socket.connect();
    await initial;
    return client;
  }
  const [host, ...players] = await Promise.all([session, ...sessions].map(connect));
  const ids = players.map((player) => player.latest.viewer.seatId!);
  const direct = (command: Command) => app.game.execute(session.code, session.token, randomUUID(), commandWithContext(command, view()), 1);
  const current = (index: number) => view(sessions[index]);
  const dawn = () => direct({ type: "next_phase", expectedReviewKey: phaseReview(view(), true).key, publishLifeOnDawn: true });
  return { app, session, sessions, host, players, ids, view, current, connect, direct, dawn };
}

it("processes 12 simultaneous night submissions and chat bursts exactly once with private projections", async () => {
  const f = await fixture();
  f.ids.forEach((seatId) => f.direct({ type: "request_action", seatId, prompt: "选择一个目标", targetCount: 1 }));
  const actions = f.players.map((_, i) => f.current(i).actions[0]);
  const submitted = await Promise.all(f.players.map((player, i) => player.send({
    type: "submit_action", actionId: actions[i].id, targets: [f.ids[(i + 1) % 12]], expectedVersion: 0,
  })));
  expect(submitted.every((reply) => reply.ok)).toBe(true);
  expect(f.view().actions.filter((action) => action.status === "SUBMITTED")).toHaveLength(12);
  const responses = await Promise.all(actions.map((action, i) => f.host.send({
    type: "send_action_response", actionId: action.id, response: `PRIVATE_RESULT_${i}`,
    expectedVersion: 1, expectedContextVersion: f.view().storyteller!.contextVersion,
  })));
  expect(responses.every((reply) => reply.ok)).toBe(true);

  const results = await Promise.all(f.players.flatMap((player, i) => Array.from({ length: 10 }, (_, n) => {
    const commandId = randomUUID();
    const command: Command = { type: "send_message", to: "storyteller", content: `PRIVATE_CHAT_${i}_${n}` };
    return [player.send(command, commandId), player.send(command, commandId)];
  }).flat()));
  expect(results.every((reply) => reply.ok)).toBe(true);
  expect(f.view().messages).toHaveLength(120);
  expect(new Set(f.view().messages.map((message) => message.id)).size).toBe(120);
  for (const [i, player] of f.players.entries()) {
    await expect.poll(() => player.latest.revision).toBe(f.view().revision);
    expect(player.latest.actions).toHaveLength(1);
    expect(player.latest.actions[0].response).toBe(`PRIVATE_RESULT_${i}`);
    expect(player.latest.messages).toHaveLength(10);
    expect(player.latest.messages.every((message) => message.from === f.ids[i])).toBe(true);
    expect(player.latest.storyteller).toBeUndefined();
    expect(player.latest.notebook).toEqual([]);
  }
}, 20000);

it("lets all 12 players mutually invite and accept without blocking or leaking pre-join messages", async () => {
  const f = await fixture();
  const groups = await Promise.all(f.players.map((player, i) => player.send({
    type: "create_group", name: `小组 ${i}`, invitees: [f.ids[(i + 1) % 12]],
  })));
  expect(groups.every((reply) => reply.ok)).toBe(true);
  const groupIds = f.players.map((_, i) => f.current(i).groups[0].id);
  await Promise.all(f.players.map((player, i) => player.send({ type: "send_message", to: groupIds[i], content: `BEFORE_${i}` })));
  for (let i = 0; i < 12; i++) expect(f.current(i).messages.map((message) => message.content)).toEqual([`BEFORE_${i}`]);
  const accepted = await Promise.all(f.players.map((player, i) => {
    const incoming = f.current(i).invitations.find((invite) => invite.to === f.ids[i])!;
    return player.send({ type: "respond_invite", invitationId: incoming.id, accept: true });
  }));
  expect(accepted.every((reply) => reply.ok)).toBe(true);
  await Promise.all(f.players.map((player, i) => player.send({ type: "send_message", to: groupIds[i], content: `AFTER_${i}` })));
  for (let i = 0; i < 12; i++) {
    const mine = f.current(i);
    expect(mine.groups).toHaveLength(2);
    expect(mine.messages.map((message) => message.content).sort()).toEqual([`BEFORE_${i}`, `AFTER_${i}`, `AFTER_${(i + 11) % 12}`].sort());
  }
  expect(f.view().groups).toEqual([]);
  expect(f.view().messages).toEqual([]);
}, 20000);

it("resolves simultaneous accept/decline once and cannot revive consent after leaving", async () => {
  const f = await fixture();
  expect((await f.players[0].send({ type: "create_group", name: "竞争邀请", invitees: [f.ids[1]] })).ok).toBe(true);
  const groupId = f.current(0).groups[0].id;
  const repeated = await Promise.all(Array.from({ length: 12 }, () => f.players[0].send({ type: "invite_group", groupId, seatId: f.ids[1] })));
  expect(repeated.every((reply) => reply.ok)).toBe(true);
  expect(f.current(1).invitations).toHaveLength(1);
  const invitationId = f.current(1).invitations[0].id;
  const second = await f.connect(f.sessions[1]);
  const replies = await Promise.all([
    f.players[1].send({ type: "respond_invite", invitationId, accept: true }),
    second.send({ type: "respond_invite", invitationId, accept: false }),
  ]);
  expect(replies.filter((reply) => reply.ok)).toHaveLength(1);
  const accepted = f.current(1).invitations[0].status === "accepted";
  expect(f.current(1).groups).toHaveLength(accepted ? 1 : 0);
  if (accepted) {
    expect((await second.send({ type: "leave_group", groupId })).ok).toBe(true);
    expect((await f.players[1].send({ type: "respond_invite", invitationId, accept: true })).ok).toBe(true);
    expect(f.current(1).groups).toHaveLength(0);
    expect((await second.send({ type: "send_message", to: groupId, content: "不得发送" })).ok).toBe(false);
  }
  expect((await f.players[2].send({ type: "respond_invite", invitationId, accept: true })).ok).toBe(false);
});

it("preserves one winning notebook version when two pages save stale forms simultaneously", async () => {
  const f = await fixture(), second = await f.connect(f.sessions[0]);
  expect((await f.players[0].send({ type: "add_note", target: f.ids[1], body: "原版本" })).ok).toBe(true);
  const entryId = f.current(0).notebook[0].id;
  const replies = await Promise.all([
    f.players[0].send({ type: "edit_notebook", entryId, expectedVersion: 1, patch: { body: "页面 A" } }),
    second.send({ type: "edit_notebook", entryId, expectedVersion: 1, patch: { body: "页面 B" } }),
  ]);
  expect(replies.filter((reply) => reply.ok)).toHaveLength(1);
  expect(replies.find((reply) => !reply.ok)!.error).toContain("其他页面修改");
  const revisions = f.current(0).notebook[0].revisions;
  expect(revisions.map((revision) => revision.body)).toEqual(["原版本", replies[0].ok ? "页面 A" : "页面 B"]);
  expect(revisions.map((revision) => revision.version)).toEqual([1, 2]);
  for (let i = 1; i < 12; i++) expect(f.current(i).notebook).toEqual([]);
  expect(f.view().notebook).toEqual([]);
  await expect.poll(() => second.latest.notebook[0].revisions.length).toBe(2);
});

it("keeps player/host target edits and a racing response consistent with their accepted versions", async () => {
  const f = await fixture();
  f.direct({ type: "request_action", seatId: f.ids[0], prompt: "选一个目标", targetCount: 1 });
  const actionId = f.current(0).actions[0].id;
  const first = await Promise.all([
    f.players[0].send({ type: "submit_action", actionId, expectedVersion: 0, targets: [f.ids[1]] }),
    f.host.send({ type: "set_action_targets", actionId, expectedVersion: 0, targets: [f.ids[2]] }),
  ]);
  expect(first.filter((reply) => reply.ok)).toHaveLength(1);
  expect(f.current(0).actions[0].targets).toEqual([first[0].ok ? f.ids[1] : f.ids[2]]);
  expect(f.current(0).actions[0].selectionVersion).toBe(1);
  const final = await Promise.all([
    f.players[0].send({ type: "submit_action", actionId, expectedVersion: 1, targets: [f.ids[3]] }),
    f.host.send({ type: "send_action_response", actionId, expectedVersion: 1, expectedContextVersion: f.view().storyteller!.contextVersion, response: "原目标的结果" }),
  ]);
  expect(final.filter((reply) => reply.ok)).toHaveLength(1);
  const action = f.current(0).actions[0];
  expect(action.selectionVersion).toBe(final[0].ok ? 2 : 1);
  expect(action.status).toBe(final[0].ok ? "SUBMITTED" : "DELIVERED");
  expect(action.response).toBe(final[0].ok ? undefined : "原目标的结果");
});

it("locks 12 concurrent votes consistently and duplicates neither the record nor the spent ghost vote", async () => {
  const f = await fixture();
  f.dawn();
  f.direct({ type: "set_alive", seatId: f.ids[0], alive: false });
  f.direct({ type: "open_vote", nominator: f.ids[1], nominee: f.ids[2] });
  const voteId = f.view().liveVote!.id;
  const raised = await Promise.all(f.players.map((player) => player.send({ type: "raise_hand", voteId, raised: true })));
  expect(raised.every((reply) => reply.ok)).toBe(true);
  const racing = await Promise.all([
    f.host.send({ type: "lock_vote", voteId }),
    ...f.players.slice(1).map((player) => player.send({ type: "raise_hand", voteId, raised: false })),
  ]);
  expect(racing[0].ok).toBe(true);
  const vote = f.view().liveVote!;
  expect(vote.status).toBe("COUNTING");
  expect(vote.counted[f.ids[0]]).toBe(true);
  for (let i = 1; i < 12; i++) expect(vote.counted[f.ids[i]]).toBe(!racing[i].ok);
  const secondHost = await f.connect(f.session), commandId = randomUUID();
  const command: Command = { type: "finish_vote", voteId, voters: vote.order.filter((id) => vote.counted[id]) };
  const confirmed = await Promise.all([f.host.send(command, commandId), secondHost.send(command, commandId)]);
  expect(confirmed.every((reply) => reply.ok)).toBe(true);
  const records = f.view().publicRecords.filter((record) => record.type === "vote");
  expect(records).toHaveLength(1);
  expect(records[0].deadVoters).toEqual([f.ids[0]]);
  expect(f.current(0).seats.find((seat) => seat.id === f.ids[0])!.deadVoteAvailable).toBe(false);
  expect((await f.players[0].send({ type: "raise_hand", voteId, raised: false })).ok).toBe(false);
  await expect.poll(() => f.players.every((player) => player.latest.liveVote?.status === "FINISHED")).toBe(true);
});
