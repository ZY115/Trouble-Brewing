import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameService } from "../server/game";
import { Store } from "../server/store";
import { commandWithContext } from "../shared/command-context";
import type { Command } from "../shared/commands";
import type { Session } from "../shared/types";

const stores: Store[] = [];
afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  vi.restoreAllMocks();
});
function setup(deal = true) {
  const store = new Store(":memory:");
  stores.push(store);
  const game = new GameService(store),
    host = game.create(10, "Workspace API");
  const view = (session = host) => game.view(session.code, session.token);
  const send = (
    command: Command,
    session: Session = host,
    receipt = randomUUID(),
  ) =>
    game.execute(
      session.code,
      session.token,
      receipt,
      commandWithContext(command, view(session)),
      view(session).gameNo,
    );
  send({ type: "open_registration" });
  const players = Array.from({ length: deal ? 10 : 2 }, (_, i) =>
    game.join(host.code, i + 1),
  );
  const ids = players.map((player) => view(player).viewer.seatId!);
  const work = () => view().storyteller!.workbench!;
  const notebook = () => view(players[0]).playerWorkspace!.notebook;
  const request = (index: number, targetCount = 0) => {
    send({
      type: "request_action",
      seatId: ids[index],
      prompt: "选择目标",
      targetCount,
      referenceRoleId: "fortuneteller",
    });
    return view().actions.at(-1)!;
  };
  return {
    store,
    game,
    host,
    players,
    ids,
    view,
    send,
    work,
    notebook,
    request,
  };
}

describe("private seat notebook API", () => {
  it("creates seat text, claims and opinions with defaults, keeps stable save ordering and never autofills identities", () => {
    const f = setup();
    expect(
      f
        .notebook()
        .seats.every(
          (seat) => !seat.claimed && !seat.suspected && !seat.notes.length,
        ),
    ).toBe(true);
    f.send(
      { type: "add_note", target: f.ids[1], body: "他说第二天再解释" },
      f.players[0],
    );
    f.send(
      {
        type: "add_note",
        target: f.ids[1],
        roleId: "empath",
        source: "claimed",
        info: { number: "1" },
      },
      f.players[0],
    );
    f.send(
      { type: "add_note", target: f.ids[1], roleId: "poisoner" },
      f.players[0],
    );
    const seat = f.notebook().seats[1];
    expect(seat.seat.number).toBe(2);
    expect(seat.notes).toHaveLength(3);
    expect(seat.claimed!.latest).toMatchObject({
      roleId: "empath",
      day: 1,
      period: "NIGHT",
      info: { number: "1" },
    });
    expect(seat.suspected!.latest.roleId).toBe("poisoner");
    expect(seat.notes.map((note) => note.latest.sequence)).toEqual([3, 2, 1]);
    expect(f.view().playerWorkspace).toBeUndefined();
    expect(
      f.view(f.players[1]).playerWorkspace!.notebook.seats[1].notes,
    ).toEqual([]);
    expect(JSON.stringify(f.view())).not.toContain("他说第二天再解释");
  });

  it("edits roles without mixing old fields, preserves revisions, rejects stale and foreign edits", () => {
    const f = setup();
    f.send(
      {
        type: "add_note",
        target: f.ids[1],
        roleId: "empath",
        info: { number: "2" },
      },
      f.players[0],
    );
    const entryId = f.view(f.players[0]).notebook[0].id;
    const edit: Command = {
      type: "edit_notebook",
      entryId,
      expectedVersion: 1,
      patch: { roleId: "fortuneteller" },
    };
    f.send(edit, f.players[0]);
    const revisions = f.view(f.players[0]).notebook[0].revisions;
    expect(revisions[0]).toMatchObject({
      roleId: "empath",
      info: { number: "2" },
      version: 1,
    });
    expect(revisions[1]).toMatchObject({
      roleId: "fortuneteller",
      info: {},
      version: 2,
      seatNumbers: { [f.ids[1]]: 2 },
    });
    expect(() => f.send(edit, f.players[0])).toThrow("其他页面修改");
    expect(() => f.send({ ...edit, expectedVersion: 2 }, f.players[1])).toThrow(
      "笔记不存在",
    );
    expect(() =>
      f.send(
        { ...edit, expectedVersion: 2, patch: { info: { number: "1" } } },
        f.players[0],
      ),
    ).toThrow("不一致");
    expect(() =>
      f.send({ ...edit, expectedVersion: 2, patch: { day: 2 } }, f.players[0]),
    ).toThrow("尚未到来");
    expect(() =>
      f.send({ ...edit, expectedVersion: 2, patch: {} }, f.players[0]),
    ).toThrow();
    expect(f.view(f.players[0]).notebook[0].revisions).toHaveLength(2);
  });

  it("archives and restores versioned notes, retries safely, persists and resets only the new round", () => {
    const f = setup(),
      receipt = randomUUID();
    const command: Command = { type: "add_note", body: "我的私人推测" };
    f.send(command, f.players[0], receipt);
    f.send(command, f.players[0], receipt);
    const entryId = f.notebook().general[0].entryId;
    f.send(
      {
        type: "edit_notebook",
        entryId,
        expectedVersion: 1,
        patch: { archived: true },
      },
      f.players[0],
    );
    expect(f.notebook().general).toHaveLength(0);
    expect(f.notebook().archived).toHaveLength(1);
    f.send(
      {
        type: "edit_notebook",
        entryId,
        expectedVersion: 2,
        patch: { archived: false },
      },
      f.players[0],
    );
    const restarted = new GameService(f.store).view(
      f.host.code,
      f.players[0].token,
    );
    expect(restarted.playerWorkspace!.notebook.general[0].latest.version).toBe(
      3,
    );
    f.send({ type: "end" });
    f.send(
      {
        type: "edit_notebook",
        entryId,
        expectedVersion: 3,
        patch: { body: "赛后补记" },
      },
      f.players[0],
    );
    f.send({ type: "new_round" });
    expect(f.view(f.players[0]).playerWorkspace).toBeUndefined();
    expect(() => f.send(command, f.players[0])).toThrow("尚未发放身份");
    f.send({ type: "open_registration" });
    const fresh = f.view(f.players[0]);
    expect(fresh.playerWorkspace!.notebook.general).toEqual([]);
    expect(fresh.pastNotebooks).toEqual([]);
    expect(
      f.store.get(f.host.code)!.archives[0].notebooks[f.ids[0]][0].revisions,
    ).toHaveLength(4);
  });

  it("rejects unknown seats, incomplete text, missing claim target and pre-deal access", () => {
    const f = setup();
    for (const command of [
      { type: "add_note", target: "missing", body: "text" },
      { type: "add_note", target: f.ids[1] },
      { type: "add_note", roleId: "empath" },
    ] as Command[])
      expect(() => f.send(command, f.players[0])).toThrow();
    expect(() => f.send({ type: "add_note", body: "host note" })).toThrow(
      "仅限玩家",
    );
    const pending = setup(false);
    expect(pending.view(pending.players[0]).playerWorkspace).toBeUndefined();
    expect(() =>
      pending.send({ type: "add_note", body: "too soon" }, pending.players[0]),
    ).toThrow("尚未发放身份");
    expect(pending.work().phaseTransition).toBeUndefined();
  });
});

