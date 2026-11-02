import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store";
import { GameService } from "../server/game";
import { commandWithContext } from "../shared/command-context";
import { emptyConditions } from "../server/information";
import type { Command } from "../shared/commands";
import type { Session } from "../shared/types";

const stores: Store[] = [];
afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  vi.restoreAllMocks();
});
function twelvePlayerRoom() {
  const store = new Store(":memory:");
  stores.push(store);
  const game = new GameService(store);
  const host = game.create(12, "Twelve-player review fixes");
  const view = (session: Session = host) =>
    game.view(session.code, session.token);
  const capture = (command: Command, session: Session = host) =>
    commandWithContext(command, view(session));
  const raw = (
    command: Command,
    session: Session = host,
    receipt = randomUUID(),
    gameNo = view(session).gameNo,
  ) => game.execute(session.code, session.token, receipt, command, gameNo);
  const act = (
    command: Command,
    session: Session = host,
    receipt = randomUUID(),
  ) => raw(capture(command, session), session, receipt);
  act({
    type: "save_setup",
    setup: {
      roleIds: [
        "washerwoman",
        "librarian",
        "chef",
        "empath",
        "fortuneteller",
        "undertaker",
        "ravenkeeper",
        "drunk",
        "recluse",
        "poisoner",
        "spy",
        "imp",
      ],
      drunkAs: "soldier",
      bluffs: ["virgin", "slayer", "mayor"],
      overrideReason: "",
    },
  });
  act({ type: "open_registration" });
  const players = Array.from({ length: 12 }, (_, index) =>
    game.join(host.code, index + 1),
  );
  const ids = players.map((player) => view(player).viewer.seatId!);
  const seat = (role: string) =>
    Object.entries(view().storyteller!.assignments).find(
      ([, assignment]) => assignment.actualRoleId === role,
    )![0];
  const player = (role: string) => players[ids.indexOf(seat(role))];
  const life = (seatId: string, session: Session = host) =>
    view(session).seats.find((s) => s.id === seatId)!.alive;
  const change = (
    seatId: string,
    changes: Partial<Extract<Command, { type: "update_player" }>> = {},
  ) =>
    act({
      type: "update_player",
      seatId,
      ...view().storyteller!.assignments[seatId],
      alive: life(seatId),
      conditions: view().storyteller!.conditions[seatId] ?? emptyConditions(),
      reason: "Host-only state correction",
      expectedContextVersion: view().storyteller!.contextVersion,
      ...changes,
    });
  const request = (role: string, targetCount = 0) => {
    act({
      type: "request_action",
      seatId: seat(role),
      referenceRoleId: role,
      prompt: "Functional check",
      targetCount,
    });
    return view().actions.at(-1)!;
  };
  const execute = (seatId: string, died = true) => {
    act({
      type: "execute_player",
      seatId,
      died,
      reason: "Execution record",
      confirmed: true,
      expectedContextVersion: view().storyteller!.contextVersion,
    });
    return view().storyteller!.executions.at(-1)!;
  };
  const planCommand = (
    command: Omit<
      Extract<Command, { type: "plan_item" }>,
      "expectedPhaseVersion" | "expectedPlanVersion"
    >,
  ) => ({
    ...command,
    expectedPhaseVersion: view().storyteller!.phaseVersion,
    expectedPlanVersion: view().storyteller!.planVersion,
  });
  const plan = (
    itemId: string,
    operation: Extract<Command, { type: "plan_item" }>["operation"],
  ) => act(planCommand({ type: "plan_item", itemId, operation }));
  const generate = () =>
    act({
      type: "generate_night_plan",
      expectedPhaseVersion: view().storyteller!.phaseVersion,
      expectedPlanVersion: view().storyteller!.planVersion,
    });
  return {
    game,
    store,
    host,
    players,
    ids,
    view,
    capture,
    raw,
    act,
    seat,
    player,
    life,
    change,
    request,
    execute,
    planCommand,
    plan,
    generate,
  };
}

