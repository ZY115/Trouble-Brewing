import type {
  NightAction,
  NightPlanItem,
  RoomView,
  RuleNotice,
} from "../../shared/types";
import { completedAction } from "../../shared/assistance";

/**
 * Everything the storyteller has to do is one queue. Rule reminders, expired
 * markers, night steps, announcements and votes all become tasks, so the
 * screen always has exactly one current thing with one primary button.
 */
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
  | { id: string; kind: "verdict" }
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

/** A started step whose player has not chosen yet: the storyteller cannot act on it. */
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
  const items = st.nightPlan.filter((i) => i.night === room.day);
  if (!items.length) tasks.push({ id: "generate", kind: "generate" });
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
    .filter((a) => a.night === room.day && !items.some((i) => i.actionId === a.id))
    .forEach((action) => tasks.push({ id: `action:${action.id}`, kind: "action", action }));
  tasks.push({ id: "dawn", kind: "dawn" });
  return tasks;
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
  if (vote && ["OPEN", "COUNTING"].includes(vote.status)) tasks.push({ id: `vote:${vote.id}`, kind: "vote" });
  else if (vote && vote.status === "FINISHED" && vote.day === room.day)
    tasks.push({ id: `verdict:${vote.id}`, kind: "verdict" });
  tasks.push({ id: "nominate", kind: "nominate" });
  return tasks;
}

/**
 * Once an ending condition is met it comes first, so it cannot be missed.
 * Its id names the conditions: a new one surfaces again after "继续游戏".
 */
function endTask(room: RoomView): Task[] {
  const met = (room.storyteller!.endReview?.suggestions ?? []).filter((s) => s.status === "met");
  return met.length ? [{ id: `end:${met.map((s) => s.id).join(",")}`, kind: "end" }] : [];
}

/** First task that still needs the storyteller, skipping ones dismissed this session. */
export function currentTask(room: RoomView, tasks: Task[], dismissed: string[]) {
  return (
    tasks.find((t) => !taskDone(room, t) && !dismissed.includes(t.id)) ??
    tasks[tasks.length - 1]
  );
}