describe("night results and storyteller priorities", () => {
  it.each(["send_action_response", "deliver_action", "apply_action"] as const)(
    "publishes %s immediately and privately while keeping night deaths hidden",
    (type) => {
      const f = setup(),
        action = f.request(0);
      f.send({ type: "set_alive", seatId: f.ids[1], alive: false });
      if (type === "deliver_action") {
        f.send({
          type: "review_action",
          actionId: action.id,
          response: "私密裁定",
        });
        expect(f.view(f.players[0]).playerWorkspace!.results).toEqual([]);
        expect(JSON.stringify(f.view(f.players[0]))).not.toContain("私密裁定");
        f.send({ type, actionId: action.id });
      } else if (type === "apply_action") {
        f.send({
          type,
          actionId: action.id,
          effect: "none",
          response: "私密裁定",
          force: false,
          expectedVersion: 0,
          expectedContextVersion: f.view().storyteller!.contextVersion,
        });
      } else
        f.send({
          type,
          actionId: action.id,
          response: "私密裁定",
          expectedVersion: 0,
        });
      const player = f.view(f.players[0]);
      expect(player.phase).toBe("FIRST_NIGHT");
      expect(player.playerWorkspace!.results[0]).toMatchObject({
        actionId: action.id,
        night: 1,
        response: "私密裁定",
        version: 1,
        sentAt: expect.any(String),
      });
      expect(player.seats[1].alive).toBe(true);
      expect(f.work().attention.unpublishedDeaths).toEqual([f.ids[1]]);
      expect(f.view(f.players[1]).playerWorkspace!.results).toEqual([]);
      expect(JSON.stringify(player)).not.toContain("reference");
      f.send({
        type: "correct_action_response",
        actionId: action.id,
        response: "更正裁定",
        reason: "口误",
        expectedResponseVersion: 1,
        expectedContextVersion: f.view().storyteller!.contextVersion,
      });
      const result = f.view(f.players[0]).playerWorkspace!.results[0];
      expect(result).toMatchObject({ response: "更正裁定", version: 2 });
      expect(result.history.map((version) => version.response)).toEqual([
        "私密裁定",
        "更正裁定",
      ]);
    },
  );

  it("combines numbered player actions and host chat, counts decisions and respects phase reviews", () => {
    const f = setup();
    const waiting = f.request(1, 2),
      ready = f.request(0);
    expect(f.work().counts).toMatchObject({ waiting: 1, ruling: 1 });
    expect(f.work().nextRulingActionId).toBe(ready.id);
    expect(f.work().phaseTransition!.publish.blocked).toBe(true);
    f.send(
      { type: "send_message", to: "storyteller", content: "我先确认一下" },
      f.players[1],
    );
    f.send({ type: "send_message", to: f.ids[1], content: "请选两人" });
    f.send(
      { type: "send_message", to: f.ids[1], content: "玩家之间私聊" },
      f.players[0],
    );
    const seat = f.work().seats[1];
    expect(seat).toMatchObject({
      number: 2,
      actionIds: [waiting.id],
      waiting: 1,
    });
    expect(seat.messageIds).toHaveLength(2);
    f.send(
      {
        type: "submit_action",
        actionId: waiting.id,
        targets: [f.ids[2], f.ids[3]],
      },
      f.players[1],
    );
    expect(f.work().counts).toMatchObject({ waiting: 0, ruling: 2 });
    expect(f.work().nextRulingActionId).toBe(waiting.id);
    f.send({
      type: "send_action_response",
      actionId: waiting.id,
      response: "否",
      expectedVersion: 1,
    });
    f.send({
      type: "resolve_action",
      actionId: ready.id,
      resolution: "OFFLINE",
      reason: "线下告知",
    });
    expect(f.work().counts.completed).toBe(2);
    expect(f.work().nextRulingActionId).toBeUndefined();
    const review = f.work().phaseTransition!;
    expect(review.publish.blocked).toBe(false);
    f.send({
      type: "next_phase",
      expectedPhaseVersion: review.expectedPhaseVersion,
      expectedReviewKey: review.publish.key,
    });
    expect(f.work().nightQueue).toEqual([]);
    expect(f.work().counts).toEqual({
      unstarted: 0,
      manual: 0,
      waiting: 0,
      ruling: 0,
      completed: 0,
    });
    expect(f.view(f.players[0]).storyteller).toBeUndefined();
  });

  it("tracks the edited night plan order, manual items and already completed linked actions", () => {
    const f = setup();
    let st = f.view().storyteller!;
    f.send({
      type: "generate_night_plan",
      expectedPhaseVersion: st.phaseVersion,
      expectedPlanVersion: st.planVersion,
    });
    st = f.view().storyteller!;
    expect(f.work().counts.manual).toBeGreaterThan(0);
    expect(f.work().counts.unstarted).toBeGreaterThan(0);
    const item = st.nightPlan.find((item) => item.seatId)!;
    f.send({
      type: "plan_item",
      itemId: item.id,
      operation: "up",
      expectedPhaseVersion: st.phaseVersion,
      expectedPlanVersion: st.planVersion,
    });
    expect(f.work().nightQueue.map((item) => item.planItemId)).toEqual(
      f.view().storyteller!.nightPlan.map((item) => item.id),
    );
    st = f.view().storyteller!;
    f.send({
      type: "plan_item",
      itemId: item.id,
      operation: "start",
      expectedPhaseVersion: st.phaseVersion,
      expectedPlanVersion: st.planVersion,
    });
    const workItem = f
      .work()
      .nightQueue.find((row) => row.planItemId === item.id)!;
    expect(workItem.status).toBe(item.targetCount ? "waiting" : "ruling");
    f.send({
      type: "resolve_action",
      actionId: workItem.actionId!,
      resolution: "CANCELLED",
      reason: "取消此项",
    });
    expect(
      f.work().nightQueue.find((row) => row.planItemId === item.id)!.status,
    ).toBe("completed");
  });
});
