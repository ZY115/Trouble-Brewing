import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "../server/store";
import { GameService } from "../server/game";
import type { Command } from "../shared/commands";
import type { Session } from "../shared/types";

const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
function fixture() {
  const store = new Store(":memory:");
  stores.push(store);
  const game = new GameService(store, true),
    host = game.create(10, "Next round");
  const view = (session = host) => game.view(session.code, session.token);
  const send = (
    command: Command,
    session: Session = host,
    receipt = randomUUID(),
    gameNo = view(session).gameNo,
  ) => game.execute(session.code, session.token, receipt, command, gameNo);
  send({ type: "open_registration" });
  const players = Array.from({ length: 10 }, (_, i) =>
    game.join(host.code, i + 1),
  );
  const ids = players.map((p) => view(p).viewer.seatId!);
  send({ type: "add_note", body: "上局私人笔记" }, players[0]);
  send({
    type: "finish_game",
    mode: "normal",
    winner: "good",
    reason: "测试复盘与续局",
    confirmed: true,
    endDay: false,
    expectedReviewKey: view().storyteller!.endReview!.key,
  });
  const recap = view().recap!;
  const seating = (): Extract<Command, { type: "set_seating" }> => ({
    type: "set_seating",
    expectedContextVersion: view().storyteller!.contextVersion,
    seats: ids.map((seatId, i) => ({
      seatId,
      number: i === 0 ? 2 : i === 1 ? 1 : i + 1,
    })),
  });
  return { store, game, host, players, ids, view, send, recap, seating };
}

