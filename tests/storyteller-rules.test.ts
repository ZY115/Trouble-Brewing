import { describe, expect, it } from "vitest";
import type { LiveVote, NightAction, RoomView } from "../shared/types";
import { butlerWarning, virginCheck } from "../src/storyteller/rules";
import { draftVotes } from "../src/storyteller/voteDraft";
import { effectChecks } from "../src/storyteller/checks";

function room(roles: string[], dead: number[] = []) {
  const seats = roles.map((_, i) => ({ id: `s${i + 1}`, number: i + 1, alive: !dead.includes(i + 1), deadVoteAvailable: true }));
  const assignments = Object.fromEntries(roles.map((r, i) => [`s${i + 1}`, { actualRoleId: r, perceivedRoleId: r }]));
  return {
    seats,
    day: 2,
    phase: "DAY",
    publicRecords: [],
    actions: [
      { id: "m", seatId: "s1", night: 1, choiceKind: "master", status: "DELIVERED", targets: ["s2"], targetCount: 1, prompt: "" },
    ],
    storyteller: { assignments, conditions: {}, executions: [], claims: {} },
  } as unknown as RoomView;
}
const vote = (hands: Record<string, boolean>): LiveVote => ({
  id: "v",
  day: 2,
  nominator: "s3",
  nominee: "s4",
  order: ["s1", "s2", "s3", "s4"],
  hands,
  counted: hands,
  status: "COUNTING",
  deadAtVote: [],
});

describe("table rules the storyteller sees", () => {
  it("lets a dead Butler vote freely and only warns about a living one", () => {
    const alive = room(["butler", "chef", "empath", "imp"]);
    const v = vote({ s1: true });
    expect(butlerWarning(alive, "s1", (id) => !!v.counted[id])).toContain("照常计入");
    expect(draftVotes(alive, v, {}).voters).toEqual(["s1"]);
    const dead = room(["butler", "chef", "empath", "imp"], [1]);
    expect(butlerWarning(dead, "s1", (id) => !!v.counted[id])).toBe("");
  });
  it("does not trigger a dead Virgin", () => {
    expect(virginCheck(room(["chef", "virgin", "empath", "imp"]), "s1", "s2")?.trigger).toBe(true);
    expect(virginCheck(room(["chef", "virgin", "empath", "imp"], [2]), "s1", "s2")).toBeNull();
  });
  it("warns that a protected Imp cannot kill himself", () => {
    const r = room(["imp", "chef", "monk", "empath"]);
    r.storyteller!.conditions.s1 = { poisoned: false, drunk: false, protected: true, note: "" };
    const kill = { id: "k", seatId: "s1", night: 2, choiceKind: "kill", targets: ["s1"], targetCount: 1, status: "SUBMITTED", prompt: "" } as NightAction;
    expect(effectChecks(r, kill).some((c) => !c.ok && c.text.includes("自杀不会成功"))).toBe(true);
  });
});
