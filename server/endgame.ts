import { createHash } from "node:crypto";
import type { Command } from "../shared/commands";
import type { EndReview, EndSuggestion } from "../shared/endgame";
import { completedAction } from "../shared/assistance";
import { roleById } from "../shared/roles";
import { effectiveExecutions, publishLife } from "./life";
import { voteActive } from "./voting";
import { buildRecap } from "./recap";
import type { Room } from "./game";

export function endReview(r: Room): EndReview {
  const available = ["DAY", "FIRST_NIGHT", "OTHER_NIGHT"].includes(r.phase);
  const suggestions: EndSuggestion[] = [];
  const alive = r.seats.filter((s) => s.alive);
  const demons = alive.filter(
    (s) => roleById(r.assignments[s.id]?.actualRoleId)?.team === "demon",
  );
  if (available) {
    if (!demons.length) {
      const death = r.deathEvents
        .filter(
          (d) =>
            d.roleId === "imp" &&
            !r.seats.find((s) => s.id === d.seatId)?.alive,
        )
        .at(-1);
      const pending =
        death &&
        !death.successorId &&
        death.candidates.some(
          (id) =>
            alive.some((s) => s.id === id) &&
            (death.scarletEligible
              ? r.assignments[id]?.actualRoleId === "scarletwoman"
              : death.selfKill &&
                !death.impaired &&
                roleById(r.assignments[id]?.actualRoleId)?.team === "minion"),
        );
      suggestions.push(
        pending
          ? {
              id: "succession",
              status: "check",
              text: "恶魔已死，但还有继任没处理。",
            }
          : !death
            ? {
                id: "no-demon-unverified",
                status: "check",
                text: "场上没有存活的恶魔，但缺少死亡记录，请核对。",
              }
            : {
                id: "no-demon",
                status: "met",
                winner: "good",
                text: "恶魔已死且没有人继任，善良获胜。",
              },
      );
    }
    if (demons.length && alive.length <= 2)
      suggestions.push({
        id: "two-alive",
        status: "met",
        winner: "evil",
        text: `只剩 ${alive.length} 人存活且恶魔还活着，邪恶获胜。`,
      });
    for (const execution of effectiveExecutions(r).filter(
      (e) => e.died && !e.voided && e.actualRoleId === "saint",
    )) {
      if (execution.impaired === true) continue;
      suggestions.push({
        id: `saint:${execution.id}`,
        status: execution.impaired === false ? "met" : "check",
        winner: execution.impaired === false ? "evil" : undefined,
        text:
          execution.impaired === false
            ? `第 ${execution.day} 天健康的圣徒被处决，邪恶获胜。`
            : `第 ${execution.day} 天圣徒被处决，记录里没有当时是否中毒，请核对。`,
      });
    }
    if (
      r.dayEndVictory &&
      !effectiveExecutions(r).some(
        (e) => e.day === r.dayEndVictory!.day && !e.voided,
      )
    )
      suggestions.push({
        id: `mayor-ended:${r.dayEndVictory.day}`,
        status: "met",
        winner: "good",
        text: `第 ${r.dayEndVictory.day} 天只剩三人、镇长健康且当天无人被处决，善良获胜。`,
      });
    else if (
      r.phase === "DAY" &&
      alive.length === 3 &&
      !effectiveExecutions(r).some((e) => e.day === r.day && !e.voided)
    ) {
      const mayor = alive.find(
        (s) =>
          r.assignments[s.id]?.actualRoleId === "mayor" &&
          !r.conditions[s.id]?.poisoned &&
          !r.conditions[s.id]?.drunk,
      );
      if (mayor)
        suggestions.push({
          id: `mayor:${mayor.id}`,
          status: "end_day",
          winner: "good",
          text: "只剩三人、镇长健康且今天还没处决。今天就此结束的话，善良获胜。",
        });
    }
  }
  const winners = [
    ...new Set(
      suggestions
        .filter((s) => s.status === "met")
        .map((s) => s.winner)
        .filter(Boolean),
    ),
  ];
  const pendingActions = r.actions.filter((a) => !completedAction(a)).length;
  const activeVote = !!voteActive(r);
  return {
    available,
    buttonLabel:
      r.phase === "ENDED"
        ? "已结束"
        : suggestions.some((s) => s.status === "met")
          ? "结束游戏"
          : "提前结束",
    suggestions,
    suggestedWinner: winners.length === 1 ? winners[0] : undefined,
    pendingActions,
    activeVote,
    key: createHash("sha256")
      .update(
        JSON.stringify([
          r.gameNo,
          r.phase,
          r.day,
          r.phaseVersion,
          r.contextVersion,
          r.recapVersion ?? 0,
          suggestions,
          r.actions.map((a) => [
            a.id,
            a.status,
            a.selectionVersion,
            a.responseVersion,
          ]),
          r.liveVote,
        ]),
      )
      .digest("hex"),
  };
}

export function finishGame(
  r: Room,
  c: Extract<Command, { type: "finish_game" }>,
) {
  const review = endReview(r);
  if (!review.available) throw new Error("只能结束正在进行的对局");
  if (c.expectedReviewKey !== review.key)
    throw new Error("结束确认内容已变化，请重新核对");
  if (c.mode === "normal" && c.winner === "none")
    throw new Error("正常结束请明确最终胜方");
  if (c.endDay && (r.phase !== "DAY" || review.activeVote))
    throw new Error("请在白天完成或取消投票后确认结束当天");
  const suggestions = review.suggestions.map((s) =>
    c.endDay && s.status === "end_day" ? { ...s, status: "met" as const } : s,
  );
  const winners = [
    ...new Set(
      suggestions
        .filter((s) => s.status === "met")
        .map((s) => s.winner)
        .filter(Boolean),
    ),
  ];
  if (
    c.mode === "normal" &&
    (winners.length !== 1 || winners[0] !== c.winner) &&
    !c.reason
  )
    throw new Error("最终裁定与系统建议不一致或尚无明确建议，请填写裁定说明");
  r.result = {
    gameNo: r.gameNo,
    mode: c.mode,
    winner: c.winner,
    reason: c.reason,
    endedAt: new Date().toISOString(),
    day: r.day,
    period: r.phase === "DAY" ? "DAY" : "NIGHT",
    suggestions,
  };
  for (const action of r.actions.filter((a) => !completedAction(a))) {
    action.status = "CANCELLED";
    action.resolutionReason = "说书人结束本局，取消未完成待办";
    delete action.response;
  }
  if (review.activeVote) r.liveVote!.status = "CANCELLED";
  if (c.mode === "normal") publishLife(r);
  r.phase = "ENDED";
  r.phaseVersion++;
  r.contextVersion++;
  r.dayTimer = undefined;
  r.evilReleased = false;
  r.registrationOpen = false;
  if (c.mode === "normal") {
    r.recap = buildRecap(r);
  }
}
