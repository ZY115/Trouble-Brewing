import { randomUUID } from "node:crypto";
import type { Command } from "../shared/commands";
import type { Room } from "./game";
import { publicRecord } from "./public-records";
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export const voteActive = (r: Room) =>
  r.liveVote && ["OPEN", "COUNTING"].includes(r.liveVote.status);
export function refreshDeadVotes(r: Room) {
  const effective = r.publicRecords.filter(
    (e) =>
      e.type === "vote" &&
      !r.publicRecords.some((next) => next.supersedes === e.id),
  );
  r.seats.forEach((s) => {
    s.deadVoteAvailable =
      r.deadVoteOverrides[s.id] ??
      !effective.some((e) => e.deadVoters?.includes(s.id));
  });
}
export function voteCommand(
  r: Room,
  actor: string,
  st: boolean,
  c: Command,
): string | undefined {
  const host = () => check(st, "此操作仅限说书人");
  const seat = (id: string) => {
    const s = r.seats.find((s) => s.id === id);
    check(s, "玩家不存在");
    return s;
  };
  const ballot = (id: string) => {
    const b = r.liveVote;
    check(
      b && b.id === id && r.phase === "DAY" && voteActive(r),
      "这轮投票已结束或已更换",
    );
    return b;
  };
  switch (c.type) {
    case "open_vote": {
      host();
      check(
        r.phase === "DAY" && !voteActive(r),
        "请在白天结束当前投票后再发起",
      );
      seat(c.nominator);
      seat(c.nominee);
      const seats = [...r.seats].sort((a, b) => a.number - b.number),
        at = seats.findIndex((s) => s.id === c.nominee);
      const order = [...seats.slice(at + 1), ...seats.slice(0, at + 1)].map(
        (s) => s.id,
      );
      r.liveVote = {
        id: randomUUID(),
        day: r.day,
        nominator: c.nominator,
        nominee: c.nominee,
        order,
        hands: {},
        counted: {},
        cursor: 0,
        status: "OPEN",
        deadAtVote: seats.filter((s) => !s.alive).map((s) => s.id),
        eligibleAtVote: seats
          .filter((s) => s.alive || s.deadVoteAvailable)
          .map((s) => s.id),
      };
      return `开启对 ${seat(c.nominee).number} 号的手机举手投票`;
    }
    case "raise_hand": {
      check(!st, "玩家才能举手");
      const b = ballot(c.voteId),
        me = seat(actor);
      check(!(actor in b.counted), "你的票已计入，不能再改变");
      check(
        !c.raised || me.alive || me.deadVoteAvailable,
        "死者票已使用，请联系说书人核对",
      );
      b.hands[actor] = c.raised;
      return "更新举手状态";
    }
    case "start_count": {
      host();
      const b = ballot(c.voteId);
      check(b.status === "OPEN", "计票已经开始");
      b.status = "COUNTING";
      return "开始逐座计票";
    }
    case "count_vote": {
      host();
      const b = ballot(c.voteId);
      check(
        b.status === "COUNTING" && b.cursor === c.cursor,
        "计票位置已改变，请查看最新状态",
      );
      const id = b.order[b.cursor];
      check(id, "计票已完成");
      b.counted[id] = c.offlineVote ?? !!b.hands[id];
      b.cursor++;
      if (b.cursor === b.order.length) {
        b.status = "FINISHED";
        const voters = b.order.filter((id) => b.counted[id]),
          deadVoters = voters.filter((id) => b.deadAtVote.includes(id));
        deadVoters.forEach((id) => delete r.deadVoteOverrides[id]);
        publicRecord(r, {
          type: "vote",
          nominator: b.nominator,
          nominee: b.nominee,
          voters,
          deadAtVote: b.deadAtVote,
          eligibleAtVote: b.eligibleAtVote,
          deadVoters,
          seatNumbers: Object.fromEntries(r.seats.map((s) => [s.id, s.number])),
          text: `${seat(b.nominator).number}号提名${seat(b.nominee).number}号；投票：${voters.map((id) => `${seat(id).number}号`).join("、") || "无人"}（${voters.length}票）`,
        });
        b.recordId = r.publicRecords.at(-1)!.id;
        refreshDeadVotes(r);
        return "计票完成，自动发布公开记录";
      }
      return `计入 ${seat(id).number} 号${b.counted[id] ? "一票" : "未投票"}${c.offlineVote !== undefined ? "（线下代录）" : ""}`;
    }
    case "cancel_vote": {
      host();
      const b = ballot(c.voteId);
      b.status = "CANCELLED";
      publicRecord(r, {
        type: "status",
        text: `对 ${seat(b.nominee).number} 号的投票已取消：${c.reason}`,
      });
      return `取消投票：${c.reason}`;
    }
    case "set_dead_vote": {
      host();
      check(!voteActive(r), "请先结束或取消当前投票");
      const s = seat(c.seatId);
      r.deadVoteOverrides[s.id] = c.available;
      s.deadVoteAvailable = c.available;
      publicRecord(r, {
        type: "status",
        text: `说书人更正 ${s.number} 号死者票为${c.available ? "可用" : "已用"}：${c.reason}`,
      });
      return "更正死者票状态";
    }
  }
}