describe("next round seating choices", () => {
  it("keeps identities of devices and numbers, archives the recap, and waits for the host to confirm setup", () => {
    const f = fixture();
    expect(f.view().storyteller!.canStartNextRound).toBe(true);
    f.send({ type: "request_seat", number: 2 }, f.players[0]);
    const receipt = randomUUID();
    f.send({ type: "new_round", seatMode: "keep" }, f.host, receipt, 1);
    f.send({ type: "new_round", seatMode: "keep" }, f.host, receipt, 1);
    expect(f.view()).toMatchObject({
      phase: "SETUP",
      gameNo: 2,
      roundSetup: { mode: "keep", seatingConfirmed: true },
    });
    expect(f.view().registration.open).toBe(false);
    expect(f.view().storyteller!.canStartNextRound).toBe(false);
    expect(f.view().pastRecaps).toEqual([f.recap]);
    expect(f.view().seatRequests).toEqual([]);
    expect(f.view().seats.map((s) => s.id)).toEqual(f.ids);
    expect(f.view(f.players[0]).self!.perceivedRoleId).toBeUndefined();
    f.send({ type: "open_registration" });
    expect(f.view().phase).toBe("FIRST_NIGHT");
    expect(f.view(f.players[0]).viewer.seatId).toBe(f.ids[0]);
    expect(f.view(f.players[0]).notebook).toEqual([]);
    expect(
      f.store.get(f.host.code)!.archives[0].notebooks[f.ids[0]][0].revisions[0]
        .body,
    ).toBe("上局私人笔记");
    expect(f.view(f.players[0]).pastRecaps).toEqual([]);
    expect(f.view(f.players[0]).pastNotebooks).toEqual([]);
  });

  it("atomically swaps host-controlled seats, preserves player sessions, and rejects stale edits", () => {
    const f = fixture();
    f.send({ type: "new_round", seatMode: "host" });
    expect(() => f.send({ type: "open_registration" })).toThrow("确认座位表");
    expect(() => f.send({ type: "debug_fill", start: true })).toThrow(
      "确认座位表",
    );
    expect(() =>
      f.send({ type: "move_seat", number: 3 }, f.players[0]),
    ).toThrow("说书人统一");
    expect(f.view(f.players[0]).self!.canChangeNumber).toBe(false);
    const command = f.seating();
    f.send(command);
    expect(f.view().roundSetup!.seatingConfirmed).toBe(true);
    expect(f.view().seats.find((s) => s.id === f.ids[0])!.number).toBe(2);
    expect(f.view().seats.find((s) => s.id === f.ids[1])!.number).toBe(1);
    expect(f.view(f.players[0]).viewer.seatId).toBe(f.ids[0]);
    expect(() => f.send(command)).toThrow("座位表已变化");
    expect(f.view().pastRecaps![0]).toEqual(f.recap);
    f.send({ type: "open_registration" });
    expect(f.view().phase).toBe("FIRST_NIGHT");
    expect(() => f.send(f.seating())).toThrow("暂停入场");
  });

  it("rejects incomplete, duplicate, foreign and out-of-range seating maps without partial changes", () => {
    const f = fixture();
    f.send({ type: "new_round", seatMode: "host" });
    const before = f.view().seats;
    const valid = f.seating();
    const invalid = [
      valid.seats.slice(1),
      valid.seats.map((s, i) => ({
        ...s,
        seatId: i === 0 ? f.ids[1] : s.seatId,
      })),
      valid.seats.map((s, i) => ({
        ...s,
        seatId: i === 0 ? "foreign" : s.seatId,
      })),
      valid.seats.map((s) => ({ ...s, number: 1 })),
      valid.seats.map((s, i) => ({ ...s, number: i === 0 ? 11 : s.number })),
    ];
    for (const seats of invalid) {
      expect(() => f.send({ ...valid, seats })).toThrow();
      expect(f.view().seats).toEqual(before);
      expect(f.view().roundSetup!.seatingConfirmed).toBe(false);
    }
    expect(() => f.send(valid, f.players[0])).toThrow("仅限说书人");
  });

  it("requires re-confirmation after roster removal and protects stale host seat tables", () => {
    const f = fixture();
    f.send({ type: "new_round", seatMode: "host" });
    f.send(f.seating());
    const stale = f.seating();
    f.send({ type: "remove_player", seatId: f.ids[9] });
    expect(f.view().roundSetup!.seatingConfirmed).toBe(false);
    expect(() => f.send(stale)).toThrow("座位表已变化");
    expect(() => f.send({ type: "open_registration" })).toThrow("确认座位表");
    f.send({ ...f.seating(), seats: f.seating().seats.slice(0, 9) });
    f.send({ type: "open_registration" });
    f.game.join(f.host.code, 10, 2);
    expect(f.view().phase).toBe("FIRST_NIGHT");
  });

  it("rescans into fresh seats, revokes old sessions/tickets and blocks stale QR registrations", () => {
    const f = fixture();
    const ticket = f.game.issueRecovery(f.host.code, f.host.token, f.ids[0]);
    f.send({ type: "new_round", seatMode: "rescan" });
    expect(f.view().seats).toEqual([]);
    expect(f.view().registration).toMatchObject({
      open: false,
      joined: 0,
      ready: false,
    });
    expect(f.view().pastRecaps).toEqual([f.recap]);
    for (const p of f.players) expect(() => f.view(p)).toThrow("会话无效");
    expect(() => f.game.recover(f.host.code, ticket.recoveryToken)).toThrow(
      "已失效",
    );
    expect(() => f.game.join(f.host.code, 1, 2)).toThrow("尚未开放入场");
    f.send({ type: "open_registration" });
    expect(() => f.game.join(f.host.code, 1, 1)).toThrow("局号已变化");
    expect(() => f.game.join(f.host.code, 1)).toThrow("局号已变化");
    expect(f.game.discovery(f.host.code).gameNo).toBe(2);
    const fresh = Array.from({ length: 10 }, (_, i) =>
      f.game.join(f.host.code, i === 9 ? 9 : i + 1, 2),
    );
    expect(f.view().phase).toBe("SETUP");
    expect(f.view().registration.duplicateNumbers).toEqual([9]);
    for (const p of fresh)
      expect(f.view(p).self!.perceivedRoleId).toBeUndefined();
    f.send({ type: "move_seat", number: 10 }, fresh[9]);
    expect(f.view().phase).toBe("FIRST_NIGHT");
    expect(f.view().seats.every((s) => !f.ids.includes(s.id))).toBe(true);
    expect(f.view(fresh[0]).pastNotebooks).toEqual([]);
    expect(f.view(fresh[0]).pastRecaps).toEqual([]);
    expect(f.view(fresh[0]).notebook).toEqual([]);
  });

  it("restricts new-round transitions to the host and rejects stale packets or changing modes mid-setup", () => {
    const f = fixture();
    expect(() =>
      f.send({ type: "new_round", seatMode: "rescan" }, f.players[0]),
    ).toThrow("仅限说书人");
    f.send({ type: "new_round", seatMode: "keep" });
    expect(() =>
      f.send(
        { type: "new_round", seatMode: "rescan" },
        f.host,
        randomUUID(),
        1,
      ),
    ).toThrow("新一局");
    expect(() => f.send({ type: "new_round", seatMode: "rescan" })).toThrow(
      "先结束本局",
    );
    expect(() => f.send(f.seating())).toThrow("说书人换座模式");
    expect(f.view().seats).toHaveLength(10);
  });
});