describe("A1 — phase transitions use the phase actually seen by the host", () => {
  it("rejects two independent commands from the same old phase and preserves exact retry idempotency", () => {
    const f = twelvePlayerRoom();
    const oldA = f.capture({ type: "next_phase" });
    const oldB = f.capture({ type: "next_phase" });
    const receipt = randomUUID();
    f.raw(oldA, f.host, receipt);
    f.raw(oldA, f.host, receipt);
    expect(() => f.raw(oldB)).toThrow(/阶段/);
    expect(f.view()).toMatchObject({ phase: "DAY", day: 1 });
    expect(
      f.view().publicRecords.filter((record) => record.type === "phase"),
    ).toHaveLength(1);
  });

  it("rejects a late action-creation packet from a previous night", () => {
    const f = twelvePlayerRoom();
    const late = f.capture({
      type: "request_action",
      seatId: f.seat("chef"),
      prompt: "First-night only draft",
      targetCount: 0,
    });
    f.act({ type: "next_phase" });
    f.act({ type: "next_phase" });
    expect(() => f.raw(late)).toThrow(/夜晚已变化/);
    expect(f.view().actions).toEqual([]);
    expect(f.view()).toMatchObject({ phase: "OTHER_NIGHT", day: 2 });
  });

  it("corrects the phase with an audit reason, clears the timer and cancels unfinished actions before publishing dawn", () => {
    const f = twelvePlayerRoom();
    f.act({ type: "next_phase" });
    f.act({ type: "day_timer", operation: "start", seconds: 300 });
    f.act({
      type: "correct_phase",
      phase: "FIRST_NIGHT",
      day: 1,
      reason: "Return to first night after wrong advance",
      expectedPhaseVersion: f.view().storyteller!.phaseVersion,
    });
    expect(f.view().storyteller!.dayTimer).toBeUndefined();
    const action = f.request("fortuneteller", 2);
    f.act({ type: "set_alive", seatId: f.seat("chef"), alive: false });
    const oldCorrection: Command = {
      type: "correct_phase",
      phase: "DAY",
      day: 1,
      reason: "Reconfirm dawn",
      expectedPhaseVersion: f.view().storyteller!.phaseVersion,
    };
    f.act(oldCorrection);
    expect(f.view()).toMatchObject({ phase: "DAY", day: 1 });
    expect(f.view().actions.find((a) => a.id === action.id)!.status).toBe(
      "CANCELLED",
    );
    expect(f.players.every((p) => !f.life(f.seat("chef"), p))).toBe(true);
    expect(
      f
        .view()
        .publicRecords.some(
          (r) => r.type === "phase" && r.text.includes("Reconfirm dawn"),
        ),
    ).toBe(true);
    expect(() => f.raw(oldCorrection)).toThrow(/阶段/);
    expect(() =>
      f.act({
        type: "correct_phase",
        phase: "FIRST_NIGHT",
        day: 2,
        reason: "invalid",
        expectedPhaseVersion: f.view().storyteller!.phaseVersion,
      }),
    ).toThrow(/第 1 夜/);
  });
});

