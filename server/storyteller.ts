import {
  publishLife,
  setLife,
  effectiveExecutions,
  reviseExecution,
} from "./life";
import { completedAction } from "../shared/assistance";
import { randomUUID } from "node:crypto";
import { isEvil, roleById } from "../shared/roles";
import type { Command } from "../shared/commands";
import type { Room } from "./game";
import { publicRecord } from "./public-records";
import { voteActive } from "./voting";
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export function storytellerCommand(
  r: Room,
  st: boolean,
  c: Command,
): string | undefined {
  if (
    ![
      "publish_life",
      "correct_phase",
      "correct_execution",
      "update_player",
      "set_red_herring",
      "execute_player",
      "day_timer",
      "force_nomination",
    ].includes(c.type)
  )
    return;
  check(st, "此操作仅限说书人");
  if ("expectedContextVersion" in c)
    check(
      c.expectedContextVersion === r.contextVersion,
      "游戏状态已变化，请重新载入后核对",
    );
  switch (c.type) {
    case "update_player": {
      check(
        ["FIRST_NIGHT", "OTHER_NIGHT", "DAY"].includes(r.phase),
        "请在游戏开始后调整状态",
      );
      const s = r.seats.find((s) => s.id === c.seatId);
      check(s, "玩家不存在");
      check(
        roleById(c.actualRoleId) && roleById(c.perceivedRoleId),
        "身份不属于暗流涌动",
      );
      check(
        c.actualRoleId === "drunk"
          ? roleById(c.perceivedRoleId)?.team === "townsfolk"
          : c.actualRoleId === c.perceivedRoleId,
        "只有酒鬼使用不同的镇民认知身份",
      );
      if (s.alive !== c.alive) {
        check(!voteActive(r), "请先取消或完成当前投票，再改变生死状态");
      }
      setLife(r, s.id, c.alive);
      r.assignments[s.id] = {
        actualRoleId: c.actualRoleId,
        perceivedRoleId: c.perceivedRoleId,
      };
      r.conditions[s.id] = c.conditions;
      r.contextVersion++;
      return `调整 ${s.number} 号身份或状态：${c.reason}`;
    }
    case "set_red_herring": {
      check(
        ["FIRST_NIGHT", "OTHER_NIGHT", "DAY"].includes(r.phase),
        "请先发放身份",
      );
      check(
        !c.seatId ||
          (r.seats.some((s) => s.id === c.seatId) &&
            !isEvil(r.assignments[c.seatId]?.actualRoleId)),
        "请选择当前善良玩家",
      );
      r.redHerring = c.seatId || undefined;
      r.contextVersion++;
      return "设置占卜误判目标（仅说书人可见）";
    }
    case "execute_player": {
      check(r.phase === "DAY", "只能在白天登记处决");
      const s = r.seats.find((s) => s.id === c.seatId);
      check(s, "玩家不存在");
      if (voteActive(r)) {
        r.liveVote!.status = "CANCELLED";
        publicRecord(r, {
          type: "status",
          text: "说书人手动处决，取消尚未完成的计票。",
        });
      }
      const died = c.died ?? s.alive;
      const execution = {
        id: randomUUID(),
        day: r.day,
        seatId: s.id,
        actualRoleId: r.assignments[s.id].actualRoleId,
        died,
        impaired: !!(r.conditions[s.id]?.poisoned || r.conditions[s.id]?.drunk),
        reason: c.reason,
        publicRecordId: "",
      };
      publicRecord(r, {
        type: "execution",
        text: `说书人登记 ${s.number} 号处决${died ? "，因处决死亡（含补录）" : "，处决未导致死亡"}：${c.reason}`,
      });
      execution.publicRecordId = r.publicRecords.at(-1)!.id;
      r.executions.push(execution);
      if (died) setLife(r, s.id, false);
      r.contextVersion++;
      return `手动处决 ${s.number} 号：${c.reason}`;
    }
    case "force_nomination": {
      check(
        r.phase === "DAY" &&
          r.liveVote?.id === c.voteId &&
          r.liveVote.status === "OPEN",
        "当前没有等待计票的提名",
      );
      r.liveVote.status = "COUNTING";
      publicRecord(r, {
        type: "status",
        text: `说书人强制进入本次提名计票：${c.reason}`,
      });
      return "强制进入计票（不执行处决）";
    }
    case "publish_life": {
      check(
        ["FIRST_NIGHT", "OTHER_NIGHT", "DAY"].includes(r.phase),
        "请在本局进行时公布状态",
      );
      check(
        c.seatIds.every((id) => r.seats.some((s) => s.id === id)),
        "玩家不存在",
      );
      publishLife(r, c.seatIds);
      r.contextVersion++;
      return "说书人手动公布选中玩家的生死状态";
    }
    case "correct_phase": {
      check(
        ["FIRST_NIGHT", "OTHER_NIGHT", "DAY"].includes(r.phase),
        "只能更正正在进行的对局阶段",
      );
      check(
        c.expectedPhaseVersion === r.phaseVersion,
        "阶段已变化，请重新核对",
      );
      check(c.phase !== "FIRST_NIGHT" || c.day === 1, "首夜必须是第 1 夜");
      check(c.phase !== "OTHER_NIGHT" || c.day >= 2, "其他夜晚从第 2 夜开始");
      check(!voteActive(r), "请先取消或完成当前投票再更正阶段");
      check(c.phase !== r.phase || c.day !== r.day, "已经处于这一阶段");
      for (const a of r.actions.filter((a) => !completedAction(a))) {
        a.status = "CANCELLED";
        a.resolutionReason = "阶段更正取消未完成待办：" + c.reason;
        delete a.response;
      }
      const before = `第 ${r.day} ${r.phase === "DAY" ? "天" : "夜"}`;
      r.phase = c.phase;
      r.day = c.day;
      r.phaseVersion++;
      r.contextVersion++;
      r.dayTimer = undefined;
      publicRecord(r, {
        type: "phase",
        text: `说书人将 ${before} 更正为第 ${r.day} ${r.phase === "DAY" ? "天" : "夜"}：${c.reason}`,
      });
      if (r.phase === "DAY") publishLife(r);
      return "更正阶段，保留历史并取消未完成待办";
    }
    case "correct_execution": {
      check(
        ["FIRST_NIGHT", "OTHER_NIGHT", "DAY"].includes(r.phase),
        "请在本局进行时更正处决",
      );
      check(!voteActive(r), "请先取消或完成当前投票");
      const original = effectiveExecutions(r).find(
        (e) => e.id === c.executionId,
      );
      check(original, "处决记录已更正，请打开最新记录");
      check(!c.voided || !c.died, "撤销的处决不能保留处决死亡");
      reviseExecution(r, original, {
        died: c.died,
        voided: c.voided,
        reason: c.reason,
      });
      setLife(r, original.seatId, c.alive, false);
      r.contextVersion++;
      return "更正处决登记与生死状态（保留历史）";
    }
    case "day_timer": {
      check(
        c.expectedPhaseVersion === r.phaseVersion,
        "阶段已变化，请重新设置计时",
      );
      check(
        c.expectedTimerId === (r.dayTimer?.id ?? null),
        "计时器已变化，请使用最新计时器",
      );
      check(r.phase === "DAY", "只能在白天设置倒计时");
      const now = Date.now();
      if (c.operation === "start") {
        check(c.seconds, "请设置时长");
        r.dayTimer = {
          id: randomUUID(),
          day: r.day,
          remainingMs: c.seconds * 1000,
          endsAt: now + c.seconds * 1000,
        };
      }
      if (c.operation === "clear") r.dayTimer = undefined;
      if (c.operation === "pause") {
        check(r.dayTimer?.endsAt != null, "当前没有运行中的倒计时");
        r.dayTimer!.remainingMs = Math.max(0, r.dayTimer!.endsAt! - now);
        r.dayTimer!.endsAt = null;
      }
      if (c.operation === "resume") {
        check(
          r.dayTimer &&
            r.dayTimer.endsAt === null &&
            r.dayTimer.remainingMs > 0,
          "没有可继续的倒计时",
        );
        r.dayTimer.endsAt = now + r.dayTimer.remainingMs;
      }
      if (r.dayTimer) r.dayTimer.id = randomUUID();
      return "调整白天提醒计时（不改变游戏阶段）";
    }
  }
}
