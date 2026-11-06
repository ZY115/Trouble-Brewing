import type {
  NightAction,
  NightPlanItem,
  RoomView,
  RuleNotice,
} from "../../shared/types";
import { completedAction } from "../../shared/assistance";
import { latestVoteRecord } from "../../shared/vote-display";

export type Task =
  | { id: string; kind: "end" }
  | { id: string; kind: "notice"; notice: RuleNotice }
  | { id: string; kind: "stale" }
  | { id: string; kind: "generate" }
  | { id: string; kind: "plan"; item: NightPlanItem; action?: NightAction; step: number }
  | { id: string; kind: "action"; action: NightAction }
  | { id: string; kind: "dawn" }
  | { id: string; kind: "publish" }
  | { id: string; kind: "vote" }
  | { id: string; kind: "verdict"; recordId: string }
  | { id: string; kind: "nominate" };

export const isNightPhase = (room: RoomView) =>
  room.phase === "FIRST_NIGHT" || room.phase === "OTHER_NIGHT";

export function planItemDone(room: RoomView, i: NightPlanItem) {
  if (i.retiredReason || i.status === "skipped" || i.status === "offline") return true;
  if (i.status === "started") {
    const a = room.actions.find((x) => x.id === i.actionId);
    return !a || completedAction(a);
  }
  return false;
}

export function taskDone(room: RoomView, t: Task) {
  if (t.kind === "plan") return planItemDone(room, t.item);
  if (t.kind === "action") return completedAction(t.action);
  return false;
}

export function taskWaiting(t: Task) {
  const a = t.kind === "plan" ? t.action : t.kind === "action" ? t.action : undefined;
  return !!a && a.status === "REQUESTED";
}

export function nightTasks(room: RoomView): Task[] {
  const st = room.storyteller!;
  const tasks: Task[] = [
    ...endTask(room),
    ...st.notices.map((notice) => ({ id: `notice:${notice.id}`, kind: "notice" as const, notice })),
  ];
  if (st.staleConditions.length) tasks.push({ id: "stale", kind: "stale" });
  const all = st.nightPlan.filter((i) => i.night === room.day);
  if (!all.length) tasks.push({ id: "generate", kind: "generate" });
  const items = all.filter((i) => !i.retiredReason);
  items.forEach((item, step) =>
    tasks.push({
      id: `plan:${item.id}`,
      kind: "plan",
      item,
      step,
      action: room.actions.find((a) => a.id === item.actionId),
    }),
  );
  room.actions
    .filter((a) => a.night === room.day && !all.some((i) => i.actionId === a.id))
    .forEach((action) => tasks.push({ id: `action:${action.id}`, kind: "action", action }));
  tasks.push({ id: "dawn", kind: "dawn" });
  return tasks;
}

export function executedToday(room: RoomView) {
  const all = room.storyteller!.executions;
  return all.find((e) => e.day === room.day && !e.voided && !all.some((n) => n.supersedes === e.id));
}

export function dayTasks(room: RoomView): Task[] {
  const st = room.storyteller!;
  const tasks: Task[] = [
    ...endTask(room),
    ...st.notices.map((notice) => ({ id: `notice:${notice.id}`, kind: "notice" as const, notice })),
  ];
  if (st.staleConditions.length) tasks.push({ id: "stale", kind: "stale" });
  if (room.seats.some((s) => s.alive !== st.publishedAlive[s.id]))
    tasks.push({ id: "publish", kind: "publish" });
  const vote = room.liveVote;
  const latest = latestVoteRecord(room.publicRecords);
  if (vote && ["OPEN", "COUNTING"].includes(vote.status)) tasks.push({ id: `vote:${vote.id}`, kind: "vote" });
  else if (latest && latest.day === room.day && latest.period === "DAY" && !executedToday(room))
    tasks.push({ id: `verdict:${latest.id}`, kind: "verdict", recordId: latest.id });
  tasks.push({ id: "nominate", kind: "nominate" });
  return tasks;
}

function endTask(room: RoomView): Task[] {
  const met = (room.storyteller!.endReview?.suggestions ?? []).filter((s) => s.status === "met");
  return met.length ? [{ id: `end:${met.map((s) => s.id).join(",")}`, kind: "end" }] : [];
}

export function currentTask(room: RoomView, tasks: Task[], dismissed: string[]) {
  return (
    tasks.find((t) => !taskDone(room, t) && !dismissed.includes(t.id)) ??
    tasks[tasks.length - 1]
  );
}
