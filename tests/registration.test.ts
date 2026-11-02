import { commandWithContext } from "../shared/command-context";
import { afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store";
import { GameService } from "../server/game";
import type { Command } from "../shared/commands";
import type { Session } from "../shared/types";
const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
function setup(capacity = 10) {
  const store = new Store(":memory:");
  stores.push(store);
  const game = new GameService(store);
  const host = game.create(capacity, "Registration");
  const send = (session: Session, command: Command, id = randomUUID()) =>
    game.execute(
      session.code,
      session.token,
      id,
      commandWithContext(command, game.view(session.code, session.token)),
    );
  const view = (session: Session) => game.view(session.code, session.token);
  return { game, host, send, view };
}
it("does not accept players until the storyteller confirms the setup", () => {
  const f = setup();
  expect(() => f.game.join(f.host.code, 1)).toThrow("尚未开放");
  f.send(f.host, { type: "open_registration" });
  const player = f.game.join(f.host.code, 1);
  expect(f.view(player).self?.perceivedRoleId).toBeUndefined();
  expect(() => f.send(player, { type: "open_registration" })).toThrow(
    "仅限说书人",
  );
  expect(() => f.send(player, { type: "close_registration" })).toThrow(
    "仅限说书人",
  );
  expect(() =>
    f.send(f.host, {
      type: "save_setup",
      setup: f.view(f.host).storyteller!.setup,
    }),
  ).toThrow("暂停入场");
});
it.each([10, 11, 12, 13])(
  "keeps %i roles hidden with duplicate last registration, then deals once after correction",
  (capacity) => {
    const f = setup(capacity);
    f.send(f.host, { type: "open_registration" });
    const players = Array.from({ length: capacity - 1 }, (_, i) =>
      f.game.join(f.host.code, i + 1),
    );
    const last = f.game.join(f.host.code, capacity - 1);
    players.push(last);
    const before = f.view(f.host);
    expect(before.registration).toMatchObject({
      joined: capacity,
      duplicateNumbers: [capacity - 1],
      missingNumbers: [capacity],
      ready: false,
    });
    expect(before.storyteller!.assignments).toEqual({});
    for (const player of players)
      expect(f.view(player).self?.perceivedRoleId).toBeUndefined();
    const id = randomUUID();
    f.send(last, { type: "move_seat", number: capacity }, id);
    const after = f.view(f.host);
    expect(after.phase).toBe("FIRST_NIGHT");
    expect(after.registration).toMatchObject({
      ready: true,
      duplicateNumbers: [],
      missingNumbers: [],
      open: false,
    });
    expect(Object.keys(after.storyteller!.assignments)).toHaveLength(capacity);
    for (const player of players)
      expect(f.view(player).self?.perceivedRoleId).toBeTruthy();
    f.send(last, { type: "move_seat", number: capacity }, id);
    expect(f.view(f.host).storyteller!.assignments).toEqual(
      after.storyteller!.assignments,
    );
    expect(
      f
        .view(f.host)
        .storyteller!.events.filter((e) => e.type === "roles_dealt"),
    ).toHaveLength(1);
    expect(() => f.send(last, { type: "move_seat", number: 1 })).toThrow(
      "开局前",
    );
  },
);
it("allows either duplicate holder to correct their own number", () => {
  const f = setup();
  f.send(f.host, { type: "open_registration" });
  const players = Array.from({ length: 9 }, (_, i) =>
    f.game.join(f.host.code, i + 1),
  );
  f.game.join(f.host.code, 9);
  f.send(players[8], { type: "move_seat", number: 10 });
  expect(f.view(f.host).phase).toBe("FIRST_NIGHT");
});
it("supports paused registration and never deals while paused", () => {
  const f = setup();
  f.send(f.host, { type: "open_registration" });
  for (let n = 1; n <= 9; n++) f.game.join(f.host.code, n);
  const last = f.game.join(f.host.code, 9);
  f.send(f.host, { type: "close_registration" });
  f.send(last, { type: "move_seat", number: 10 });
  expect(f.view(f.host).registration.ready).toBe(true);
  expect(f.view(f.host).storyteller!.assignments).toEqual({});
  expect(() => f.game.join(f.host.code, 2)).toThrow("尚未开放");
  f.send(f.host, { type: "open_registration" });
  expect(f.view(f.host).phase).toBe("FIRST_NIGHT");
});
it("removes an abnormal registration, revokes its token and permits replacement", () => {
  const f = setup();
  f.send(f.host, { type: "open_registration" });
  const first = f.game.join(f.host.code, 1);
  const duplicate = f.game.join(f.host.code, 1);
  const seatId = f.view(duplicate).viewer.seatId!;
  expect(() => f.send(first, { type: "remove_player", seatId })).toThrow(
    "仅限说书人",
  );
  f.send(f.host, { type: "remove_player", seatId });
  expect(() => f.view(duplicate)).toThrow("会话无效");
  expect(f.view(f.host).registration.joined).toBe(1);
  for (let n = 2; n <= 10; n++) f.game.join(f.host.code, n);
  expect(f.view(first).self?.perceivedRoleId).toBeTruthy();
});
it("does not accept out-of-range and fractional numbers", () => {
  const f = setup();
  f.send(f.host, { type: "open_registration" });
  for (const n of [0, 11, 1.5, NaN])
    expect(() => f.game.join(f.host.code, n)).toThrow();
});
