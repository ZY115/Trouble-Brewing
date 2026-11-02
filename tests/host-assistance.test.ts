import { afterEach, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Store } from "../server/store";
import { GameService } from "../server/game";
import { commandWithContext } from "../shared/command-context";
import { emptyConditions } from "../server/information";
import { randomSetup, validateSetup } from "../shared/setup";
import { FIRST_NIGHT_ORDER, OTHER_NIGHT_ORDER } from "../shared/night-order";
import { randomFirstInformation } from "../shared/first-information";
import { phaseReview } from "../shared/phase-review";
import { isEvil } from "../shared/roles";
import type { Command } from "../shared/commands";
import type { Session } from "../shared/types";
const stores: Store[] = [];
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  vi.restoreAllMocks();
});
function fixture() {
  const store = new Store(":memory:");
  stores.push(store);
  const game = new GameService(store),
    host = game.create(12, "Host assistance");
  const view = (s = host) => game.view(s.code, s.token),
    ctx = () => view().storyteller!.contextVersion;
  const act = (c: Command, s: Session = host, id = randomUUID()) =>
    game.execute(
      s.code,
      s.token,
      id,
      commandWithContext(c, view(s)),
      view(s).gameNo,
    );
  act({ type: "open_registration" });
  const players = Array.from({ length: 12 }, (_, i) =>
      game.join(host.code, i + 1),
    ),
    ids = players.map((p) => view(p).viewer.seatId!);
  const initiallyRecommended = view().storyteller!.redHerring!;
  expect(
    isEvil(view().storyteller!.assignments[initiallyRecommended].actualRoleId),
  ).toBe(false);
  const roles = [
    "washerwoman",
    "librarian",
    "empath",
    "fortuneteller",
    "undertaker",
    "imp",
    "poisoner",
    "monk",
    "scarletwoman",
    "saint",
    "soldier",
    "ravenkeeper",
  ];
  const change = (
    n: number,
    patch: Partial<Extract<Command, { type: "update_player" }>> = {},
  ) =>
    act({
      type: "update_player",
      seatId: ids[n - 1],
      ...view().storyteller!.assignments[ids[n - 1]],
      alive: view().seats[n - 1].alive,
      conditions:
        view().storyteller!.conditions[ids[n - 1]] ?? emptyConditions(),
      reason: "",
      expectedContextVersion: ctx(),
      ...patch,
    });
  roles.forEach((role, i) =>
    change(i + 1, { actualRoleId: role, perceivedRoleId: role }),
  );
  const cond = (
    n: number,
    condition: "poisoned" | "protected" | "drunk",
    value = true,
  ) =>
    act({
      type: "set_condition",
      seatId: ids[n - 1],
      condition,
      value,
      expectedContextVersion: ctx(),
    });
  const death = (n: number) =>
    act({ type: "set_alive", seatId: ids[n - 1], alive: false });
  const night2 = () => {
    act({ type: "next_phase" });
    act({ type: "next_phase" });
  };
  const plan = () => ({
    expectedPhaseVersion: view().storyteller!.phaseVersion,
    expectedPlanVersion: view().storyteller!.planVersion,
  });
  const execute = (n: number) =>
    act({
      type: "execute_player",
      seatId: ids[n - 1],
      reason: "Test execution",
      confirmed: true,
      died: true,
      expectedContextVersion: ctx(),
    });
  const action = (
    n: number,
    target: number,
    choiceKind: "poison" | "protect" | "kill",
  ) => {
    act({
      type: "request_action",
      seatId: ids[n - 1],
      prompt: "Test choice",
      targetCount: 1,
      choiceKind,
    });
    const a = view().actions.at(-1)!;
    act(
      {
        type: "submit_action",
        actionId: a.id,
        targets: [ids[target - 1]],
        expectedVersion: 0,
      },
      players[n - 1],
    );
    return a.id;
  };
  const apply = (
    id: string,
    effect: "poison" | "protect" | "kill" | "none",
    force = false,
  ) =>
    act({
      type: "apply_action",
      actionId: id,
      effect,
      force,
      response: "已收到",
      expectedVersion: view().actions.find((a) => a.id === id)!
        .selectionVersion!,
      expectedContextVersion: ctx(),
    });
  return {
    store,
    game,
    host,
    players,
    ids,
    view,
    ctx,
    act,
    change,
    cond,
    death,
    night2,
    plan,
    execute,
    action,
    apply,
  };
}
describe("reference night order and concurrent collection", () => {
  it("does not bulk-start untriggered conditional roles or dead players", () => {
    const f = fixture();
    f.night2();
    f.death(3);
    f.act({ type: "generate_night_plan", ...f.plan() });
    f.act({ type: "start_all_plan", ...f.plan() });
    expect(
      f
        .view()
        .actions.some((a) =>
          [f.ids[2], f.ids[4], f.ids[11]].includes(a.seatId),
        ),
    ).toBe(false);
    f.death(12);
    f.act({ type: "start_all_plan", ...f.plan() });
    expect(
      f.view(f.players[11]).actions.some((a) => a.status === "REQUESTED"),
    ).toBe(true);
  });
  it("matches the pinned TB reference night order exactly", () => {
    const sheet = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/tb-night-order.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(FIRST_NIGHT_ORDER).toEqual(sheet.firstNight);
    expect(OTHER_NIGHT_ORDER).toEqual(sheet.otherNight);
    expect(OTHER_NIGHT_ORDER.at(-1)).toBe("spy");
  });
  it("starts all player items once, skips storyteller checks, and leaves resolutions to the host", () => {
    const f = fixture();
    f.act({ type: "generate_night_plan", ...f.plan() });
    const before = f.view().storyteller!.nightPlan;
    const packet = { type: "start_all_plan" as const, ...f.plan() };
    f.act(packet);
    expect(f.view().actions).toHaveLength(
      before.filter((i) => i.seatId).length,
    );
    expect(f.view().actions.every((a) => a.status !== "DELIVERED")).toBe(true);
    expect(
      f
        .view()
        .storyteller!.nightPlan.filter((i) => !i.seatId)
        .every((i) => i.status === "planned"),
    ).toBe(true);
    expect(() => f.act(packet)).toThrow(/清单/);
    expect(() =>
      f.act({ type: "start_all_plan", ...f.plan() }, f.players[0]),
    ).toThrow(/说书人/);
  });
});
describe("death snapshots and reminders", () => {
  it("also blocks restoring obsolete predecessor entries saved by the old version", () => {
    const f = fixture();
    f.night2();
    f.death(9);
    f.act({ type: "generate_night_plan", ...f.plan() });
    const item = f
      .view()
      .storyteller!.nightPlan.find((i) => i.roleId === "poisoner")!;
    f.apply(f.action(6, 6, "kill"), "kill");
    const notice = f
      .view()
      .storyteller!.notices.find((n) => n.kind === "demon")!;
    f.act({
      type: "promote_imp",
      deathId: notice.deathId!,
      seatId: f.ids[6],
      confirmed: true,
      expectedContextVersion: f.ctx(),
    });
    const old = f.store.get(f.host.code)!;
    delete old.nightPlan.find((i) => i.id === item.id)!.retiredReason;
    f.store.save(old);
    expect(() =>
      f.act({
        type: "plan_item",
        itemId: item.id,
        operation: "restore",
        ...f.plan(),
      }),
    ).toThrow(/历史/);
    const restored = f.store.get(f.host.code)!;
    restored.nightPlan.find((i) => i.id === item.id)!.status = "planned";
    f.store.save(restored);
    expect(() =>
      f.act({
        type: "plan_item",
        itemId: item.id,
        operation: "start",
        ...f.plan(),
      }),
    ).toThrow(/失效/);
  });
  it.each(["delivered", "offline", "pending", "planned"])(
    "preserves %s poison history on succession and refuses obsolete restoration",
    (mode) => {
      const f = fixture();
      f.night2();
      f.death(9);
      f.act({ type: "generate_night_plan", ...f.plan() });
      const item = f
        .view()
        .storyteller!.nightPlan.find((i) => i.roleId === "poisoner")!;
      if (mode === "offline")
        f.act({
          type: "plan_item",
          itemId: item.id,
          operation: "offline",
          ...f.plan(),
        });
      if (mode === "delivered" || mode === "pending") {
        f.act({
          type: "plan_item",
          itemId: item.id,
          operation: "start",
          ...f.plan(),
        });
        const action = f.view().actions.find((a) => a.seatId === f.ids[6])!;
        if (mode === "delivered") {
          f.act(
            {
              type: "submit_action",
              actionId: action.id,
              targets: [f.ids[7]],
              expectedVersion: 0,
            },
            f.players[6],
          );
          f.apply(action.id, "poison");
        }
      }
      f.apply(f.action(6, 6, "kill"), "kill");
      const notice = f
        .view()
        .storyteller!.notices.find((n) => n.kind === "demon")!;
      const obsoletePlan = f.plan();
      f.act({
        type: "promote_imp",
        deathId: notice.deathId!,
        seatId: f.ids[6],
        confirmed: true,
        expectedContextVersion: f.ctx(),
      });
      const after = f
        .view()
        .storyteller!.nightPlan.find((i) => i.id === item.id)!;
      expect(after.status).toBe(
        mode === "delivered"
          ? "started"
          : mode === "offline"
            ? "offline"
            : "skipped",
      );
      expect(after.retiredReason).toBeTruthy();
      if (mode === "delivered") {
        expect(
          f.view().actions.find((a) => a.id === after.actionId)!.status,
        ).toBe("DELIVERED");
        expect(f.view().storyteller!.conditions[f.ids[7]].poisoned).toBe(true);
      }
      if (mode === "pending")
        expect(
          f.view().actions.find((a) => a.id === after.actionId)!.status,
        ).toBe("CANCELLED");
      expect(() =>
        f.act({
          type: "plan_item",
          itemId: item.id,
          operation: "restore",
          ...obsoletePlan,
        }),
      ).toThrow(/清单/);
      expect(() =>
        f.act({
          type: "plan_item",
          itemId: item.id,
          operation: "restore",
          ...f.plan(),
        }),
      ).toThrow(/历史/);
    },
  );
  it("completes the current Scarlet Woman check and omits it on later nights after succession", () => {
    const f = fixture();
    f.act({ type: "next_phase" });
    f.execute(6);
    f.act({ type: "next_phase" });
    f.act({ type: "generate_night_plan", ...f.plan() });
    const notice = f
      .view()
      .storyteller!.notices.find((n) => n.kind === "demon")!;
    f.act({
      type: "promote_imp",
      deathId: notice.deathId!,
      seatId: f.ids[8],
      confirmed: true,
      expectedContextVersion: f.ctx(),
    });
    expect(
      f.view().storyteller!.nightPlan.find((i) => i.roleId === "scarletwoman")!
        .status,
    ).toBe("offline");
    for (let n = 0; n < 2; n++) {
      f.act({ type: "next_phase" });
      f.act({ type: "next_phase" });
      f.act({ type: "generate_night_plan", ...f.plan() });
      expect(
        f
          .view()
          .storyteller!.nightPlan.some(
            (i) => i.night === f.view().day && i.roleId === "scarletwoman",
          ),
      ).toBe(false);
    }
  });
  it("self-kill succession cancels old requests and never grants a second kill that night", () => {
    const f = fixture();
    f.night2();
    f.act({ type: "generate_night_plan", ...f.plan() });
    f.act({ type: "start_all_plan", ...f.plan() });
    const old = f.view().actions.find((a) => a.seatId === f.ids[5])!;
    f.death(6);
    const notice = f
      .view()
      .storyteller!.notices.find((n) => n.kind === "demon")!;
    f.act({
      type: "confirm_self_kill",
      deathId: notice.deathId!,
      confirmed: true,
      expectedContextVersion: f.ctx(),
    });
    f.act({
      type: "promote_imp",
      deathId: notice.deathId!,
      seatId: f.ids[8],
      confirmed: true,
      expectedContextVersion: f.ctx(),
    });
    expect(f.view().actions.find((a) => a.id === old.id)!.status).toBe(
      "CANCELLED",
    );
    expect(
      f
        .view()
        .storyteller!.nightPlan.some(
          (i) => i.seatId === f.ids[8] && i.roleId === "imp",
        ),
    ).toBe(false);
    expect(f.view(f.players[8]).messages.at(-1)!.content).toContain("不再行动");
    for (const a of f
      .view()
      .actions.filter(
        (a) => !["DELIVERED", "OFFLINE", "CANCELLED"].includes(a.status),
      ))
      f.act({
        type: "resolve_action",
        actionId: a.id,
        resolution: "OFFLINE",
        reason: "Test",
      });
    f.act({ type: "next_phase" });
    f.act({ type: "next_phase" });
    f.act({ type: "generate_night_plan", ...f.plan() });
    expect(
      f
        .view()
        .storyteller!.nightPlan.some(
          (i) => i.seatId === f.ids[8] && i.roleId === "imp",
        ),
    ).toBe(true);
    const g = fixture();
    g.night2();
    g.apply(g.action(6, 6, "kill"), "kill");
    const pending = g
      .view()
      .storyteller!.notices.find((n) => n.kind === "demon")!;
    g.act({
      type: "promote_imp",
      deathId: pending.deathId!,
      seatId: g.ids[8],
      confirmed: true,
      expectedContextVersion: g.ctx(),
    });
    g.act({ type: "generate_night_plan", ...g.plan() });
    expect(
      g
        .view()
        .storyteller!.nightPlan.some(
          (i) => i.seatId === g.ids[8] && i.roleId === "imp",
        ),
    ).toBe(false);
  });
  it("warns on the reported executed 6 Imp / 9 Scarlet Woman scenario and adds the new Imp to an existing night plan", () => {
    const f = fixture();
    f.act({ type: "next_phase" });
    f.execute(6);
    const notice = f
      .view()
      .storyteller!.notices.find((n) => n.kind === "demon")!;
    expect(notice.candidates).toEqual([f.ids[8]]);
    expect(notice.text).toContain("死亡前12人");
    f.act({ type: "next_phase" });
    f.act({ type: "generate_night_plan", ...f.plan() });
    expect(
      f.view().storyteller!.nightPlan.some((i) => i.roleId === "scarletwoman"),
    ).toBe(true);
    f.act({
      type: "promote_imp",
      deathId: notice.deathId!,
      seatId: f.ids[8],
      confirmed: true,
      expectedContextVersion: f.ctx(),
    });
    expect(f.view(f.players[8]).self!.perceivedRoleId).toBe("imp");
    expect(
      f
        .view()
        .storyteller!.nightPlan.some(
          (i) => i.roleId === "imp" && i.seatId === f.ids[8],
        ),
    ).toBe(true);
    expect(f.view().storyteller!.notices.some((n) => n.kind === "demon")).toBe(
      false,
    );
    expect(f.view(f.players[0]).messages).toEqual([]);
    expect(f.view(f.players[0]).storyteller).toBeUndefined();
    f.act({ type: "start_all_plan", ...f.plan() });
    expect(
      f.view(f.players[8]).actions.some((a) => a.choiceKind === "kill"),
    ).toBe(true);
  });
  it.each([5, 4])(
    "checks Scarlet Woman against %i living immediately before death",
    (count) => {
      const f = fixture();
      const keep = [6, 9, 1, 2, 3].slice(0, count);
      for (let n = 1; n <= 12; n++) if (!keep.includes(n)) f.death(n);
      f.death(6);
      const n = f.view().storyteller!.notices.find((n) => n.kind === "demon")!;
      expect(n.candidates).toEqual(count === 5 ? [f.ids[8]] : []);
    },
  );
  it("does not offer poisoned or dead Scarlet Woman as an automatic candidate", () => {
    const f = fixture();
    f.cond(9, "poisoned");
    f.death(6);
    expect(
      f.view().storyteller!.notices.find((n) => n.kind === "demon")!.candidates,
    ).toEqual([]);
  });
  it("tracks self-kill passing with fewer than five alive and supports manual cause backfill", () => {
    const f = fixture();
    f.night2();
    for (const n of [1, 2, 3, 4, 5, 8, 9, 10]) f.death(n);
    const id = f.action(6, 6, "kill");
    f.apply(id, "kill");
    const notice = f
      .view()
      .storyteller!.notices.find((n) => n.kind === "demon")!;
    expect(notice.text).toContain("能力自杀");
    expect(notice.candidates).toEqual([f.ids[6]]);
    expect(
      f.view(f.players[5]).seats.find((s) => s.id === f.ids[5])!.alive,
    ).toBe(true);
    const g = fixture();
    g.night2();
    g.death(9);
    g.death(6);
    const manual = g
      .view()
      .storyteller!.notices.find((n) => n.kind === "demon")!;
    expect(manual.canConfirmSelfKill).toBe(true);
    g.act({
      type: "confirm_self_kill",
      deathId: manual.deathId!,
      confirmed: true,
      expectedContextVersion: g.ctx(),
    });
    expect(
      g.view().storyteller!.notices.find((n) => n.kind === "demon")!.candidates,
    ).toEqual([g.ids[6]]);
  });
  it("records Saint impairment at execution, preserves it after status changes, and removes voided outcomes", () => {
    const f = fixture();
    f.cond(10, "poisoned");
    f.act({ type: "next_phase" });
    f.execute(10);
    f.cond(10, "poisoned", false);
    expect(
      f.view().storyteller!.notices.find((n) => n.kind === "saint")!.text,
    ).toContain("当时有中毒");
    f.change(10, { alive: true });
    expect(f.view().storyteller!.notices.some((n) => n.kind === "saint")).toBe(
      false,
    );
  });
  it("distinguishes two alive with a demon from no demon, and warns about the three-player Mayor dusk", () => {
    const f = fixture();
    f.change(1, { actualRoleId: "mayor", perceivedRoleId: "mayor" });
    f.act({ type: "next_phase" });
    for (const n of [2, 3, 4, 5, 7, 8, 9, 10, 12]) f.death(n);
    expect(f.view().storyteller!.notices.some((n) => n.kind === "mayor")).toBe(
      true,
    );
    f.death(1);
    expect(
      f
        .view()
        .storyteller!.notices.some((n) => n.text.includes("仍有存活恶魔")),
    ).toBe(true);
    f.death(6);
    expect(
      f
        .view()
        .storyteller!.notices.some((n) => n.text.includes("不要仅凭人数")),
    ).toBe(true);
  });
});
describe("one-click effects and expiry", () => {
  it("applies poison and its receipt atomically without exposing the effect to other players", () => {
    const f = fixture(),
      id = f.action(7, 8, "poison");
    f.apply(id, "poison");
    expect(f.view().storyteller!.conditions[f.ids[7]].poisoned).toBe(true);
    expect(f.view(f.players[6]).actions[0].response).toBe("已收到");
    expect(f.view(f.players[7]).actions).toEqual([]);
    expect(f.view(f.players[7]).publicRecords).toEqual([]);
    expect(() => f.apply(id, "poison")).toThrow(/待办/);
  });
  it("requires explicit override for impairment, first-night kills, protection and Soldier, with no partial mutation", () => {
    const f = fixture();
    f.night2();
    f.cond(7, "poisoned");
    const poison = f.action(7, 8, "poison");
    const before = f.view();
    expect(() => f.apply(poison, "poison")).toThrow(/核对/);
    expect(f.view()).toEqual(before);
    f.apply(poison, "none");
    const kill = f.action(6, 11, "kill");
    expect(() => f.apply(kill, "kill")).toThrow(/核对/);
    expect(f.view().seats[10].alive).toBe(true);
    f.apply(kill, "kill", true);
    expect(f.view().seats[10].alive).toBe(false);
    expect(f.view(f.players[10]).seats[10].alive).toBe(true);
  });
  it("reminds at dawn for protection and at dusk for poison; stale clearing cannot erase a fresh effect", () => {
    const f = fixture();
    f.night2();
    f.apply(f.action(8, 2, "protect"), "protect");
    f.apply(f.action(7, 3, "poison"), "poison");
    f.cond(3, "drunk");
    f.act({ type: "next_phase" });
    expect(
      f.view().storyteller!.staleConditions.map((x) => x.condition),
    ).toEqual(["protected"]);
    f.act({ type: "next_phase" });
    const clear = {
      type: "clear_expired_conditions" as const,
      expectedContextVersion: f.ctx(),
    };
    f.apply(f.action(7, 3, "poison"), "poison");
    expect(() => f.act(clear)).toThrow(/状态/);
    f.act({
      type: "clear_expired_conditions",
      expectedContextVersion: f.ctx(),
    });
    expect(f.view().storyteller!.conditions[f.ids[2]]).toMatchObject({
      poisoned: true,
      drunk: true,
    });
    expect(f.view().storyteller!.conditions[f.ids[1]].protected).toBe(false);
  });
});
describe("first-night information", () => {
  it("sends role-appropriate private packets once, without showing specific minion roles to teammates or leaking to good", () => {
    const f = fixture();
    f.act({ type: "send_evil_info", expectedContextVersion: f.ctx() });
    expect(f.view(f.players[5]).messages[0].content).toContain("假身份");
    expect(f.view(f.players[6]).messages[0].content).toContain("恶魔是6号");
    expect(f.view(f.players[6]).messages[0].content).not.toContain("猩红女郎");
    for (const p of [0, 1, 2, 3, 4, 7, 9, 10, 11])
      expect(f.view(f.players[p]).messages).toEqual([]);
    expect(() =>
      f.act({ type: "send_evil_info", expectedContextVersion: f.ctx() }),
    ).toThrow(/已发放/);
  });
  it("excludes the recipient from truthful candidates and random pairs, while allowing manual false information", () => {
    const f = fixture();
    f.act({
      type: "request_action",
      seatId: f.ids[0],
      prompt: "Washerwoman info",
      referenceRoleId: "washerwoman",
      targetCount: 0,
    });
    const a = f.view().actions[0];
    expect(a.reference!.evidence.some((e) => e.startsWith("1 号："))).toBe(
      false,
    );
    for (let n = 0; n < 100; n++) {
      const pair = randomFirstInformation(f.view(), a)!;
      expect(pair.targets).not.toContain(f.ids[0]);
      expect(new Set(pair.targets).size).toBe(2);
      expect(
        pair.targets.some(
          (id) =>
            f.view().storyteller!.assignments[id].actualRoleId === pair.roleId,
        ),
      ).toBe(true);
    }
  });
});
describe("recovery tickets", () => {
  it("restores the same seat and private state once, revokes old devices, and rejects player-issued tickets", () => {
    const f = fixture();
    f.act({ type: "save_note", note: "private notebook" }, f.players[0]);
    expect(() =>
      f.game.issueRecovery(f.host.code, f.players[1].token, f.ids[0]),
    ).toThrow(/说书人/);
    const ticket = f.game.issueRecovery(f.host.code, f.host.token, f.ids[0]);
    const restored = f.game.recover(f.host.code, ticket.recoveryToken);
    expect(f.view(restored).viewer.seatId).toBe(f.ids[0]);
    expect(f.view(restored).self!.note).toBe("private notebook");
    expect(() => f.view(f.players[0])).toThrow(/会话/);
    expect(() => f.game.recover(f.host.code, ticket.recoveryToken)).toThrow(
      /失效/,
    );
    expect(f.view(f.players[1]).viewer.seatId).toBe(f.ids[1]);
    expect(JSON.stringify(f.view())).not.toContain(ticket.recoveryToken);
  });
  it("expires tickets, invalidates reissued links and rejects old-round links", () => {
    const f = fixture();
    const old = f.game.issueRecovery(f.host.code, f.host.token, f.ids[0]);
    const newer = f.game.issueRecovery(f.host.code, f.host.token, f.ids[0]);
    expect(() => f.game.recover(f.host.code, old.recoveryToken)).toThrow(
      /失效/,
    );
    const time = vi.spyOn(Date, "now").mockReturnValue(newer.expiresAt + 1);
    expect(() => f.game.recover(f.host.code, newer.recoveryToken)).toThrow(
      /失效/,
    );
    time.mockRestore();
    const next = f.game.issueRecovery(f.host.code, f.host.token, f.ids[1]);
    f.act({ type: "end" });
    f.act({ type: "new_round" });
    expect(() => f.game.recover(f.host.code, next.recoveryToken)).toThrow(
      /失效/,
    );
  });
});
it("generates varied legal setups with valid drunk identities and bluffs for all supported counts", () => {
  for (const count of [10, 11, 12, 13]) {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const s = randomSetup(count);
      expect(
        validateSetup(count, s).filter((x) => x.level === "error"),
      ).toEqual([]);
      seen.add([...s.roleIds].sort().join(","));
    }
    expect(seen.size).toBeGreaterThan(100);
  }
});

