import { commandWithContext } from "../shared/command-context";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { GameService } from "../server/game";
import presets from "../shared/presets.json";
import { ROLES, isEvil } from "../shared/roles";
import { expectedCounts, validateSetup } from "../shared/setup";
import type { Command } from "../shared/commands";
import type { Session } from "../shared/types";
const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
function fixture(count = 12, variant = 1) {
  const store = new Store(":memory:");
  stores.push(store);
  const game = new GameService(store);
  const host = game.create(count, "Test room");
  const execute = (session: Session, command: Command, id = randomUUID()) =>
    game.execute(
      session.code,
      session.token,
      id,
      commandWithContext(command, game.view(session.code, session.token)),
    );
  execute(host, {
    type: "save_setup",
    setup: structuredClone(
      presets.find((p) => p.id === `${count}-${variant}`)!.setup,
    ),
  });
  execute(host, { type: "open_registration" });
  const players = Array.from({ length: count }, (_, i) =>
    game.join(host.code, i + 1),
  );
  const view = (session: Session) => game.view(session.code, session.token);
  return { game, host, players, execute, view, store };
}
describe("TB setup", () => {
  it.each([10, 11, 12, 13])(
    "validates every precomputed %i-player preset including Baron",
    (count) => {
      const matches = presets.filter((p) => p.count === count);
      expect(matches).toHaveLength(12);
      expect(
        new Set(matches.map((p) => [...p.setup.roleIds].sort().join(","))).size,
      ).toBe(12);
      for (const preset of matches) {
        expect(
          validateSetup(count, preset.setup).filter((i) => i.level === "error"),
        ).toEqual([]);
        const expected = expectedCounts(
          count,
          preset.setup.roleIds.includes("baron"),
        );
        expect(expected.reduce((a, b) => a + b)).toBe(count);
      }
    },
  );
  it("has exactly the 22 TB roles and rejects duplicates and bad Drunk disguise", () => {
    expect(ROLES).toHaveLength(22);
    const setup = structuredClone(presets.find((p) => p.id === "12-1")!.setup);
    setup.drunkAs = "imp";
    setup.roleIds[0] = setup.roleIds[1];
    const messages = validateSetup(12, setup)
      .map((i) => i.message)
      .join(" ");
    expect(messages).toContain("角色不可重复");
    expect(messages).toContain("酒鬼");
  });
  it.each([10, 11, 12, 13])(
    "assigns %i distinct private identities",
    (count) => {
      const f = fixture(count);
      const assignments = Object.values(
        f.view(f.host).storyteller!.assignments,
      );
      expect(assignments).toHaveLength(count);
      expect(new Set(assignments.map((a) => a.actualRoleId)).size).toBe(count);
      for (const p of f.players)
        expect(f.view(p).self?.perceivedRoleId).toBeTruthy();
    },
  );
  it("keeps custom nonstandard setups but requires a recorded reason before dealing", () => {
    const store = new Store(":memory:");
    stores.push(store);
    const game = new GameService(store);
    const h = game.create(10, "Custom");
    const setup = structuredClone(presets[0].setup);
    setup.roleIds[setup.roleIds.indexOf("poisoner")] = "saint";
    game.execute(h.code, h.token, randomUUID(), { type: "save_setup", setup });
    expect(() =>
      game.execute(h.code, h.token, randomUUID(), {
        type: "open_registration",
      }),
    ).toThrow("房规");
    setup.overrideReason = "教学局调整邪恶人数";
    game.execute(h.code, h.token, randomUUID(), { type: "save_setup", setup });
    game.execute(h.code, h.token, randomUUID(), { type: "open_registration" });
    for (let n = 1; n <= 10; n++) game.join(h.code, n);
    const view = game.view(h.code, h.token);
    expect(view.storyteller!.events.at(-1)!.detail).toContain(
      "教学局调整邪恶人数",
    );
  });
});
describe("authorization and projections", () => {
  it("never sends actual roles, sessions, setup, events, or another note to a player", () => {
    const f = fixture();
    f.execute(f.players[1], { type: "save_note", note: "SECRET-NOTE" });
    const host = f.view(f.host);
    const player = f.view(f.players[0]);
    expect(host.storyteller!.assignments).toBeTruthy();
    for (const s of player.seats)
      expect(Object.keys(s).sort()).toEqual([
        "alive",
        "deadVoteAvailable",
        "id",
        "nickname",
        "number",
      ]);
    const wire = JSON.stringify(player);
    for (const key of [
      "actualRoleId",
      "assignments",
      "sessions",
      "overrideReason",
      "SECRET-NOTE",
      "drunkAs",
      "events",
    ])
      expect(wire).not.toContain(key);
    expect(JSON.stringify(host)).not.toContain("SECRET-NOTE");
  });
  it("shows a Drunk only their unoccupied Townsfolk identity", () => {
    const f = fixture();
    const assignments = f.view(f.host).storyteller!.assignments;
    const drunk = f.players.find(
      (p) => assignments[f.view(p).viewer.seatId!].actualRoleId === "drunk",
    )!;
    expect(f.view(drunk).self!.perceivedRoleId).toBe(
      f.view(f.host).storyteller!.setup.drunkAs,
    );
    expect(JSON.stringify(f.view(drunk))).not.toContain("drunk");
  });
  it("rejects a room-code-only session, cross-room token, and forged actor", () => {
    const f = fixture();
    const other = f.game.create(10, "Other");
    expect(() => f.game.view(f.host.code, f.host.code)).toThrow("会话无效");
    expect(() => f.game.view(other.code, f.players[0].token)).toThrow(
      "会话无效",
    );
    expect(() =>
      f.execute(f.players[0], {
        type: "save_note",
        note: "x",
        seatId: f.view(f.players[1]).viewer.seatId,
      } as Command),
    ).toThrow();
    expect(Object.keys(f.store.get(f.host.code)!.sessions)).not.toContain(
      f.host.token,
    );
  });
  it.each<Command>([
    { type: "open_registration" },
    { type: "next_phase" },
    { type: "end" },
    { type: "evil_channel", enabled: true, confirm: true },
  ])("rejects player privilege escalation: $type", (command) => {
    const f = fixture();
    expect(() => f.execute(f.players[0], command)).toThrow("仅限说书人");
  });
  it("private messages are visible only to both participants, including against storyteller", () => {
    const f = fixture();
    const receiver = f.view(f.players[1]).viewer.seatId!;
    f.execute(f.players[0], {
      type: "send_message",
      to: receiver,
      content: "PRIVATE-DM",
    });
    for (const p of f.players.slice(0, 2))
      expect(f.view(p).messages[0].content).toBe("PRIVATE-DM");
    expect(f.view(f.players[2]).messages).toEqual([]);
    expect(f.view(f.host).messages).toEqual([]);
    expect(JSON.stringify(f.view(f.host).storyteller!.events)).not.toContain(
      "PRIVATE-DM",
    );
  });
  it("evil membership/bluffs require first-night release and revoke on connected projections", () => {
    const f = fixture();
    const assign = f.view(f.host).storyteller!.assignments;
    const evil = f.players.filter((p) =>
      isEvil(assign[f.view(p).viewer.seatId!].actualRoleId),
    );
    const good = f.players.find((p) => !evil.includes(p))!;
    expect(f.view(evil[0]).evilMembers).toBeUndefined();
    expect(() =>
      f.execute(evil[0], {
        type: "send_message",
        to: "evil",
        content: "early",
      }),
    ).toThrow();
    expect(() =>
      f.execute(f.host, {
        type: "evil_channel",
        enabled: true,
        confirm: false,
      }),
    ).toThrow();
    f.execute(f.host, { type: "evil_channel", enabled: true, confirm: true });
    f.execute(evil[0], {
      type: "send_message",
      to: "evil",
      content: "EVIL-ONLY",
    });
    expect(f.view(evil[1]).messages.at(-1)!.content).toBe("EVIL-ONLY");
    expect(f.view(good).evilMembers).toBeUndefined();
    expect(f.view(good).messages).toEqual([]);
    expect(() =>
      f.execute(good, { type: "send_message", to: "evil", content: "spoof" }),
    ).toThrow();
    const demon = evil.find(
      (p) => assign[f.view(p).viewer.seatId!].actualRoleId === "imp",
    )!;
    expect(f.view(demon).self!.bluffs).toHaveLength(3);
    f.execute(f.host, { type: "evil_channel", enabled: false, confirm: false });
    expect(f.view(evil[0]).messages).toEqual([]);
    expect(f.view(demon).self!.bluffs).toBeUndefined();
  });
});
describe("manual night workflow and recovery", () => {
  it("enforces owner, targets, review, private delivery and immutable sent response", () => {
    const f = fixture();
    const player = f.players[0];
    const id = f.view(player).viewer.seatId!;
    f.execute(f.host, {
      type: "request_action",
      seatId: id,
      prompt: "Choose two",
      targetCount: 2,
    });
    const actionId = f.view(player).actions[0].id;
    const targets = f
      .view(player)
      .seats.slice(1, 3)
      .map((s) => s.id);
    expect(f.view(f.players[1]).actions).toEqual([]);
    expect(() =>
      f.execute(f.players[1], { type: "submit_action", actionId, targets }),
    ).toThrow();
    expect(() =>
      f.execute(player, {
        type: "submit_action",
        actionId,
        targets: [targets[0], targets[0]],
      }),
    ).toThrow();
    expect(() =>
      f.execute(f.host, { type: "deliver_action", actionId }),
    ).toThrow();
    f.execute(player, { type: "submit_action", actionId, targets });
    f.execute(f.host, {
      type: "review_action",
      actionId,
      response: "SECRET-FEEDBACK",
    });
    expect(JSON.stringify(f.view(player))).not.toContain("SECRET-FEEDBACK");
    expect(f.view(player).actions[0].status).toBe("SUBMITTED");
    expect(() => f.execute(f.host, { type: "next_phase" })).toThrow("待办");
    f.execute(f.host, { type: "deliver_action", actionId });
    expect(f.view(player).actions[0].response).toBe("SECRET-FEEDBACK");
    expect(JSON.stringify(f.view(f.players[1]))).not.toContain(
      "SECRET-FEEDBACK",
    );
    expect(() =>
      f.execute(f.host, {
        type: "review_action",
        actionId,
        response: "overwrite",
      }),
    ).toThrow();
    f.execute(f.host, { type: "next_phase" });
    expect(f.view(f.host).phase).toBe("DAY");
    expect(() =>
      f.execute(f.host, {
        type: "request_action",
        seatId: id,
        prompt: "wrong phase",
        targetCount: 0,
      }),
    ).toThrow("夜间");
  });
  it("does not duplicate a retried message or advance a phase twice", () => {
    const f = fixture();
    const messageId = randomUUID();
    const command: Command = {
      type: "send_message",
      to: f.view(f.players[1]).viewer.seatId!,
      content: "once",
    };
    f.execute(f.players[0], command, messageId);
    f.execute(f.players[0], command, messageId);
    expect(f.view(f.players[1]).messages).toHaveLength(1);
    const phaseId = randomUUID();
    f.execute(f.host, { type: "next_phase" }, phaseId);
    f.execute(f.host, { type: "next_phase" }, phaseId);
    expect(f.view(f.host).phase).toBe("DAY");
  });
  it("restores identities, notes and idempotency receipts from SQLite after reopening", () => {
    const dir = mkdtempSync(join(tmpdir(), "clocktower-test-"));
    const path = join(dir, "test.sqlite");
    let store = new Store(path);
    try {
      const game = new GameService(store);
      const host = game.create(10, "Persistent");
      game.execute(host.code, host.token, randomUUID(), {
        type: "open_registration",
      });
      const player = game.join(host.code, 1);
      const receipt = randomUUID();
      const command: Command = { type: "save_note", note: "survives-restart" };
      game.execute(player.code, player.token, receipt, command);
      const before = game.view(player.code, player.token);
      store.close();
      store = new Store(path);
      const recovered = new GameService(store);
      expect(recovered.view(player.code, player.token)).toEqual(before);
      recovered.execute(player.code, player.token, receipt, command);
      expect(recovered.view(player.code, player.token).revision).toBe(
        before.revision,
      );
    } finally {
      store.close();
      rmSync(dir, { recursive: true });
    }
  });
  it("retains duplicate registrations and rejects joining after the game starts", () => {
    const f = fixture();
    expect(() => f.game.join(f.host.code, 1)).toThrow("已开始");
    const room = f.game.create(10, "Lobby");
    f.execute(room, { type: "open_registration" });
    f.game.join(room.code, 1);
    f.game.join(room.code, 1);
    expect(f.view(room).registration.duplicateNumbers).toEqual([1]);
  });
});
