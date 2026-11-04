import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GameService } from "../server/game";
import { Store } from "../server/store";
import { commandWithContext } from "../shared/command-context";
import type { Command } from "../shared/commands";
import type { Session } from "../shared/types";

const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
function fixture() {
  const store = new Store(":memory:");
  stores.push(store);
  const game = new GameService(store),
    host = game.create(10, "Endgame");
  const view = (session = host) => game.view(session.code, session.token);
  const send = (
    c: Command,
    session: Session = host,
    commandId = randomUUID(),
    gameNo = view(session).gameNo,
  ) =>
    game.execute(
      session.code,
      session.token,
      commandId,
      commandWithContext(c, view(session)),
      gameNo,
    );
  expect(view().storyteller!.endReview!.available).toBe(false);
  send({ type: "open_registration" });
  const players = Array.from({ length: 10 }, (_, i) =>
    game.join(host.code, i + 1),
  );
  const ids = players.map((p) => view(p).viewer.seatId!);
  const room = store.get(host.code)!;
  const roles = [
    "imp",
    "poisoner",
    "empath",
    "fortuneteller",
    "monk",
    "saint",
    "mayor",
    "washerwoman",
    "soldier",
    "scarletwoman",
  ];
  ids.forEach(
    (id, i) =>
      (room.assignments[id] = {
        actualRoleId: roles[i],
        perceivedRoleId: roles[i],
      }),
  );
  room.initialAssignments = structuredClone(room.assignments);
  store.save(room);
  const st = () => view().storyteller!;
  const review = () => st().endReview!;
  const preview = () => st().recapPreview!;
  const life = (i: number, alive = false) =>
    send({ type: "set_alive", seatId: ids[i], alive });
  const phase = (phase: "DAY" | "OTHER_NIGHT", day = phase === "DAY" ? 1 : 2) =>
    send({
      type: "correct_phase",
      phase,
      day,
      reason: "测试流程",
      expectedPhaseVersion: st().phaseVersion,
    });
  const condition = (
    i: number,
    condition: "poisoned" | "protected" | "drunk",
    value: boolean,
  ) =>
    send({
      type: "set_condition",
      seatId: ids[i],
      condition,
      value,
      expectedContextVersion: st().contextVersion,
    });
  const execute = (i: number, died = true) =>
    send({
      type: "execute_player",
      seatId: ids[i],
      died,
      reason: "登记处决",
      confirmed: true,
      expectedContextVersion: st().contextVersion,
    });
  const finish = (
    overrides: Partial<Extract<Command, { type: "finish_game" }>> = {},
  ) =>
    ({
      type: "finish_game",
      mode: "normal",
      winner: "good",
      reason: "",
      endDay: false,
      confirmed: true,
      expectedReviewKey: review().key,
      ...overrides,
    }) as Extract<Command, { type: "finish_game" }>;
  const action = (actor: number, role: string, targets: number[]) => {
    send({
      type: "request_action",
      seatId: ids[actor],
      referenceRoleId: role,
      prompt: "本夜行动",
      targetCount: targets.length,
    });
    const id = view().actions.at(-1)!.id;
    if (targets.length)
      send(
        {
          type: "submit_action",
          actionId: id,
          targets: targets.map((i) => ids[i]),
          expectedVersion: 0,
        },
        players[actor],
      );
    return id;
  };
  const apply = (
    actionId: string,
    effect: "poison" | "protect" | "kill" | "none",
    response = "已收到",
  ) =>
    send({
      type: "apply_action",
      actionId,
      effect,
      response,
      force: false,
      expectedVersion:
        view().actions.find((a) => a.id === actionId)!.selectionVersion ?? 0,
      expectedContextVersion: st().contextVersion,
    });
  return {
    store,
    game,
    host,
    players,
    ids,
    view,
    send,
    st,
    review,
    preview,
    life,
    phase,
    condition,
    execute,
    finish,
    action,
    apply,
  };
}