describe("A2 — death and execution corrections agree with Undertaker references", () => {
  it.each(["set_alive", "update_player"] as const)(
    "restoring life through %s revokes erroneous execution death without erasing history",
    (command) => {
      const f = twelvePlayerRoom();
      f.act({ type: "next_phase" });
      const target = f.seat("chef");
      const original = f.execute(target);
      if (command === "set_alive")
        f.act({ type: "set_alive", seatId: target, alive: true });
      else f.change(target, { alive: true });
      const history = f.view().storyteller!.executions;
      expect(history.find((e) => e.id === original.id)!.died).toBe(true);
      expect(history.find((e) => e.supersedes === original.id)).toMatchObject({
        died: false,
        voided: true,
      });
      expect(f.players.every((p) => f.life(target, p))).toBe(true);
      expect(
        f.players.every(
          (p) =>
            !JSON.stringify(f.view(p)).includes("Host-only state correction"),
        ),
      ).toBe(true);
      expect(
        f
          .view()
          .publicRecords.some((r) => r.supersedes === original.publicRecordId),
      ).toBe(true);
      f.act({ type: "next_phase" });
      const information = f.request("undertaker").reference!;
      expect(information.suggestedResponse).toBeUndefined();
      expect(information.actual).toContain("没有上一白天");
    },
  );

  it("can explicitly backfill an execution death after ordinary death entry and keeps its original identity snapshot", () => {
    const f = twelvePlayerRoom();
    f.act({ type: "next_phase" });
    const target = f.seat("chef");
    f.act({ type: "set_alive", seatId: target, alive: false });
    const execution = f.execute(target, true);
    expect(execution.died).toBe(true);
    f.change(target, { actualRoleId: "mayor", perceivedRoleId: "mayor" });
    f.act({ type: "next_phase" });
    expect(f.request("undertaker").reference!.suggestedResponse).toBe("厨师");
    expect(
      f.players.every(
        (p) => !JSON.stringify(f.view(p).publicRecords).includes("厨师"),
      ),
    ).toBe(true);
  });

  it("revises execution cause with a linked public correction, rejects stale records and updates the reference", () => {
    const f = twelvePlayerRoom();
    f.act({ type: "next_phase" });
    const target = f.seat("chef"),
      original = f.execute(target);
    f.act({
      type: "correct_execution",
      executionId: original.id,
      died: false,
      voided: false,
      alive: true,
      reason: "Execution did not cause death",
      expectedContextVersion: f.view().storyteller!.contextVersion,
    });
    const corrected = f.view().storyteller!.executions.at(-1)!;
    expect(corrected).toMatchObject({
      supersedes: original.id,
      died: false,
      voided: false,
    });
    expect(f.life(target)).toBe(true);
    expect(() =>
      f.act({
        type: "correct_execution",
        executionId: original.id,
        died: true,
        voided: false,
        alive: false,
        reason: "stale",
        expectedContextVersion: f.view().storyteller!.contextVersion,
      }),
    ).toThrow(/已更正/);
    f.act({ type: "next_phase" });
    const action = f.request("undertaker");
    expect(action.reference!.suggestedResponse).toBeUndefined();
    f.act({
      type: "correct_execution",
      executionId: corrected.id,
      died: true,
      voided: false,
      alive: false,
      reason: "Correct previous cause",
      expectedContextVersion: f.view().storyteller!.contextVersion,
    });
    expect(
      f.view().actions.find((a) => a.id === action.id)!.reference!
        .suggestedResponse,
    ).toBe("厨师");
  });
});

