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
    host = game.create(10, "Assistance");
  const view = (s: Session) => game.view(s.code, s.token);
  const act = (s: Session, c: Command, id = randomUUID()) =>
    game.execute(
      s.code,
      s.token,
      id,
      commandWithContext(c, view(s)),
      view(s).gameNo,
    );
  act(host, { type: "open_registration" });
  const players = Array.from({ length: 10 }, (_, i) =>
    game.join(host.code, i + 1),
  );
  const ids = players.map((p) => view(p).viewer.seatId!);
  const open = () => {
    act(host, { type: "open_vote", nominator: ids[0], nominee: ids[1] });
    return view(host).liveVote!;
  };
  const finish = () => {
    let b = view(host).liveVote!;
    if (b.status === "OPEN") act(host, { type: "start_count", voteId: b.id });
    while ((b = view(host).liveVote!).status === "COUNTING")
      act(host, { type: "count_vote", voteId: b.id, cursor: b.cursor });
  };
  return { game, host, players, ids, view, act, open, finish };
}
describe("optional tools are independent of required game actions", () => {
  it("does not report notebook usage or block phases on notes and group invitations", () => {
    const { host, players, ids, view, act } = setup();
    const audit = view(host).storyteller!.events;
    act(players[0], {
      type: "save_notebook",
      kind: "text",
      target: "",
      expectedVersion: 0,
      day: 1,
      period: "NIGHT",
      roleId: "",
      source: "suspected",
      body: "private",
      info: {},
    });
    act(players[0], {
      type: "create_group",
      name: "optional",
      invitees: [ids[1]],
    });
    expect(view(host).storyteller!.events).toEqual(audit);
    expect(view(players[1]).notebook).toEqual([]);
    act(host, { type: "next_phase" });
    expect(view(players[1]).phase).toBe("DAY");
    act(host, { type: "next_phase" });
    expect(view(players[1]).phase).toBe("OTHER_NIGHT");
  });
});
describe("night actions have explicit recovery paths", () => {
  it.each(["CANCELLED", "OFFLINE"] as const)(
    "resolves %s without leaking private reason or blocking dawn",
    (resolution) => {
      const { host, players, ids, view, act } = setup();
      act(host, {
        type: "request_action",
        seatId: ids[0],
        targetCount: 1,
        prompt: "choose",
      });
      const actionId = view(host).actions[0].id;
      expect(() => act(host, { type: "next_phase" })).toThrow("待办");
      expect(() =>
        act(players[0], {
          type: "resolve_action",
          actionId,
          resolution,
          reason: "guess",
        }),
      ).toThrow("说书人");
      act(host, {
        type: "resolve_action",
        actionId,
        resolution,
        reason: "SECRET host decision",
      });
      expect(view(players[0]).actions[0].status).toBe(resolution);
      expect(JSON.stringify(view(players[0]))).not.toContain("SECRET");
      act(host, { type: "next_phase" });
      expect(view(host).phase).toBe("DAY");
      expect(() =>
        act(players[0], { type: "submit_action", actionId, targets: [ids[1]] }),
      ).toThrow();
    },
  );
  it("allows amended targets but rejects stale replies and late target changes", () => {
    const { host, players, ids, view, act } = setup();
    act(host, {
      type: "request_action",
      seatId: ids[0],
      targetCount: 1,
      prompt: "choose",
    });
    const actionId = view(host).actions[0].id;
    act(players[0], {
      type: "submit_action",
      actionId,
      targets: [ids[1]],
      expectedVersion: 0,
    });
    act(players[0], {
      type: "submit_action",
      actionId,
      targets: [ids[2]],
      expectedVersion: 1,
    });
    expect(() =>
      act(host, {
        type: "send_action_response",
        actionId,
        response: "stale",
        expectedVersion: 1,
      }),
    ).toThrow("修改目标");
    act(host, {
      type: "send_action_response",
      actionId,
      response: "任意裁定，不依据笔记",
      expectedVersion: 2,
    });
    expect(view(players[0]).actions[0].response).toBe("任意裁定，不依据笔记");
    expect(view(players[1]).actions).toEqual([]);
    expect(() =>
      act(players[0], {
        type: "submit_action",
        actionId,
        targets: [ids[3]],
        expectedVersion: 2,
      }),
    ).toThrow();
    expect(() =>
      act(host, {
        type: "resolve_action",
        actionId,
        resolution: "CANCELLED",
        reason: "cannot erase delivered",
      }),
    ).toThrow();
  });
});
describe("phone votes with independent storyteller control", () => {
  it("counts clockwise, locks each seat once and publishes without any notebook or chat participation", () => {
    const { host, players, ids, view, act, open, finish } = setup();
    act(host, { type: "next_phase" });
    const b = open();
    expect(b.order[0]).toBe(ids[2]);
    expect(b.order.at(-1)).toBe(ids[1]);
    expect(() =>
      act(players[0], { type: "start_count", voteId: b.id }),
    ).toThrow("说书人");
    act(players[2], { type: "raise_hand", voteId: b.id, raised: true });
    act(host, { type: "start_count", voteId: b.id });
    const packet = { type: "count_vote", voteId: b.id, cursor: 0 } as const,
      receipt = randomUUID();
    act(host, packet, receipt);
    act(host, packet, receipt);
    expect(() => act(host, packet)).toThrow("计票位置");
    expect(() =>
      act(players[2], { type: "raise_hand", voteId: b.id, raised: false }),
    ).toThrow("已计入");
    act(players[0], { type: "raise_hand", voteId: b.id, raised: true });
    finish();
    const record = view(players[9]).publicRecords.at(-1)!;
    expect(record.voters).toEqual([ids[2], ids[0]]);
    expect(view(host).liveVote!.status).toBe("FINISHED");
    expect(view(host).seats.every((s) => s.alive)).toBe(true);
    expect(view(players[0]).notebook).toEqual([]);
    expect(() =>
      act(players[0], { type: "raise_hand", voteId: b.id, raised: false }),
    ).toThrow("投票已结束");
  });
  it("supports offline capture and cancellation without consuming provisional dead votes", () => {
    const { host, players, ids, view, act, open } = setup();
    act(host, { type: "set_alive", seatId: ids[2], alive: false });
    act(host, { type: "next_phase" });
    const b = open();
    act(host, { type: "start_count", voteId: b.id });
    act(host, {
      type: "count_vote",
      voteId: b.id,
      cursor: 0,
      offlineVote: true,
    });
    expect(() => act(host, { type: "next_phase" })).toThrow("当前投票");
    expect(() => open()).toThrow("当前投票");
    act(host, { type: "cancel_vote", voteId: b.id, reason: "线下已重新提名" });
    expect(
      view(players[0]).publicRecords.filter((e) => e.type === "vote"),
    ).toHaveLength(0);
    expect(
      view(host).seats.find((s) => s.id === ids[2])!.deadVoteAvailable,
    ).toBe(true);
    act(host, { type: "next_phase" });
  });
  it("consumes dead votes once, permits corrections and resets for a new round", () => {
    const { host, players, ids, view, act, open, finish } = setup();
    act(host, { type: "set_alive", seatId: ids[2], alive: false });
    act(host, { type: "next_phase" });
    let b = open();
    act(players[2], { type: "raise_hand", voteId: b.id, raised: true });
    finish();
    const record = view(host).publicRecords.at(-1)!;
    expect(
      view(host).seats.find((s) => s.id === ids[2])!.deadVoteAvailable,
    ).toBe(false);
    b = open();
    expect(() =>
      act(players[2], { type: "raise_hand", voteId: b.id, raised: true }),
    ).toThrow("死者票已使用");
    act(host, { type: "cancel_vote", voteId: b.id, reason: "更正前次" });
    act(host, {
      type: "record_vote",
      nominator: ids[0],
      nominee: ids[1],
      voters: [],
      reason: "误计",
      supersedes: record.id,
    });
    expect(
      view(host).seats.find((s) => s.id === ids[2])!.deadVoteAvailable,
    ).toBe(true);
    act(host, {
      type: "set_dead_vote",
      seatId: ids[2],
      available: false,
      reason: "补记线下使用",
    });
    expect(
      view(host).seats.find((s) => s.id === ids[2])!.deadVoteAvailable,
    ).toBe(false);
    act(host, { type: "end" });
    act(host, { type: "new_round" });
    expect(view(host).liveVote).toBeUndefined();
    expect(view(host).seats.every((s) => s.deadVoteAvailable)).toBe(true);
  });
});
