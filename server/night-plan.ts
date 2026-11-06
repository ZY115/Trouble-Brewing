import { FIRST_NIGHT_ORDER, OTHER_NIGHT_ORDER } from "../shared/night-order";
import { choiceKindForRole } from "../shared/action-choice";
import { randomUUID } from "node:crypto";
import type { Room } from "./game";
import type { Command } from "../shared/commands";
import type { NightPlanItem } from "../shared/types";
import { completedAction, nightTemplate } from "../shared/assistance";
import { effectiveExecutions } from "./life";
import { roleById, roleName } from "../shared/roles";

function check(v: unknown, message: string): asserts v {
  if (!v) throw new Error(message);
}

const NOT_KILLED = "守鸦人今晚没有死亡，不用唤醒";
const NO_EXECUTION = "今天白天没有人死于处决，不用唤醒";
const DIED = "今晚已死亡，不再唤醒";
const AUTOMATIC = new Set([NOT_KILLED, NO_EXECUTION, DIED]);

export function refreshConditionalItems(r: Room, bump = true) {
  if (r.phase !== "FIRST_NIGHT" && r.phase !== "OTHER_NIGHT") return;
  const alive = (id: string) => !!r.seats.find((s) => s.id === id)?.alive;
  const executionDeath = effectiveExecutions(r).some(
    (e) => e.day === r.day - 1 && e.died && !e.voided,
  );
  let changed = false;
  for (const item of r.nightPlan) {
    if (item.night !== r.day || item.status !== "planned" || !item.seatId) continue;
    if (item.retiredReason && !AUTOMATIC.has(item.retiredReason)) continue;
    const reason =
      item.roleId === "ravenkeeper"
        ? r.deathEvents.some(
            (d) => d.seatId === item.seatId && d.day === r.day && d.phase !== "DAY",
          ) && !alive(item.seatId)
          ? undefined
          : NOT_KILLED
        : !alive(item.seatId)
          ? DIED
          : item.roleId === "undertaker" && !executionDeath
            ? NO_EXECUTION
            : undefined;
    if (item.retiredReason === reason) continue;
    if (reason) item.retiredReason = reason;
    else delete item.retiredReason;
    changed = true;
  }
  if (changed && bump) r.planVersion++;
}
export function replanSeat(r: Room, seatId: string, from: string, to: string) {
  if ((r.phase !== "FIRST_NIGHT" && r.phase !== "OTHER_NIGHT") || from === to) return;
  const tonight = r.nightPlan.filter((i) => i.night === r.day);
  if (!tonight.length) return;
  const reason = `身份已改为${roleName(to)}`;
  const stale = tonight.filter((i) => i.seatId === seatId && i.roleId === from && !i.retiredReason);
  if (stale.length) r.planVersion++;
  for (const item of stale) {
    const action = r.actions.find((a) => a.id === item.actionId);
    if (item.status === "planned" || (action && !completedAction(action))) item.retiredReason = reason;
    if (action && !completedAction(action)) {
      action.status = "CANCELLED";
      action.resolutionReason = reason;
      delete action.response;
    }
  }
  const order = r.day === 1 ? FIRST_NIGHT_ORDER : OTHER_NIGHT_ORDER;
  if (!order.includes(to) || tonight.some((i) => i.seatId === seatId && i.roleId === to && !i.retiredReason)) return;
  const t = nightTemplate(to);
  const item: NightPlanItem = {
    id: randomUUID(),
    night: r.day,
    seatId,
    roleId: to,
    prompt: t.prompt,
    targetCount: t.targetCount,
    note: "",
    status: "planned",
  };
  const at = r.nightPlan.findIndex((i) => i.night === r.day && i.roleId && order.indexOf(i.roleId) > order.indexOf(to));
  if (at < 0) r.nightPlan.push(item);
  else r.nightPlan.splice(at, 0, item);
  r.planVersion++;
}

