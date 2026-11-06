import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { Store } from "../server/store";
import { GameService } from "../server/game";
import type { Command } from "../shared/commands";
const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach(s => s.close()));
function setup() {
  const store = new Store(":memory:"); stores.push(store);
  const game = new GameService(store), host = game.create(12, "Resume test");
  const view = () => game.view(host.code, host.token, false);
  const send = (command: Command, session = host, id = randomUUID()) => game.execute(host.code, session.token, id, command, view().gameNo);
  send({ type: "open_registration" });
  const players = Array.from({ length: 12 }, (_, n) => game.join(host.code, n + 1));
  return { game, store, host, players, view, send, ids: view().seats.map(s => s.id) };
}
it("continues the most recent unfinished game, and only rooms a remote browser could already open", async () => {
  const a = setup();
  const later = () => new Promise((r) => setTimeout(r, 5));
  await later();
  const b = a.game.create(10, "Second room");
  a.game.execute(b.code, b.token, randomUUID(), { type: "open_registration" });
  expect(a.game.latestUnfinished()!.summary.code).toBe(b.code);
  await later();
  a.send({ type: "next_phase", expectedPhaseVersion: a.view().storyteller!.phaseVersion });
  expect(a.game.latestUnfinished()!.summary).toMatchObject({ code: a.host.code, capacity: 12, phase: "DAY", day: 1 });
  const resumed = a.game.resumeLatest();
  expect(resumed.code).toBe(a.host.code);
  expect(resumed.token).not.toBe(a.host.token);
  expect(a.game.view(resumed.code, resumed.token).viewer.kind).toBe("storyteller");
  expect(a.game.resumeLatest([{ code: b.code, token: b.token }])).toEqual({ code: b.code, token: b.token });
  expect(a.game.resumeLatest(undefined, [{ code: a.host.code, token: a.host.token }])).toEqual({ code: a.host.code, token: a.host.token });
  expect(a.game.latestUnfinished([{ code: a.host.code, token: a.players[0].token }])).toBeUndefined();
  expect(() => a.game.resumeLatest([])).toThrow("没有未完成的对局");
  a.send({ type: "finish_game", mode: "early", winner: "none", confirmed: true, endDay: false, reason: "", expectedReviewKey: a.view().storyteller!.endReview!.key });
  expect(a.game.latestUnfinished()!.summary.code).toBe(b.code);
});
it("undoes only the latest unpublished marker edit, preserving audit history and rejecting stale/unauthorized undo", () => {
  const f = setup();
  const context = f.view().storyteller!.contextVersion;
  f.send({ type: "set_condition", seatId: f.ids[0], condition: "poisoned", value: true, expectedContextVersion: context });
  const undo = f.view().storyteller!.undo!;
  expect(undo).toBeDefined();
  f.send({ type: "add_note", body: "optional notes must not interfere with host undo" }, f.players[1]);
  expect(f.view().storyteller!.undo).toEqual(undo);
  expect(() => f.send({ type: "undo_private_edit", expectedRevision: undo.revision }, f.players[0])).toThrow("仅限说书人");
  f.send({ type: "undo_private_edit", expectedRevision: undo.revision });
  expect(f.view().storyteller!.conditions[f.ids[0]]?.poisoned ?? false).toBe(false);
  expect(f.view().storyteller!.undo).toBeUndefined();
  expect(f.view().storyteller!.events.at(-1)?.type).toBe("undo_private_edit");
  expect(f.view().storyteller!.contextVersion).toBe(context + 2);
  f.send({ type: "set_condition", seatId: f.ids[0], condition: "protected", value: true, expectedContextVersion: f.view().storyteller!.contextVersion });
  const second = f.view().storyteller!.undo!;
  f.send({ type: "send_message", to: "storyteller", content: "later action" }, f.players[0]);
  expect(f.view().storyteller!.undo).toBeUndefined();
  expect(() => f.send({ type: "undo_private_edit", expectedRevision: second.revision })).toThrow("后续操作");
  expect(f.view().storyteller!.conditions[f.ids[0]].protected).toBe(true);
});
it("migrates inline histories/receipts once while keeping hot snapshots small and receipts idempotent", () => {
  const f = setup(), room = f.store.get(f.host.code)!;
  room.archives = [{ gameNo: 0, notebooks: {}, publicRecords: [], seats: [] }];
  room.applied = ["old-receipt"];
  f.store.db.prepare("UPDATE rooms SET body = ? WHERE code = ?").run(JSON.stringify(room), room.code);
  const hot = f.store.get(room.code, false)!;
  expect(hot.archives).toEqual([]); expect(hot.applied).toEqual([]);
  expect(f.store.archiveGames(room.code)).toEqual([0]);
  expect(f.store.hasReceipt(room.code, "old-receipt")).toBe(true);
  expect(f.store.get(room.code)!.archives).toHaveLength(1);
  expect(JSON.parse((f.store.db.prepare("SELECT body FROM rooms WHERE code = ?").get(room.code) as any).body).archives).toEqual([]);
});

it("keeps archives and deduplication receipts durable across a database restart", () => {
  const folder = mkdtempSync(join(tmpdir(), "clocktower-restart-")), path = join(folder, "game.sqlite");
  let store = new Store(path);
  try {
    let game = new GameService(store, true);
    const host = game.create(12, "Restart"), id = randomUUID();
    game.execute(host.code, host.token, randomUUID(), { type: "debug_fill", start: true });
    game.execute(host.code, host.token, randomUUID(), { type: "finish_game", mode: "normal", winner: "good", confirmed: true, endDay: false, reason: "test", expectedReviewKey: game.view(host.code, host.token).storyteller!.endReview!.key });
    game.execute(host.code, host.token, id, { type: "new_round", seatMode: "keep" }, 1);
    store.close(); store = new Store(path); game = new GameService(store, true);
    expect(game.view(host.code, host.token, false).gameNo).toBe(2);
    expect(game.history(host.code, host.token, 1).recap?.gameNo).toBe(1);
    expect(game.commandApplied(host.code, host.token, id)).toBe(true);
    expect(game.execute(host.code, host.token, id, { type: "new_round", seatMode: "keep" }, 1).gameNo).toBe(2);
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});
