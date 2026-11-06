import { describe, expect, it } from "vitest";
import {
  ballotStatus,
  currentVoteRecord,
  latestVoteRecord,
} from "../shared/vote-display";
import type { LiveVote, PublicRecord } from "../shared/types";

const record = (
  id: string,
  voters: string[],
  overrides: Partial<PublicRecord> = {},
): PublicRecord => ({
  id,
  day: 1,
  period: "DAY",
  type: "vote",
  text: id,
  voters,
  eligibleAtVote: ["a", "b"],
  seatNumbers: { a: 1, b: 2, c: 3 },
  nominator: "a",
  nominee: "b",
  createdAt: "2026-11-01T00:00:00Z",
  ...overrides,
});
const ballot = (overrides: Partial<LiveVote> = {}): LiveVote => ({
  id: "phone",
  day: 1,
  nominator: "a",
  nominee: "b",
  order: ["c", "a", "b"],
  hands: {},
  counted: { a: true, b: false, c: false },
  status: "FINISHED",
  deadAtVote: ["c"],
  eligibleAtVote: ["a", "b"],
  recordId: "phone-record",
  ...overrides,
});

describe("public display uses the latest ballot across phone and offline records", () => {
  it("shows an offline ballot when there is no phone ballot", () => {
    const offline = record("offline", ["b"]);
    expect(latestVoteRecord([offline])).toBe(offline);
    expect(ballotStatus(undefined, [offline], "b")).toBe("已投 1 票");
    expect(ballotStatus(undefined, [offline], "a")).toBe("未投 / 弃票");
    expect(ballotStatus(undefined, [offline], "c")).toBe("无可用死者票");
  });

  it("replaces finished phone results with a more recent offline ballot", () => {
    const phone = record("phone-record", ["a"]),
      offline = record("offline", ["b"]);
    expect(latestVoteRecord([phone, offline])).toBe(offline);
    expect(ballotStatus(ballot(), [phone, offline], "a")).toBe("未投 / 弃票");
    expect(ballotStatus(ballot(), [phone, offline], "b")).toBe("已投 1 票");
    expect(currentVoteRecord(ballot(), [phone, offline])).toBe(phone);
  });

  it("does not let a late correction to an old ballot replace a newer ballot", () => {
    const old = record("phone-record", ["a"]),
      newer = record("offline", ["b"], { day: 2 });
    const correction = record("old-fixed", [], { supersedes: old.id });
    const correctionAgain = record("old-fixed-again", ["a"], {
      supersedes: correction.id,
    });
    const records = [old, newer, correction, correctionAgain];
    expect(latestVoteRecord(records)).toBe(newer);
    expect(ballotStatus(ballot(), records, "a")).toBe("未投 / 弃票");
    expect(ballotStatus(ballot(), records, "b")).toBe("已投 1 票");
    expect(currentVoteRecord(ballot(), records)).toBe(correctionAgain);
    expect(old.voters).toEqual(["a"]);
  });

  it("follows the latest ballot's correction chain while preserving eligibility", () => {
    const first = record("first", ["a"]),
      second = record("second", ["b"]);
    const corrected = record("second-fixed", [], { supersedes: second.id });
    const records = [first, second, corrected];
    expect(latestVoteRecord(records)).toBe(corrected);
    expect(ballotStatus(undefined, records, "b")).toBe("未投 / 弃票");
    expect(ballotStatus(undefined, records, "c")).toBe("无可用死者票");
    expect(second.voters).toEqual(["b"]);
  });

  it("shows the active phone ballot instead of previous offline results", () => {
    const offline = record("offline", ["b"]);
    const open = ballot({ status: "OPEN", counted: {}, hands: { a: true } });
    expect(ballotStatus(open, [offline], "a")).toBe("已举手");
    expect(ballotStatus(open, [offline], "b")).toBe("未举手");
    expect(ballotStatus(open, [offline], "c")).toBe("无可用死者票");
    const locked = ballot({ status: "COUNTING", counted: { a: true, b: false, c: false }, hands: { a: true } });
    expect(ballotStatus(locked, [offline], "a")).toBe("已举手 · 已锁定");
    expect(ballotStatus(locked, [offline], "b")).toBe("未举手 · 已锁定");
  });

  it("shows latest valid results after cancellation, or cancellation when none exist", () => {
    const cancelled = ballot({ status: "CANCELLED" });
    const offline = record("offline", ["b"]);
    expect(ballotStatus(cancelled, [offline], "b")).toBe("已投 1 票");
    expect(ballotStatus(cancelled, [], "b")).toBe("本次已取消");
    expect(ballotStatus(undefined, [], "b")).toBe("—");
  });

  it("does not infer eligibility for historical records that did not save it", () => {
    const legacy = record("legacy", ["b"], { eligibleAtVote: undefined });
    expect(ballotStatus(undefined, [legacy], "a")).toBe("未投（资格未记录）");
    expect(ballotStatus(undefined, [legacy], "c")).toBe("未投（资格未记录）");
  });
});