describe("B1 — real night deaths are private until publication", () => {
  it("lets the host postpone dawn publication and explicitly publish later in the day", () => {
    const f = twelvePlayerRoom();
    const target = f.seat("chef");
    f.act({ type: "set_alive", seatId: target, alive: false });
    f.act({ type: "next_phase", publishLifeOnDawn: false });
    expect(f.view().phase).toBe("DAY");
    for (const p of f.players) {
      expect(f.life(target, p)).toBe(true);
      expect(f.view(p).publicRecords.some((r) => r.type === "status")).toBe(
        false,
      );
    }
    f.act({
      type: "publish_life",
      seatIds: [target],
      expectedContextVersion: f.view().storyteller!.contextVersion,
    });
    expect(f.players.every((p) => !f.life(target, p))).toBe(true);
  });
  it("uses real death for the host while withholding it from all twelve players, then publishes at dawn", () => {
    const f = twelvePlayerRoom();
    const target = f.seat("chef");
    f.act({ type: "set_alive", seatId: target, alive: false });
    expect(f.life(target)).toBe(false);
    expect(f.view().storyteller!.publishedAlive[target]).toBe(true);
    for (const p of f.players) {
      expect(f.life(target, p)).toBe(true);
      expect(f.view(p).publicRecords).toEqual([]);
      expect(f.view(p).storyteller).toBeUndefined();
    }
    f.act({ type: "next_phase" });
    expect(f.players.every((p) => !f.life(target, p))).toBe(true);
    expect(
      f.view().publicRecords.filter((r) => r.type === "status"),
    ).toHaveLength(1);
    expect(
      f.view().publicRecords.find((r) => r.type === "status")!.period,
    ).toBe("DAY");
  });

  it("publishes only explicitly selected players during the night and retains all other private states", () => {
    const f = twelvePlayerRoom();
    const selected = f.seat("chef"),
      hidden = f.seat("washerwoman");
    f.change(selected, { alive: false });
    f.change(hidden, {
      alive: false,
      conditions: {
        ...emptyConditions(),
        poisoned: true,
        note: "HOST-ONLY-NIGHT-STATE",
      },
    });
    const publish: Command = {
      type: "publish_life",
      seatIds: [selected],
      expectedContextVersion: f.view().storyteller!.contextVersion,
    };
    expect(() => f.raw(publish, f.players[0])).toThrow(/说书人/);
    f.act(publish);
    for (const p of f.players) {
      expect(f.life(selected, p)).toBe(false);
      expect(f.life(hidden, p)).toBe(true);
      expect(JSON.stringify(f.view(p))).not.toContain("HOST-ONLY-NIGHT-STATE");
    }
    expect(
      f.view().publicRecords.filter((r) => r.type === "status"),
    ).toHaveLength(1);
    expect(() => f.raw(publish)).toThrow(/状态已变化/);
  });
});

describe("B3 — timer commands target the instance the host saw", () => {
  it("rejects stale pause and clear after replacement, rejects a duplicate pause, and expires without game side effects", () => {
    const f = twelvePlayerRoom();
    f.act({ type: "next_phase" });
    const clock = vi.spyOn(Date, "now").mockReturnValue(100000);
    f.act({ type: "day_timer", operation: "start", seconds: 60 });
    const stalePause = f.capture({ type: "day_timer", operation: "pause" });
    const staleClear = f.capture({ type: "day_timer", operation: "clear" });
    f.act({ type: "day_timer", operation: "start", seconds: 600 });
    expect(() => f.raw(stalePause)).toThrow(/计时器已变化/);
    expect(() => f.raw(staleClear)).toThrow(/计时器已变化/);
    expect(f.view().storyteller!.dayTimer!.endsAt).toBe(700000);
    const pause = f.capture({ type: "day_timer", operation: "pause" });
    clock.mockReturnValue(110000);
    f.raw(pause);
    expect(() => f.raw(pause)).toThrow(/计时器已变化/);
    expect(f.view().storyteller!.dayTimer!.remainingMs).toBe(590000);
    f.act({ type: "day_timer", operation: "resume" });
    const deadline = f.view().storyteller!.dayTimer!.endsAt!;
    const before = {
      phase: f.view().phase,
      day: f.view().day,
      seats: f.view().seats,
      publicRecords: f.view().publicRecords,
    };
    clock.mockReturnValue(deadline + 10000);
    const reloaded = new GameService(f.store).view(f.host.code, f.host.token);
    expect({
      phase: reloaded.phase,
      day: reloaded.day,
      seats: reloaded.seats,
      publicRecords: reloaded.publicRecords,
    }).toEqual(before);
    expect(reloaded.storyteller!.dayTimer!.endsAt).toBe(deadline);
    for (const p of f.players)
      expect(JSON.stringify(f.view(p))).not.toContain("dayTimer");
  });
});

