import { commandWithContext } from "../shared/command-context";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store";
import { GameService } from "../server/game";
import type { Command } from "../shared/commands";
import type { Session } from "../shared/types";
const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
function setup() {
  const store = new Store(":memory:");
  stores.push(store);
  const game = new GameService(store),
    host = game.create(10, "Features");
  const view = (s: Session) => game.view(s.code, s.token);
  const act = (
    s: Session,
    c: Command,
    id = randomUUID(),
    round = view(s).gameNo,
  ) => game.execute(s.code, s.token, id, commandWithContext(c, view(s)), round);
  act(host, { type: "open_registration" });
  const players = Array.from({ length: 10 }, (_, i) =>
    game.join(host.code, i + 1),
  );
  const ids = players.map((p) => view(p).viewer.seatId!);
  return { game, store, host, players, ids, view, act };
}
describe("consent-based group chat", () => {
  it("isolates simultaneous mutual invitations, consent and membership without exposing history", () => {
    const {
      host,
      players: [a, b, c],
      ids,
      act,
      view,
    } = setup();
    act(a, { type: "create_group", name: "A", invitees: [ids[1]] });
    act(b, { type: "create_group", name: "B", invitees: [ids[0]] });
    const ga = view(a).groups[0].id,
      gb = view(b).groups[0].id;
    act(a, { type: "send_message", to: ga, content: "before consent" });
    expect(view(b).messages).toEqual([]);
    expect(view(b).groups.map((g) => g.id)).toEqual([gb]);
    expect(() =>
      act(b, { type: "send_message", to: ga, content: "forged" }),
    ).toThrow("无法访问");
    const ia = view(a).invitations.find((i) => i.to === ids[0])!;
    const ib = view(b).invitations.find((i) => i.to === ids[1])!;
    act(a, { type: "respond_invite", invitationId: ia.id, accept: true });
    act(b, { type: "respond_invite", invitationId: ib.id, accept: true });
    expect(view(a).groups).toHaveLength(2);
    expect(view(b).groups).toHaveLength(2);
    expect(view(b).messages).toEqual([]);
    act(a, { type: "send_message", to: ga, content: "after consent" });
    expect(view(b).messages.map((m) => m.content)).toEqual(["after consent"]);
    for (const outsider of [host, c]) {
      expect(view(outsider).groups).toEqual([]);
      expect(view(outsider).invitations).toEqual([]);
      expect(view(outsider).messages).toEqual([]);
    }
  });
  it("deduplicates pending invites and replays; opposite answers cannot reverse consent", () => {
    const {
      players: [a, b, c],
      ids,
      act,
      view,
    } = setup();
    const cmd: Command = {
        type: "create_group",
        name: "A",
        invitees: [ids[1]],
      },
      receipt = randomUUID();
    act(a, cmd, receipt);
    act(a, cmd, receipt);
    const groupId = view(a).groups[0].id;
    act(a, { type: "invite_group", groupId, seatId: ids[1] });
    expect(view(b).invitations).toHaveLength(1);
    expect(view(a).groups).toHaveLength(1);
    const invitationId = view(b).invitations[0].id;
    expect(() =>
      act(c, { type: "respond_invite", invitationId, accept: true }),
    ).toThrow("邀请不存在");
    act(b, { type: "respond_invite", invitationId, accept: false });
    act(b, { type: "respond_invite", invitationId, accept: false });
    expect(() =>
      act(b, { type: "respond_invite", invitationId, accept: true }),
    ).toThrow("已处理");
    expect(view(b).groups).toHaveLength(0);
  });
  it("revokes access on leave and cancels invites when the last member leaves", () => {
    const {
      players: [a, b, c],
      ids,
      act,
      view,
    } = setup();
    act(a, { type: "create_group", name: "A", invitees: [ids[1], ids[2]] });
    const groupId = view(a).groups[0].id;
    act(b, {
      type: "respond_invite",
      invitationId: view(b).invitations[0].id,
      accept: true,
    });
    act(a, { type: "send_message", to: groupId, content: "secret" });
    act(b, { type: "leave_group", groupId });
    expect(view(b).messages).toHaveLength(0);
    act(a, { type: "leave_group", groupId });
    expect(view(c).invitations[0].status).toBe("cancelled");
    expect(() =>
      act(c, {
        type: "respond_invite",
        invitationId: view(c).invitations[0].id,
        accept: true,
      }),
    ).toThrow();
  });
});
describe("private notebook revisions", () => {
  const note = (
    target: string,
  ): Extract<Command, { type: "save_notebook" }> => ({
    type: "save_notebook",
    kind: "claim",
    target,
    expectedVersion: 0,
    day: 1,
    period: "NIGHT",
    roleId: "empath",
    source: "claimed",
    body: "邻座一恶",
    info: { number: "1" },
  });
  it("keeps old roles and info, rejects stale edits and mismatched fields, stays private", () => {
    const {
      players: [a, b],
      host,
      ids,
      act,
      view,
    } = setup();
    const original = note(ids[1]);
    act(a, original);
    const entry = view(a).notebook[0];
    const update: Command = {
      ...original,
      type: "save_notebook",
      entryId: entry.id,
      expectedVersion: 1,
      roleId: "fortuneteller",
      info: { a: ids[2], b: ids[3], result: "否" },
      source: "suspected",
      body: "改判占卜师",
    };
    act(a, update);
    expect(view(a).notebook[0].revisions.map((r) => r.roleId)).toEqual([
      "empath",
      "fortuneteller",
    ]);
    expect(view(a).notebook[0].revisions[0].info).toEqual({ number: "1" });
    expect(() => act(a, update)).toThrow("其他页面修改");
    expect(() =>
      act(a, { ...update, expectedVersion: 2, roleId: "empath" }),
    ).toThrow("不一致");
    expect(() => act(b, { ...update, expectedVersion: 2 })).toThrow("不存在");
    expect(view(host).notebook).toEqual([]);
    expect(view(b).notebook).toEqual([]);
    expect(JSON.stringify(view(b))).not.toContain("改判占卜师");
  });
  it("records days independently, snapshots numbers and archives only each owner's notes", () => {
    const {
      players: [a, b],
      host,
      ids,
      act,
      view,
    } = setup();
    act(a, note(ids[1]));
    act(host, { type: "end" });
    act(b, { type: "request_seat", number: 3 });
    act(host, {
      type: "resolve_seat_request",
      requestId: view(host).seatRequests[0].id,
      accept: true,
    });
    act(host, { type: "new_round" });
    expect(view(a).notebook).toEqual([]);
    expect(view(a).pastNotebooks).toEqual([]);
    act(host, { type: "open_registration" });
    expect(view(a).pastNotebooks).toEqual([]);
    expect(view(b).pastNotebooks).toEqual([]);
    expect(view(host).pastNotebooks).toEqual([]);
  });
});
describe("round isolation and seat changes", () => {
  it("retains session and seat, resets private state, blocks stale commands and deals after confirmation", () => {
    const {
      game,
      host,
      players: [a, b],
      ids,
      act,
      view,
    } = setup();
    const old = view(host);
    act(a, { type: "send_message", to: ids[1], content: "old round" });
    act(host, { type: "set_alive", seatId: ids[0], alive: false });
    act(host, {
      type: "request_action",
      seatId: ids[1],
      targetCount: 0,
      prompt: "old secret",
    });
    act(a, { type: "create_group", name: "old", invitees: [ids[1]] });
    expect(() => act(a, { type: "new_round" })).toThrow();
    act(host, { type: "end" });
    const receipt = randomUUID();
    act(host, { type: "new_round" }, receipt, 1);
    act(host, { type: "new_round" }, receipt, 1);
    const next = view(host);
    expect(next.gameNo).toBe(2);
    expect(view(a).self?.canChangeNumber).toBe(false);
    expect(() => act(a, { type: "move_seat", number: 3 })).toThrow("换座申请");
    expect(next.phase).toBe("SETUP");
    expect(next.seats.map((s) => [s.id, s.number])).toEqual(
      old.seats.map((s) => [s.id, s.number]),
    );
    expect(next.seats.every((s) => s.alive && s.deadVoteAvailable)).toBe(true);
    expect(next.storyteller?.assignments).toEqual({});
    expect(view(a).self?.perceivedRoleId).toBeUndefined();
    expect(view(a).groups).toEqual([]);
    expect(view(b).invitations).toEqual([]);
    expect(view(a).messages).toEqual([]);
    expect(view(b).actions).toEqual([]);
    expect(() =>
      game.execute(
        a.code,
        a.token,
        randomUUID(),
        { type: "send_message", to: ids[1], content: "late" },
        1,
      ),
    ).toThrow("新一局");
    act(host, { type: "open_registration" });
    expect(view(a).phase).toBe("FIRST_NIGHT");
    expect(Object.keys(view(host).storyteller!.assignments)).toHaveLength(10);
  });
  it("requires resolving requests and swaps reciprocal requests atomically without duplicate numbers", () => {
    const {
      host,
      players: [a, b],
      ids,
      act,
      view,
    } = setup();
    act(a, { type: "request_seat", number: 2 });
    act(b, { type: "request_seat", number: 1 });
    const requestId = view(host).seatRequests[0].id;
    expect(() =>
      act(host, { type: "resolve_seat_request", requestId, accept: true }),
    ).toThrow("两局之间");
    act(host, { type: "end" });
    act(host, { type: "new_round" });
    expect(() => act(host, { type: "open_registration" })).toThrow("换座申请");
    act(host, { type: "resolve_seat_request", requestId, accept: true });
    expect(view(host).seatRequests.every((q) => q.status === "accepted")).toBe(
      true,
    );
    expect(view(a).seats.find((s) => s.id === ids[0])?.number).toBe(2);
    expect(view(b).seats.find((s) => s.id === ids[1])?.number).toBe(1);
    expect(new Set(view(host).seats.map((s) => s.number)).size).toBe(10);
    expect(() =>
      act(host, { type: "resolve_seat_request", requestId, accept: true }),
    ).toThrow("已处理");
    act(host, { type: "open_registration" });
    expect(view(a).phase).toBe("FIRST_NIGHT");
  });
});
describe("public vote ledger", () => {
  it("publishes votes by day, keeps corrections and snapshots numbers, never publishes claims", () => {
    const {
      host,
      players: [a],
      ids,
      act,
      view,
    } = setup();
    const vote: Command = {
      type: "record_vote",
      nominator: ids[0],
      nominee: ids[1],
      voters: [ids[0], ids[2]],
      reason: "",
    };
    expect(() => act(host, vote)).toThrow("白天");
    act(host, { type: "next_phase" });
    expect(() => act(a, vote)).toThrow("说书人");
    act(host, vote);
    const original = view(a).publicRecords.find((e) => e.type === "vote")!;
    expect(original.day).toBe(1);
    expect(original.period).toBe("DAY");
    expect(original.text).toContain("1 号、3 号（2 票）");
    act(host, { type: "end" });
    act(a, { type: "request_seat", number: 3 });
    act(host, {
      type: "resolve_seat_request",
      requestId: view(host).seatRequests[0].id,
      accept: true,
    });
    const correction: Command = {
      ...vote,
      type: "record_vote",
      supersedes: original.id,
      reason: "漏记",
      voters: [ids[0]],
    };
    act(host, correction);
    expect(view(a).publicRecords.filter((e) => e.type === "vote")).toHaveLength(
      2,
    );
    expect(view(a).publicRecords.at(-1)?.text).toContain(
      "1 号提名 2 号；投票：1 号",
    );
    expect(() => act(host, correction)).toThrow("已被修订");
    act(host, { type: "new_round" });
    expect(view(a).pastPublicRecords).toEqual([]);
    act(host, { type: "open_registration" });
    expect(view(a).pastPublicRecords).toEqual([]);
    expect(view(host).pastPublicRecords[0].records).toHaveLength(3);
  });
});