describe("phase confirmation review", () => {
  it("summarizes missing checklist, unsent evil information and unpublished life changes", () => {
    const f = fixture();
    f.death(11);
    const initial = phaseReview(f.view(), true);
    expect(initial.lines).toContain("尚未生成本夜清单。");
    expect(initial.lines.some((s) => s.includes("邪恶信息尚未发送"))).toBe(
      true,
    );
    expect(initial.lines).toContain("将公布 11 号死亡。");
    expect(initial.blocked).toBe(false);
    expect(phaseReview(f.view(), false).lines).toContain(
      "本次只宣布天亮，暂不公布生死变化。",
    );
    f.act({ type: "generate_night_plan", ...f.plan() });
    expect(phaseReview(f.view(), true).lines).toContain(
      `清单还有 ${f.view().storyteller!.nightPlan.length} 项未开始或未标记完成。`,
    );
    f.act({ type: "start_all_plan", ...f.plan() });
    expect(phaseReview(f.view(), true).blocked).toBe(true);
  });
  it("rejects stale life and checklist reviews without publishing or advancing", () => {
    const f = fixture();
    const key = phaseReview(f.view(), true).key;
    f.death(11);
    expect(() => f.act({ type: "next_phase", expectedReviewKey: key })).toThrow(
      /确认内容已变化/,
    );
    expect(f.view().phase).toBe("FIRST_NIGHT");
    expect(
      f.view(f.players[0]).seats.find((s) => s.id === f.ids[10])!.alive,
    ).toBe(true);
    const second = phaseReview(f.view(), true).key;
    f.act({ type: "generate_night_plan", ...f.plan() });
    expect(() =>
      f.act({ type: "next_phase", expectedReviewKey: second }),
    ).toThrow(/确认内容已变化/);
    f.act({
      type: "next_phase",
      expectedReviewKey: phaseReview(f.view(), true).key,
    });
    expect(f.view().phase).toBe("DAY");
    expect(
      f.view(f.players[0]).seats.find((s) => s.id === f.ids[10])!.alive,
    ).toBe(false);
  });
  it("does not stale a review for unrelated chat and preserves the no-publication choice", () => {
    const f = fixture();
    f.death(11);
    const key = phaseReview(f.view(), false).key;
    f.act(
      { type: "send_message", to: "storyteller", content: "仅询问信息" },
      f.players[0],
    );
    expect(phaseReview(f.view(), false).key).toBe(key);
    f.act({
      type: "next_phase",
      expectedReviewKey: key,
      publishLifeOnDawn: false,
    });
    expect(f.view().phase).toBe("DAY");
    expect(
      f.view(f.players[0]).seats.find((s) => s.id === f.ids[10])!.alive,
    ).toBe(true);
  });
});
