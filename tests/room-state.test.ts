import { expect, it } from "vitest";
import { acceptRoomState, currentPlayerState } from "../src/roomState";
import type { RoomView } from "../shared/types";

const state = {
  code: "ABCDEF",
  gameNo: 2,
  playId: "current",
  revision: 20,
  phase: "FIRST_NIGHT",
  viewer: { kind: "player", seatId: "a" },
  notebook: [{ id: "current note" }],
  actions: [{ id: "current action" }],
  messages: [{ id: "current message" }],
  pastNotebooks: [{ gameNo: 1, entries: [{ id: "old note" }] }],
  pastPublicRecords: [{ gameNo: 1, records: [{ text: "old record" }] }],
  pastRecaps: [{ gameNo: 1, seats: [{ final: { actualRoleId: "imp" } }] }],
} as unknown as RoomView;

it("ignores late previous-round and older-revision snapshots while accepting fresh state on reconnect", () => {
  expect(
    acceptRoomState(state, { ...state, gameNo: 1, revision: 999 }, state.code),
  ).toBe(false);
  expect(acceptRoomState(state, { ...state, revision: 19 }, state.code)).toBe(
    false,
  );
  expect(acceptRoomState(state, { ...state, code: "OTHERX" }, state.code)).toBe(
    false,
  );
  expect(acceptRoomState(state, { ...state }, state.code)).toBe(true);
  expect(
    acceptRoomState(state, { ...state, gameNo: 3, revision: 1 }, state.code),
  ).toBe(true);
  expect(acceptRoomState(null, state, state.code)).toBe(true);
});

it("strips historical payloads from an older server without dropping this game's notes", () => {
  const current = currentPlayerState(state);
  expect(current.notebook).toEqual(state.notebook);
  expect(current.actions).toEqual(state.actions);
  expect(current.messages).toEqual(state.messages);
  expect(current.pastNotebooks).toEqual([]);
  expect(current.pastRecaps).toEqual([]);
  expect(current.pastPublicRecords).toEqual([]);
  expect(JSON.stringify(current)).not.toContain("old note");
  const host = { ...state, viewer: { kind: "storyteller" as const } };
  expect(currentPlayerState(host)).toBe(host);
});

it("blocks private data from registration snapshots and keeps only current-game summary after ending", () => {
  const pending = currentPlayerState({
    ...state,
    phase: "SETUP",
    self: {
      canChangeNumber: true,
      perceivedRoleId: "imp",
      note: "old identity",
    },
    result: {} as RoomView["result"],
    recap: {} as RoomView["recap"],
  });
  expect(pending.notebook).toEqual([]);
  expect(pending.messages).toEqual([]);
  expect(pending.actions).toEqual([]);
  expect(pending.self?.perceivedRoleId).toBeUndefined();
  expect(pending.recap).toBeUndefined();
  expect(pending.result).toBeUndefined();
  const ended = {
    ...state,
    phase: "ENDED" as const,
    recap: { gameNo: 2 } as RoomView["recap"],
  };
  expect(currentPlayerState(ended).recap).toEqual({ gameNo: 2 });
  expect(currentPlayerState(ended).pastRecaps).toEqual([]);
});
