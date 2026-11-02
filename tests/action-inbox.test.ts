import { afterEach, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store";
import { GameService } from "../server/game";
import { commandWithContext } from "../shared/command-context";
import {
  choiceSentence,
  toggleChoice,
  choiceKindForRole,
} from "../shared/action-choice";
import { emptyConditions } from "../server/information";
import type { Command } from "../shared/commands";
import type { NightAction, Session } from "../shared/types";
const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
function fixture() {
  const store = new Store(":memory:");
  stores.push(store);
  const game = new GameService(store),
    host = game.create(12, "Action inbox");
  const view = (s = host) => game.view(s.code, s.token);
  const act = (c: Command, s: Session = host) =>
    game.execute(
      s.code,
      s.token,
      randomUUID(),
      commandWithContext(c, view(s)),
      view(s).gameNo,
    );
  act({ type: "open_registration" });
  const players = Array.from({ length: 12 }, (_, i) =>
    game.join(host.code, i + 1),
  );
  const ids = players.map((p) => view(p).viewer.seatId!);
  const request = (
    choiceKind: "inspect" | "poison" | "kill" = "inspect",
    targetCount = 2,
  ) => {
    act({
      type: "request_action",
      seatId: ids[0],
      prompt: "Functional check",
      targetCount,
      choiceKind,
    });
    return view().actions.at(-1)!;
  };
  return { game, host, players, ids, view, act, request };
}
describe("structured choices and direct messages coexist", () => {
  it("keeps clarification, target submission and replies independent and private across 12 players", () => {
    const f = fixture(),
      action = f.request();
    f.act(
      {
        type: "send_message",
        to: "storyteller",
        content: "Clarify before choosing",
      },
      f.players[0],
    );
    expect(f.view().actions[0].status).toBe("REQUESTED");
    expect(f.view().actions[0].targets).toEqual([]);
    f.act(
      {
        type: "submit_action",
        actionId: action.id,
        targets: [f.ids[2], f.ids[4]],
        expectedVersion: 0,
      },
      f.players[0],
    );
    f.act({ type: "send_message", to: f.ids[0], content: "Private reply" });
    expect(f.view().actions[0].targets).toEqual([f.ids[2], f.ids[4]]);
    expect(f.view().messages.map((m) => m.content)).toEqual([
      "Clarify before choosing",
      "Private reply",
    ]);
    expect(f.view(f.players[0]).actions[0].choiceKind).toBe("inspect");
    for (const p of f.players.slice(1)) {
      expect(f.view(p).actions).toEqual([]);
      expect(f.view(p).messages).toEqual([]);
    }
    f.act(
      {
        type: "send_message",
        to: f.ids[1],
        content: "Player-to-player secret",
      },
      f.players[0],
    );
    expect(
      f.view().messages.some((m) => m.content === "Player-to-player secret"),
    ).toBe(false);
  });
  it("a kill choice records intent without changing life or publishing a death", () => {
    const f = fixture(),
      a = f.request("kill", 1);
    f.act(
      {
        type: "submit_action",
        actionId: a.id,
        targets: [f.ids[1]],
        expectedVersion: 0,
      },
      f.players[0],
    );
    expect(f.view().seats.every((s) => s.alive)).toBe(true);
    expect(f.view().publicRecords).toEqual([]);
  });
  it("defaults to the perceived ability and never exposes a secret reference role", () => {
    const f = fixture();
    f.act({
      type: "update_player",
      seatId: f.ids[0],
      actualRoleId: "drunk",
      perceivedRoleId: "fortuneteller",
      alive: true,
      conditions: emptyConditions(),
      reason: "Private role adjustment",
      expectedContextVersion: f.view().storyteller!.contextVersion,
    });
    f.act({
      type: "request_action",
      seatId: f.ids[0],
      prompt: "Choose two players",
      targetCount: 2,
      referenceRoleId: "poisoner",
    });
    const a = f.view(f.players[0]).actions[0];
    expect(a.choiceKind).toBe("inspect");
    expect(a.referenceRoleId).toBeUndefined();
    expect(a.reference).toBeUndefined();
  });
  it("rejects duplicate target slots and stale corrections while leaving private chat usable", () => {
    const f = fixture(),
      a = f.request();
    expect(() =>
      f.act(
        {
          type: "submit_action",
          actionId: a.id,
          targets: [f.ids[1], f.ids[1]],
          expectedVersion: 0,
        },
        f.players[0],
      ),
    ).toThrow();
    f.act(
      {
        type: "submit_action",
        actionId: a.id,
        targets: [f.ids[1], f.ids[2]],
        expectedVersion: 0,
      },
      f.players[0],
    );
    expect(() =>
      f.act(
        {
          type: "submit_action",
          actionId: a.id,
          targets: [f.ids[3], f.ids[4]],
          expectedVersion: 0,
        },
        f.players[0],
      ),
    ).toThrow();
    f.act(
      {
        type: "send_message",
        to: "storyteller",
        content: "Need to correct this choice",
      },
      f.players[0],
    );
    expect(f.view().messages.at(-1)!.content).toContain("correct");
    expect(f.view().actions[0].targets).toEqual([f.ids[1], f.ids[2]]);
  });
});
describe("number choice interaction", () => {
  it("replaces a single selection with one tap and preserves distinct double slots", () => {
    expect(toggleChoice(["a"], "b", 1)).toEqual(["b"]);
    expect(toggleChoice(["a"], "a", 1)).toEqual([]);
    expect(toggleChoice(["a"], "b", 2)).toEqual(["a", "b"]);
    expect(toggleChoice(["a", "b"], "c", 2)).toEqual(["a", "b"]);
    expect(toggleChoice(["a", "b"], "a", 2)).toEqual(["b"]);
  });
  it("renders blank slots and the same numbered action for the host", () => {
    const f = fixture(),
      a = f.request("poison", 1),
      seats = f.view().seats;
    expect(choiceSentence(a, seats)).toBe("我要下毒 __ 号");
    expect(choiceSentence(a, seats, [f.ids[4]], "1 号：")).toBe(
      "1 号：下毒 5 号",
    );
    const older = { ...a, choiceKind: undefined } as NightAction;
    expect(choiceSentence(older, seats, [f.ids[1]])).toBe("我要选择 2 号");
  });
  it("labels the standard Trouble Brewing targeted actions", () => {
    expect(
      [
        "fortuneteller",
        "ravenkeeper",
        "poisoner",
        "imp",
        "monk",
        "butler",
        "drunk",
      ].map(choiceKindForRole),
    ).toEqual([
      "inspect",
      "inspect",
      "poison",
      "kill",
      "protect",
      "master",
      "select",
    ]);
  });
});