describe("B4 — corrected feedback retains history but stays private", () => {
  it("delivers the replacement and prior versions only to its owner, rejects conflicting edits and preserves the original truth snapshot", () => {
    const f = twelvePlayerRoom(),
      owner = f.player("empath"),
      actor = f.seat("empath");
    f.change(actor, {
      conditions: {
        ...emptyConditions(),
        poisoned: true,
        note: "SECRET-POISON",
      },
    });
    const action = f.request("empath");
    f.act({
      type: "send_action_response",
      actionId: action.id,
      response: "OLD-RESULT",
      expectedVersion: 0,
      expectedContextVersion: action.reference!.contextVersion,
    });
    const originalReference = f.view().actions[0].reference;
    const command: Command = {
      type: "correct_action_response",
      actionId: action.id,
      response: "CORRECTED-RESULT",
      reason: "Corrected a typo",
      expectedResponseVersion: 1,
      expectedContextVersion: f.view().storyteller!.contextVersion,
    };
    expect(() => f.raw(command, owner)).toThrow(/说书人/);
    f.act(command);
    const received = f.view(owner).actions[0];
    expect(received.response).toBe("CORRECTED-RESULT");
    expect(received.responseVersion).toBe(2);
    expect(
      received.responseHistory?.map((r) => ({
        version: r.version,
        response: r.response,
      })),
    ).toEqual([
      { version: 1, response: "OLD-RESULT" },
      { version: 2, response: "CORRECTED-RESULT" },
    ]);
    expect(f.view().actions[0].reference).toEqual(originalReference);
    expect(() => f.raw(command)).toThrow(/新版本/);
    for (const p of f.players) {
      const text = JSON.stringify(f.view(p));
      expect(text).not.toContain("SECRET-POISON");
      expect(text).not.toContain('"reference"');
      if (p.token !== owner.token) {
        expect(text).not.toContain("OLD-RESULT");
        expect(text).not.toContain("CORRECTED-RESULT");
        expect(text).not.toContain("Corrected a typo");
      }
    }
    f.act({ type: "next_phase" });
    f.act({
      type: "correct_action_response",
      actionId: action.id,
      response: "LATEST-RESULT",
      reason: "Daytime clarification",
      expectedResponseVersion: 2,
      expectedContextVersion: f.view().storyteller!.contextVersion,
    });
    expect(f.view(owner).actions[0].responseVersion).toBe(3);
  });
});

