import { expect, it } from "vitest";
import type { RoomView } from "../shared/types";
import { debugPlayers, debugPlayerStatus, nextWaitingPlayer } from "../src/debug/players";
const room = () => ({ phase: "OTHER_NIGHT", day: 2,
  seats: [{ id: "c", number: 3 }, { id: "a", number: 1 }, { id: "b", number: 2 }],
  storyteller: { debug: { seatIds: ["a", "c"] } },
  actions: [
    { seatId: "b", night: 2, status: "REQUESTED" },
    { seatId: "c", night: 1, status: "REQUESTED" },
    { seatId: "a", night: 2, status: "REQUESTED" },
  ],
}) as unknown as RoomView;
it("navigates only synthetic players and ignores previous-night or completed actions", () => {
  const r = room();
  expect(debugPlayers(r).map(p => p.id)).toEqual(["a", "c"]);
  expect(nextWaitingPlayer(r, "c")).toBe("a");
  expect(debugPlayerStatus(r, "a")).toBe("待选择");
  r.actions[2].status = "SUBMITTED";
  expect(nextWaitingPlayer(r, "c")).toBeUndefined();
  expect(debugPlayerStatus(r, "a")).toBe("待裁定");
  r.actions[2].status = "DELIVERED";
  expect(debugPlayerStatus(r, "a")).toBe("已收到反馈");
  r.storyteller = undefined;
  expect(debugPlayers(r)).toEqual([]);
  expect(nextWaitingPlayer(r, "")).toBeUndefined();
});
it("shows each simulated player's hand during a vote", () => {
  const r = room(); r.phase = "DAY";
  r.liveVote = { id: "vote", day: 2, nominator: "a", nominee: "c", counted: {}, deadAtVote: [], status: "OPEN", order: ["a", "b", "c"], hands: { c: true } };
  expect(debugPlayerStatus(r, "c")).toBe("已举手");
  expect(debugPlayerStatus(r, "b")).toBe("未举手");
  expect(nextWaitingPlayer(r, "a")).toBeUndefined();
});