describe("advisory ending, with storyteller authority", () => {
  it("withdraws a dusk Mayor suggestion if the day's execution record is subsequently restored", () => {
    const f = fixture();
    [1, 2, 3, 4, 5, 7, 9].forEach((i) => f.life(i));
    f.phase("DAY");
    f.execute(8, false);
    f.send({
      type: "correct_execution",
      executionId: f.st().executions.at(-1)!.id,
      died: false,
      voided: true,
      alive: true,
      reason: "误记处决",
      expectedContextVersion: f.st().contextVersion,
    });
    f.send({ type: "next_phase", expectedPhaseVersion: f.st().phaseVersion });
    expect(f.review().suggestedWinner).toBe("good");
    f.send({
      type: "correct_execution",
      executionId: f.st().executions.at(-1)!.id,
      died: false,
      voided: false,
      alive: true,
      reason: "核实当时确实发生处决",
      expectedContextVersion: f.st().contextVersion,
    });
    expect(f.review().suggestedWinner).toBeUndefined();
  });
  it("does not offer Scarlet Woman succession when poisoned at the Demon death", () => {
    const f = fixture();
    f.condition(9, "poisoned", true);
    f.life(0);
    expect(f.review().suggestedWinner).toBe("good");
    f.condition(9, "poisoned", false);
    expect(f.review().suggestedWinner).toBe("good");
  });

  it("requires manual review for missing historical Saint impairment and conflicting suggestions", () => {
    const f = fixture();
    f.phase("DAY");
    f.execute(5);
    const room = f.store.get(f.host.code)!;
    delete room.executions.at(-1)!.impaired;
    f.store.save(room);
    expect(f.review().suggestedWinner).toBeUndefined();
    expect(f.review().suggestions[0].status).toBe("check");
    const conflict = fixture();
    conflict.phase("DAY");
    conflict.execute(5);
    conflict.life(9);
    conflict.life(0);
    expect(conflict.review().suggestedWinner).toBeUndefined();
    expect(conflict.review().buttonLabel).toBe("结束游戏");
    expect(() => conflict.send(conflict.finish())).toThrow("裁定说明");
    conflict.send(conflict.finish({ reason: "处理冲突记录后确认善良胜利" }));
    expect(conflict.view().result!.winner).toBe("good");
  });
  it("requires succession before suggesting good; dismissed reminders cannot hide an ending check", () => {
    const f = fixture();
    expect(f.review()).toMatchObject({
      available: true,
      buttonLabel: "提前结束",
    });
    f.life(0);
    expect(f.view().phase).toBe("FIRST_NIGHT");
    expect(f.review().suggestedWinner).toBeUndefined();
    expect(f.review().suggestions[0].id).toBe("succession");
    const notice = f.st().notices.find((n) => n.kind === "demon")!;
    f.send({
      type: "resolve_notice",
      noticeId: notice.id,
      expectedContextVersion: f.st().contextVersion,
    });
    expect(f.review().suggestions[0].id).toBe("succession");
    // A dismissed actionable notice must be restored before the existing promotion command.
    const room = f.store.get(f.host.code)!;
    room.dismissedNotices = [];
    f.store.save(room);
    f.send({
      type: "promote_imp",
      deathId: notice.deathId!,
      seatId: f.ids[9],
      confirmed: true,
      expectedContextVersion: f.st().contextVersion,
    });
    expect(f.review().suggestions).toEqual([]);
    f.life(9);
    expect(f.review()).toMatchObject({
      suggestedWinner: "good",
      buttonLabel: "结束游戏",
    });
    expect(f.view(f.players[2]).result).toBeUndefined();
    expect(f.view(f.players[2]).recap).toBeUndefined();
  });

  it("recognizes healthy Imp self-kill as pending star-pass rather than a good win", () => {
    const f = fixture();
    f.life(9);
    f.phase("OTHER_NIGHT");
    const actionId = f.action(0, "imp", [0]);
    f.apply(actionId, "kill");
    expect(f.review().suggestions[0].id).toBe("succession");
    expect(f.review().suggestedWinner).toBeUndefined();
    const death = f.store.get(f.host.code)!.deathEvents.at(-1)!;
    f.send({
      type: "promote_imp",
      deathId: death.id,
      seatId: f.ids[1],
      confirmed: true,
      expectedContextVersion: f.st().contextVersion,
    });
    expect(f.review().suggestions).toEqual([]);
    expect(f.preview().entries.find((e) => e.kind === "role")!.text).toContain(
      "从 投毒者 变为 小恶魔",
    );
  });

  it("distinguishes two alive with a Demon from no living Demon, without ending automatically", () => {
    const f = fixture();
    [1, 2, 3, 4, 5, 6, 7, 9].forEach((i) => f.life(i));
    expect(f.review().suggestedWinner).toBe("evil");
    expect(f.view().phase).toBe("FIRST_NIGHT");
    f.life(0);
    expect(f.review().suggestedWinner).toBe("good");
    expect(f.review().suggestions.some((s) => s.id === "two-alive")).toBe(
      false,
    );
  });

  it.each([false, true])(
    "uses Saint impairment at execution time (poisoned=%s), including corrections",
    (poisoned) => {
      const f = fixture();
      f.phase("DAY");
      f.condition(5, "poisoned", poisoned);
      f.execute(5);
      f.condition(5, "poisoned", !poisoned);
      expect(f.review().suggestedWinner).toBe(poisoned ? undefined : "evil");
      const execution = f.st().executions.at(-1)!;
      f.send({
        type: "correct_execution",
        executionId: execution.id,
        died: false,
        voided: true,
        alive: true,
        reason: "更正误记",
        expectedContextVersion: f.st().contextVersion,
      });
      expect(f.review().suggestedWinner).toBeUndefined();
      expect(
        f.preview().entries.filter((e) => e.kind === "execution"),
      ).toHaveLength(1);
      expect(
        f.preview().entries.find((e) => e.kind === "execution")!.text,
      ).toContain("已撤销");
    },
  );

  it("requires explicit end-of-day for Mayor and preserves a dusk snapshot across the next night", () => {
    const f = fixture();
    [1, 2, 3, 4, 5, 7, 9].forEach((i) => f.life(i));
    f.phase("DAY");
    expect(f.review().suggestedWinner).toBeUndefined();
    expect(f.review().suggestions[0].status).toBe("end_day");
    expect(() => f.send(f.finish())).toThrow("裁定说明");
    f.send({ type: "next_phase", expectedPhaseVersion: f.st().phaseVersion });
    expect(f.review().suggestedWinner).toBe("good");
    f.condition(6, "poisoned", true);
    expect(f.review().suggestedWinner).toBe("good");
    f.send(f.finish());
    expect(f.view().result).toMatchObject({ mode: "normal", winner: "good" });
  });

  it("can confirm Mayor at dusk directly; a failed execution or poisoning prevents the suggestion", () => {
    const f = fixture();
    [1, 2, 3, 4, 5, 7, 9].forEach((i) => f.life(i));
    f.phase("DAY");
    f.condition(6, "poisoned", true);
    expect(f.review().suggestions).toEqual([]);
    f.condition(6, "poisoned", false);
    f.execute(8, false);
    expect(f.review().suggestions).toEqual([]);
    const ex = f.st().executions.at(-1)!;
    f.send({
      type: "correct_execution",
      executionId: ex.id,
      died: false,
      voided: true,
      alive: true,
      reason: "本日实际未处决",
      expectedContextVersion: f.st().contextVersion,
    });
    f.send(f.finish({ endDay: true }));
    expect(f.view(f.players[0]).result!.winner).toBe("good");
  });

  it("lets the host override suggestions with a reason; early ending never invents a winner or exposes the recap", () => {
    const f = fixture();
    expect(() => f.send(f.finish())).toThrow("裁定说明");
    f.send(f.finish({ winner: "evil", reason: "线下特殊裁定，由说书人确认" }));
    expect(f.view().result!.winner).toBe("evil");
    const other = fixture();
    other.life(9);
    other.life(0);
    other.send(other.finish({ mode: "early", winner: "none" }));
    const player = other.view(other.players[2]);
    expect(player.result).toMatchObject({
      winner: "none",
      mode: "early",
      suggestions: [],
    });
    expect(player.recap).toBeUndefined();
    expect(player.storyteller).toBeUndefined();
    expect(other.preview().seats).toHaveLength(10);
  });

  it("rejects unauthorized/stale endings; notes and chat do not invalidate the confirmation; retries are idempotent", () => {
    const f = fixture(),
      command = f.finish({ mode: "early", winner: "none" });
    expect(() => f.send(command, f.players[0])).toThrow("仅限说书人");
    f.condition(2, "poisoned", true);
    expect(() => f.send(command)).toThrow("确认内容已变化");
    const current = f.finish({ mode: "early", winner: "none" }),
      receipt = randomUUID();
    f.send({ type: "add_note", body: "private" }, f.players[1]);
    f.send(
      { type: "send_message", to: "storyteller", content: "clarification" },
      f.players[1],
    );
    f.send(current, f.host, receipt);
    const result = f.view().result;
    f.send(current, f.host, receipt);
    expect(f.view().result).toEqual(result);
    expect(() => f.send(current)).toThrow("游戏已结束");
  });
});