describe("C1 — optional night plans stay separate from required player actions", () => {
  it("generates private suggestions without notifying players or blocking dawn, and rejects stale duplicate generation", () => {
    const f = twelvePlayerRoom();
    const generate: Command = {
      type: "generate_night_plan",
      expectedPhaseVersion: f.view().storyteller!.phaseVersion,
      expectedPlanVersion: f.view().storyteller!.planVersion,
    };
    f.act(generate);
    expect(f.view().storyteller!.nightPlan.length).toBeGreaterThan(2);
    expect(f.view().actions).toEqual([]);
    for (const p of f.players) {
      expect(f.view(p).actions).toEqual([]);
      expect(JSON.stringify(f.view(p))).not.toContain("nightPlan");
      expect(f.view(p).publicRecords).toEqual([]);
    }
    expect(() => f.raw(generate)).toThrow(/清单已有修改/);
    expect(() => f.generate()).toThrow(/本夜已有清单/);
    f.act({ type: "next_phase" });
    expect(f.view().phase).toBe("DAY");
  });

  it("starts a suggestion once, deduplicates exact retries and blocks an independent repeat", () => {
    const f = twelvePlayerRoom();
    f.generate();
    const item = f
      .view()
      .storyteller!.nightPlan.find((i) => i.roleId === "fortuneteller")!;
    const start = f.planCommand({
      type: "plan_item",
      itemId: item.id,
      operation: "start",
    });
    const receipt = randomUUID();
    f.raw(start, f.host, receipt);
    f.raw(start, f.host, receipt);
    expect(f.view().actions).toHaveLength(1);
    expect(f.view(f.player("fortuneteller")).actions[0]).toMatchObject({
      status: "REQUESTED",
      targetCount: 2,
    });
    expect(
      f.view().storyteller!.nightPlan.find((i) => i.id === item.id)!.status,
    ).toBe("started");
    expect(() => f.raw(start)).toThrow(/清单已有修改/);
    expect(() => f.plan(item.id, "start")).toThrow(/已经处理/);
    expect(f.view().actions).toHaveLength(1);
    expect(() => f.act({ type: "next_phase" })).toThrow(/待办/);
    f.act({
      type: "resolve_action",
      actionId: f.view().actions[0].id,
      resolution: "OFFLINE",
      reason: "Handled at table",
    });
    f.act({ type: "next_phase" });
    expect(f.view().phase).toBe("DAY");
  });

  it("lets the host edit, order, skip, restore and complete suggestions offline without sending player actions", () => {
    const f = twelvePlayerRoom();
    f.generate();
    const original = f.view().storyteller!.nightPlan;
    const item = original.find((i) => i.roleId === "chef")!;
    f.act({
      type: "save_plan_item",
      itemId: item.id,
      seatId: item.seatId,
      roleId: item.roleId,
      prompt: "Edited chef reminder",
      targetCount: 0,
      note: "HOST-PLAN-NOTE",
      expectedPhaseVersion: f.view().storyteller!.phaseVersion,
      expectedPlanVersion: f.view().storyteller!.planVersion,
    });
    const beforeIndex = f
      .view()
      .storyteller!.nightPlan.findIndex((i) => i.id === item.id);
    f.plan(item.id, "up");
    expect(
      f.view().storyteller!.nightPlan.findIndex((i) => i.id === item.id),
    ).toBe(beforeIndex - 1);
    f.plan(item.id, "down");
    expect(
      f.view().storyteller!.nightPlan.findIndex((i) => i.id === item.id),
    ).toBe(beforeIndex);
    f.plan(item.id, "skip");
    expect(
      f.view().storyteller!.nightPlan.find((i) => i.id === item.id)!.status,
    ).toBe("skipped");
    f.plan(item.id, "restore");
    f.plan(item.id, "offline");
    expect(
      f.view().storyteller!.nightPlan.find((i) => i.id === item.id),
    ).toMatchObject({ status: "offline", prompt: "Edited chef reminder" });
    expect(f.view().actions).toEqual([]);
    for (const p of f.players) {
      expect(f.view(p).actions).toEqual([]);
      expect(JSON.stringify(f.view(p))).not.toContain("HOST-PLAN-NOTE");
    }
    const hostOnly = f.view().storyteller!.nightPlan.find((i) => !i.seatId)!;
    expect(() => f.plan(hostOnly.id, "start")).toThrow(/仅说书人/);
    f.plan(hostOnly.id, "offline");
    f.act({ type: "next_phase" });
    expect(f.view().phase).toBe("DAY");
  });

  it("rejects player management, old-night plan edits and old-game packets, then resets the plan for a new round", () => {
    const f = twelvePlayerRoom();
    const generate: Command = {
      type: "generate_night_plan",
      expectedPhaseVersion: f.view().storyteller!.phaseVersion,
      expectedPlanVersion: f.view().storyteller!.planVersion,
    };
    expect(() => f.raw(generate, f.players[0])).toThrow(/说书人/);
    f.generate();
    const item = f.view().storyteller!.nightPlan[0];
    const oldNight = f.planCommand({
      type: "plan_item",
      itemId: item.id,
      operation: "skip",
    });
    f.act({ type: "next_phase" });
    f.act({ type: "next_phase" });
    expect(() => f.raw(oldNight)).toThrow(/夜晚已变化/);
    f.act({ type: "end" });
    f.act({ type: "new_round" });
    expect(f.view().storyteller!.nightPlan).toEqual([]);
    expect(f.view().storyteller!.executions).toEqual([]);
    expect(f.players.every((p) => f.view(p).seats.every((s) => s.alive))).toBe(
      true,
    );
    expect(f.view().seats.map((s) => s.id)).toEqual(f.ids);
    expect(() => f.raw(generate, f.host, randomUUID(), 1)).toThrow(/新一局/);
  });
});
