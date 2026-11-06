import type { RoomView } from "./types";
import { completedAction } from "./assistance";

export function phaseReview(room: RoomView, publishLifeOnDawn: boolean) {
  const st = room.storyteller!;
  const night = room.phase !== "DAY";
  const plan = st.nightPlan.filter((i) => i.night === room.day);
  const pending = room.actions.filter(
    (a) => a.night === room.day && !completedAction(a),
  ).length;
  const voting =
    !!room.liveVote && ["OPEN", "COUNTING"].includes(room.liveVote.status);
  const unstarted = plan.filter(
    (i) => i.status === "planned" && !i.retiredReason,
  ).length;
  const changed = room.seats.filter((s) => st.publishedAlive[s.id] !== s.alive);
  const deaths = changed.filter((s) => !s.alive).map((s) => s.number);
  const revivals = changed.filter((s) => s.alive).map((s) => s.number);
  const lines: string[] = [];
  if (night) {
    lines.push(
      plan.length
        ? `清单还有 ${unstarted} 项未开始或未标记完成。`
        : "尚未生成本夜清单。",
    );
    if (room.phase === "FIRST_NIGHT" && !st.evilInfoSent && !st.evilReleased)
      lines.push("首夜邪恶信息尚未发送或确认线下发放。");
    if (publishLifeOnDawn) {
      lines.push(
        deaths.length
          ? `将公布 ${deaths.join("、")} 号死亡。`
          : "没有新增死亡需要公布。",
      );
      if (revivals.length)
        lines.push(`将公布 ${revivals.join("、")} 号恢复存活。`);
    } else lines.push("本次只宣布天亮，暂不公布生死变化。");
  } else {
    lines.push(`将进入第 ${room.day + 1} 夜，并清除白天倒计时。`);
    if (st.endReview?.suggestions.some((s) => s.status === "end_day"))
      lines.push("三人存活、镇长健康且今天无人被处决：结束白天后善良获胜。");
  }
  if (pending) lines.push(`还有 ${pending} 项已发起的待办未完成，请先处理。`);
  if (voting) lines.push("投票尚未结束，请先结束或取消投票。");
  lines.push(...st.notices.map((n) => n.text));
  return {
    lines,
    blocked: pending > 0 || voting,
    key: JSON.stringify([
      room.gameNo,
      room.phase,
      room.day,
      st.phaseVersion,
      st.contextVersion,
      st.planVersion,
      publishLifeOnDawn,
      lines,
    ]),
  };
}