describe("concise factual recap", () => {
  it("records confirmed poison/protection and truthful information snapshots, never treats acknowledgement as effect", () => {
    const f = fixture();
    const poison = f.action(1, "poisoner", [3]);
    f.apply(poison, "poison");
    const inspect = f.action(3, "fortuneteller", [0, 2]);
    f.send({
      type: "send_action_response",
      actionId: inspect,
      response: "否",
      expectedVersion: 1,
    });
    const acknowledge = f.action(1, "poisoner", [8]);
    f.send({
      type: "send_action_response",
      actionId: acknowledge,
      response: "已收到",
      expectedVersion: 1,
    });
    f.condition(3, "poisoned", false);
    f.send({
      type: "correct_action_response",
      actionId: inspect,
      response: "是",
      reason: "更正口误",
      expectedResponseVersion: 1,
      expectedContextVersion: f.st().contextVersion,
    });
    f.phase("OTHER_NIGHT");
    f.apply(f.action(4, "monk", [8]), "protect");
    f.send(
      { type: "send_message", to: f.ids[2], content: "私聊不公开" },
      f.players[1],
    );
    f.send({ type: "add_note", body: "笔记不公开" }, f.players[1]);
    f.send(f.finish({ reason: "线下确认游戏结果" }));
    const recap = f.view(f.players[0]).recap!;
    const firstPoison = recap.entries.find((e) => e.id === `action:${poison}`)!;
    expect(firstPoison).toMatchObject({ day: 1, period: "NIGHT" });
    expect(firstPoison.text).toContain("2 号（投毒者）选择下毒 4 号");
    expect(firstPoison.text).toContain("已为 4 号标记中毒");
    expect(
      recap.entries.find((e) => e.id === `action:${acknowledge}`)!.text,
    ).toContain("未在行动上登记实际效果");
    const info = recap.entries.find((e) => e.id === `action:${inspect}`)!.text;
    expect(info).toContain("中毒或醉酒");
    expect(info).toContain("当时实际参考");
    expect(info).toContain("最终告知玩家：是（已更正）");
    expect(
      recap.entries.some((e) => e.day === 2 && e.text.includes("标记保护")),
    ).toBe(true);
    expect(recap.seats[0].initial!.actualRoleId).toBe("imp");
    expect(JSON.stringify(recap)).not.toContain("私聊不公开");
    expect(JSON.stringify(recap)).not.toContain("笔记不公开");
    expect(JSON.stringify(recap)).not.toContain(f.host.token);
    expect(recap.entries.map((e) => e.day)).toEqual(
      [...recap.entries.map((e) => e.day)].sort(),
    );
  });

  it("cancels unfinished actions/votes on finish without reporting draft responses as delivered", () => {
    const f = fixture(),
      id = f.action(2, "empath", []);
    f.send({ type: "review_action", actionId: id, response: "尚未告知的草稿" });
    expect(f.review().pendingActions).toBe(1);
    f.send(f.finish({ reason: "说书人提前裁定胜负" }));
    expect(f.view().actions[0].status).toBe("CANCELLED");
    expect(JSON.stringify(f.view().recap)).not.toContain("尚未告知的草稿");
    const day = fixture();
    day.phase("DAY");
    day.send({ type: "open_vote", nominator: day.ids[2], nominee: day.ids[3] });
    expect(day.review().activeVote).toBe(true);
    day.send(day.finish({ mode: "early", winner: "none" }));
    expect(day.view().liveVote!.status).toBe("CANCELLED");
  });

  it("supports private draft edits, hidden items and public post-game corrections with optimistic versions", () => {
    const f = fixture();
    f.life(8);
    const original = f.preview().entries[0];
    const edit: Command = {
      type: "edit_recap",
      entryId: original.id,
      expectedVersion: f.preview().version,
      day: 1,
      period: "NIGHT",
      text: "这是误记，复盘暂不展示",
      hidden: true,
    };
    expect(() => f.send(edit, f.players[0])).toThrow("仅限说书人");
    f.send(edit);
    expect(() => f.send(edit)).toThrow("新版本");
    f.send({
      type: "edit_recap",
      expectedVersion: f.preview().version,
      day: 1,
      period: "NIGHT",
      text: "镇长转移了本夜击杀目标（线下裁定）",
      hidden: false,
    });
    expect(f.view(f.players[0]).recap).toBeUndefined();
    f.send(f.finish({ reason: "人工裁定" }));
    const recap = f.view(f.players[0]).recap!;
    expect(recap.entries).toHaveLength(1);
    expect(recap.entries[0].text).toContain("线下裁定");
    f.send({
      ...edit,
      expectedVersion: f.preview().version,
      hidden: false,
      text: "9 号本夜死亡，已由说书人核实",
    });
    expect(f.view(f.players[0]).recap!.entries).toHaveLength(2);
    expect(f.view().result!.winner).toBe("good");
  });

  it("persists the published recap, archives it independently of new assignments, and resets new-round state", () => {
    const f = fixture();
    f.life(9);
    f.life(0);
    f.send(f.finish());
    const recap = f.view(f.players[1]).recap!;
    expect(
      new GameService(f.store).view(f.host.code, f.players[1].token).recap,
    ).toEqual(recap);
    f.send({ type: "new_round" });
    expect(f.view(f.players[1]).recap).toBeUndefined();
    expect(f.view(f.players[1]).pastRecaps).toEqual([]);
    expect(f.view().storyteller!.recapPreview).toBeUndefined();
    f.send({ type: "open_registration" });
    expect(f.view(f.players[1]).pastRecaps).toEqual([]);
    expect(f.view().pastRecaps).toEqual([recap]);
    expect(f.view().result).toBeUndefined();
    expect(f.preview().entries).toEqual([]);
    expect(f.review().buttonLabel).toBe("提前结束");
  });

  it("marks legacy history gaps explicitly instead of reconstructing initial identities or unrecorded poison effects", () => {
    const f = fixture();
    const room = f.store.get(f.host.code)!;
    delete room.initialAssignments;
    delete room.recapLog;
    delete room.recapVersion;
    room.conditions[f.ids[2]] = {
      poisoned: true,
      protected: false,
      drunk: false,
      note: "不推断是谁下的毒",
    };
    f.store.save(room);
    expect(f.preview().limitations.join("")).toContain("缺少开局身份快照");
    expect(f.preview().entries).toEqual([]);
    expect(f.preview().seats[0].initial).toBeUndefined();
    f.send(f.finish({ reason: "旧存档人工裁定" }));
    expect(f.view(f.players[1]).recap!.entries).toEqual([]);
  });
});