export function planCommand(
  r: Room,
  st: boolean,
  c: Command,
): string | undefined {
  if (
    c.type !== "start_all_plan" &&
    c.type !== "generate_night_plan" &&
    c.type !== "save_plan_item" &&
    c.type !== "plan_item"
  )
    return;
  check(st, "此操作仅限说书人");
  check(
    ["FIRST_NIGHT", "OTHER_NIGHT"].includes(r.phase),
    "建议清单仅在夜间编辑",
  );
  check(
    c.expectedPhaseVersion === r.phaseVersion,
    "夜晚已变化，请重新核对清单",
  );
  check(
    c.expectedPlanVersion === r.planVersion,
    "清单已有修改，请查看最新版本",
  );
  const make = (
    seatId: string,
    roleId: string,
    prompt: string,
    targetCount: number,
    note: string,
  ): NightPlanItem => ({
    id: randomUUID(),
    night: r.day,
    seatId,
    roleId,
    prompt,
    targetCount,
    note,
    status: "planned",
  });
  if (c.type === "generate_night_plan") {
    check(
      !r.nightPlan.some((i) => i.night === r.day),
      "本夜已有清单，请直接编辑或添加，避免重复",
    );
    if (r.day === 1)
      r.nightPlan.push(
        make(
          "",
          "",
          "发放首夜邪恶队友信息与假身份",
          0,
          "",
        ),
      );
    const order = r.day === 1 ? FIRST_NIGHT_ORDER : OTHER_NIGHT_ORDER;
    for (const roleId of order) {
      if (roleId === "scarletwoman") {
        if (
          !(
            r.deathEvents.some(
              (d) =>
                d.scarletEligible &&
                !d.successorId &&
                !r.seats.find((s) => s.id === d.seatId)?.alive,
            ) &&
            !r.seats.some(
              (s) => s.alive && r.assignments[s.id]?.actualRoleId === "imp",
            )
          )
        )
          continue;
        r.nightPlan.push(
          make(
            "",
            "scarletwoman",
            "核对猩红女郎继任",
            0,
            "",
          ),
        );
        continue;
      }
      for (const seat of r.seats.filter(
        (s) => r.assignments[s.id]?.perceivedRoleId === roleId,
      )) {
        if (!seat.alive && roleId !== "ravenkeeper") continue;
        if (
          roleId === "imp" &&
          r.deathEvents.some(
            (d) =>
              d.selfKill &&
              d.day === r.day &&
              d.phase !== "DAY" &&
              d.successorId === seat.id,
          )
        )
          continue;
        const t = nightTemplate(roleId);
        r.nightPlan.push(make(seat.id, roleId, t.prompt, t.targetCount, ""));
      }
    }
  } else if (c.type === "start_all_plan") {
    const ready = r.nightPlan.filter(
      (i) =>
        i.night === r.day &&
        i.status === "planned" &&
        !i.retiredReason &&
        i.seatId &&
        (i.roleId === "ravenkeeper"
          ? r.deathEvents.some(
              (d) =>
                d.seatId === i.seatId && d.day === r.day && d.phase !== "DAY",
            ) && !r.seats.find((s) => s.id === i.seatId)?.alive
          : r.seats.some((s) => s.id === i.seatId && s.alive)) &&
        (i.roleId !== "undertaker" ||
          effectiveExecutions(r).some(
            (e) => e.day === r.day - 1 && e.died && !e.voided,
          )),
    );
    check(ready.length, "没有可以批量发起的玩家待办");
    for (const i of ready) startItem(r, i);
  } else if (c.type === "save_plan_item") {
    check(!c.seatId || r.seats.some((s) => s.id === c.seatId), "玩家不存在");
    check(!c.roleId || roleById(c.roleId), "未知参考身份");
    if (c.itemId) {
      const item = r.nightPlan.find(
        (i) => i.id === c.itemId && i.night === r.day,
      );
      check(item && item.status === "planned", "只能编辑尚未开始的清单项");
      Object.assign(item, {
        seatId: c.seatId,
        roleId: c.roleId,
        prompt: c.prompt,
        targetCount: c.targetCount,
        note: c.note,
      });
    } else
      r.nightPlan.push(
        make(c.seatId, c.roleId, c.prompt, c.targetCount, c.note),
      );
  } else {
    const index = r.nightPlan.findIndex(
        (i) => i.id === c.itemId && i.night === r.day,
      ),
      item = r.nightPlan[index];
    check(item, "清单项不存在");
    if (c.operation === "restore") {
      check(
        !item.retiredReason,
        "身份已变更或检查已完成，此项仅保留历史，不能恢复",
      );
      check(["skipped", "offline"].includes(item.status), "该项不能恢复");
      item.status = "planned";
    } else if (c.operation === "up" || c.operation === "down") {
      const other = index + (c.operation === "up" ? -1 : 1);
      check(r.nightPlan[other]?.night === r.day, "已经位于清单边界");
      [r.nightPlan[index], r.nightPlan[other]] = [
        r.nightPlan[other],
        r.nightPlan[index],
      ];
    } else {
      check(item.status === "planned", "该项已经处理，不能重复执行");
      if (c.operation === "delete") r.nightPlan.splice(index, 1);
      if (c.operation === "skip") item.status = "skipped";
      if (c.operation === "offline") item.status = "offline";
      if (c.operation === "start") {
        check(item.seatId, "仅说书人清单项请标记线下完成");
        startItem(r, item);
      }
    }
  }
  refreshConditionalItems(r, false);
  r.planVersion++;
  return "更新可选夜间清单（未开始的建议不阻止天亮）";
}

function startItem(r: Room, item: NightPlanItem) {
  check(!item.retiredReason, "此项已失效，不能再次发起");
  const existing = r.actions.find(
    (a) =>
      a.night === r.day &&
      a.seatId === item.seatId &&
      a.referenceRoleId === item.roleId &&
      !["CANCELLED", "OFFLINE"].includes(a.status),
  );
  if (existing) {
    item.actionId = existing.id;
    item.status = "started";
    return;
  }
  const action = {
    id: randomUUID(),
    night: r.day,
    seatId: item.seatId,
    prompt: item.prompt,
    targetCount: item.targetCount,
    targets: [],
    referenceRoleId: item.roleId,
    choiceKind: choiceKindForRole(item.roleId),
    status:
      item.targetCount === 0 ? ("ST_REVIEW" as const) : ("REQUESTED" as const),
  };
  r.actions.push(action);
  item.actionId = action.id;
  item.status = "started";
}
