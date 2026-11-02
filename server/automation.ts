import { randomUUID } from "node:crypto";
import type { Room } from "./game";
import type { Command } from "../shared/commands";
import type { RuleNotice } from "../shared/types";
import { roleById, roleName } from "../shared/roles";
import { completedAction, nightTemplate } from "../shared/assistance";
import { emptyConditions, informationReference } from "./information";
import { effectiveExecutions, setLife } from "./life";
import { OTHER_NIGHT_ORDER } from "../shared/night-order";

const check = (v: unknown, message: string): void => {
  if (!v) throw new Error(message);
};
export function privateMessage(r: Room, to: string, content: string) {
  r.messages.push({
    id: randomUUID(),
    from: "storyteller",
    to,
    content,
    createdAt: new Date().toISOString(),
    sequence: ++r.messageSequence,
  });
}
export function ruleNotices(r: Room): RuleNotice[] {
  if (!["FIRST_NIGHT", "OTHER_NIGHT", "DAY"].includes(r.phase)) return [];
  const alive = r.seats.filter((s) => s.alive),
    demons = alive.filter((s) => r.assignments[s.id]?.actualRoleId === "imp");
  const notices: RuleNotice[] = [];
  if (!demons.length) {
    const deaths = r.deathEvents.filter(
      (d) =>
        d.roleId === "imp" && !r.seats.find((s) => s.id === d.seatId)?.alive,
    );
    const d = deaths.at(-1);
    if (d) {
      const candidates = d.candidates.filter(
        (id) =>
          alive.some((s) => s.id === id) &&
          (d.scarletEligible
            ? r.assignments[id]?.actualRoleId === "scarletwoman"
            : roleById(r.assignments[id]?.actualRoleId)?.team === "minion"),
      );
      notices.push({
        id: `demon:${d.id}`,
        kind: "demon",
        deathId: d.id,
        canConfirmSelfKill: d.phase !== "DAY" && !d.selfKill,
        candidates,
        text: `${r.seats.find((s) => s.id === d.seatId)?.number}号恶魔死亡；死亡前${d.aliveBefore}人存活。${d.scarletEligible ? "当时有健康清醒的猩红女郎，应核对继任。" : d.selfKill && !d.impaired ? "小恶魔以自身能力自杀，核对存活爪牙传位。" : "没有已确认的继任条件；核对善良胜利。若是未记录的自杀或特殊情况，请先在总体表裁定。"} ${candidates.length ? "确认继任后会更新身份和本夜清单。" : "当前无存活继任候选。"}`,
      });
    } else
      notices.push({
        id: `no-demon:${r.seats.map((s) => `${s.id}:${s.alive}:${r.assignments[s.id]?.actualRoleId}`).join(",")}`,
        kind: "victory",
        candidates: [],
        text: "当前没有存活恶魔。旧档案可能缺少死亡快照，请核对猩红女郎/自杀传位；无继任时善良获胜。",
      });
  }
  for (const e of effectiveExecutions(r).filter(
    (e) => e.died && !e.voided && e.actualRoleId === "saint",
  ))
    notices.push({
      id: `saint:${e.id}`,
      kind: "saint",
      candidates: [],
      text: `第${e.day}天${r.seats.find((s) => s.id === e.seatId)?.number}号圣徒因处决死亡：${e.impaired ? "当时有中毒/醉酒标记，能力可能不生效，需核对。" : e.impaired === undefined ? "旧记录未保存当时醉酒/中毒，请核对；健康清醒时邪恶获胜。" : "当时未标记中毒/醉酒，按通常规则邪恶获胜，请确认是否结束。"}`,
    });
  if (alive.length <= 2)
    notices.push({
      id: `two:${alive
        .map((s) => s.id)
        .sort()
        .join(",")}:${demons.length}`,
      kind: "victory",
      candidates: [],
      text: `仅剩${alive.length}人存活。${demons.length ? "仍有存活恶魔，通常邪恶获胜。" : "无存活恶魔，先处理恶魔死亡及继任；不要仅凭人数宣布邪恶胜利。"}`,
    });
  if (
    r.phase === "DAY" &&
    alive.length === 3 &&
    alive.some((s) => r.assignments[s.id]?.actualRoleId === "mayor") &&
    !effectiveExecutions(r).some((e) => e.day === r.day && !e.voided)
  )
    notices.push({
      id: `mayor:${r.day}:${alive
        .map((s) => s.id)
        .sort()
        .join(",")}`,
      kind: "mayor",
      candidates: [],
      text: "三人存活且有镇长，今天尚无有效处决。若今天不处决并结束白天，请核对镇长是否健康清醒；能力生效时善良获胜。",
    });
  return notices.filter((n) => !r.dismissedNotices.includes(n.id));
}
export function automationCommand(
  r: Room,
  st: boolean,
  c: Command,
): string | undefined {
  if (
    ![
      "apply_action",
      "set_condition",
      "clear_expired_conditions",
      "keep_expired_conditions",
      "send_evil_info",
      "resolve_notice",
      "promote_imp",
      "confirm_self_kill",
    ].includes(c.type)
  )
    return;
  check(st, "此操作仅限说书人");
  check(
    ["FIRST_NIGHT", "OTHER_NIGHT", "DAY"].includes(r.phase),
    "请在游戏中操作",
  );
  if ("expectedContextVersion" in c)
    check(
      c.expectedContextVersion === r.contextVersion,
      "真实状态已变化，请重新核对",
    );
  if (c.type === "set_condition") {
    check(
      r.seats.some((s) => s.id === c.seatId),
      "玩家不存在",
    );
    (r.conditions[c.seatId] ??= emptyConditions())[c.condition] = c.value;
    r.staleConditions = r.staleConditions.filter(
      (x) => x.seatId !== c.seatId || x.condition !== c.condition,
    );
  } else if (
    c.type === "clear_expired_conditions" ||
    c.type === "keep_expired_conditions"
  ) {
    if (c.type === "clear_expired_conditions")
      for (const x of r.staleConditions)
        (r.conditions[x.seatId] ??= emptyConditions())[x.condition] = false;
    r.staleConditions = [];
  } else if (c.type === "resolve_notice") {
    check(
      ruleNotices(r).some((n) => n.id === c.noticeId),
      "提醒已经变化",
    );
    r.dismissedNotices.push(c.noticeId);
  } else if (c.type === "send_evil_info") {
    check(
      r.phase === "FIRST_NIGHT" && !r.evilInfoSent,
      "首夜信息已发放，或已过首夜",
    );
    const minions = r.seats.filter(
      (s) => roleById(r.assignments[s.id]?.actualRoleId)?.team === "minion",
    );
    const demons = r.seats.filter(
      (s) => r.assignments[s.id]?.actualRoleId === "imp",
    );
    const numbers = (ids: typeof minions) =>
      ids.map((s) => `${s.number}号`).join("、") || "无";
    for (const s of minions)
      privateMessage(
        r,
        s.id,
        `首夜信息：恶魔是${numbers(demons)}；其他爪牙是${numbers(minions.filter((x) => x.id !== s.id))}。`,
      );
    for (const s of demons)
      privateMessage(
        r,
        s.id,
        `首夜信息：爪牙是${numbers(minions)}；不在场的善良假身份：${r.setup.bluffs.map(roleName).join("、")}。`,
      );
    r.evilInfoSent = true;
    r.evilReleased = true;
  } else if (c.type === "confirm_self_kill") {
    const d = r.deathEvents.find((d) => d.id === c.deathId);
    check(
      d &&
        d.roleId === "imp" &&
        d.phase !== "DAY" &&
        !d.selfKill &&
        !r.seats.find((s) => s.id === d.seatId)?.alive,
      "无法确认该次死亡为能力自杀",
    );
    d!.selfKill = true;
    if (!d!.scarletEligible)
      d!.candidates = d!.impaired ? [] : (d!.minionsAtDeath ?? []);
    r.dismissedNotices = r.dismissedNotices.filter(
      (id) => id !== `demon:${d!.id}`,
    );
  } else if (c.type === "promote_imp") {
    const notice = ruleNotices(r).find((n) => n.deathId === c.deathId);
    check(
      notice?.candidates.includes(c.seatId),
      "继任条件或候选已变化，请到总体表核对",
    );
    const source = r.deathEvents.find((d) => d.id === c.deathId)!;
    source.successorId = c.seatId;
    const passedThisNight =
      source.selfKill && source.day === r.day && source.phase !== "DAY";
    for (const i of r.nightPlan.filter(
      (i) =>
        i.night === r.day &&
        i.seatId === source.seatId &&
        i.status === "planned",
    ))
      i.status = "skipped";
    for (const a of r.actions.filter(
      (a) =>
        a.night === r.day && a.seatId === source.seatId && !completedAction(a),
    )) {
      a.status = "CANCELLED";
      a.resolutionReason = "原恶魔已死亡并完成继任";
      delete a.response;
    }
    r.assignments[c.seatId] = { actualRoleId: "imp", perceivedRoleId: "imp" };
    privateMessage(
      r,
      c.seatId,
      passedThisNight
        ? "说书人确认：你现在是小恶魔。本夜因自杀传位，不再行动；下个夜晚开始击杀。"
        : "说书人确认：你现在是小恶魔。请按本夜待办行动。",
    );
    // Preserve completed history; obsolete entries cannot be restored or started.
    for (const i of r.nightPlan.filter(
      (i) => i.night === r.day && i.seatId === c.seatId && i.roleId !== "imp",
    )) {
      const action = r.actions.find((a) => a.id === i.actionId);
      if (
        i.status === "planned" ||
        (i.status === "started" && action && !completedAction(action))
      )
        i.status = "skipped";
      i.retiredReason = "已继任小恶魔，原身份清单仅保留历史，不再发起";
    }
    // Existing pending requests for the old character cannot survive the change.
    for (const a of r.actions.filter(
      (a) => a.seatId === c.seatId && a.night === r.day && !completedAction(a),
    )) {
      a.status = "CANCELLED";
      a.resolutionReason = "继任小恶魔，原身份行动取消";
      delete a.response;
    }
    if (source.scarletEligible)
      for (const i of r.nightPlan.filter(
        (i) =>
          i.night === r.day &&
          !i.seatId &&
          i.roleId === "scarletwoman" &&
          i.status === "planned",
      )) {
        i.status = "offline";
        i.retiredReason = "猩红女郎继任已确认";
      }
    if (
      r.phase === "OTHER_NIGHT" &&
      !passedThisNight &&
      r.nightPlan.some((i) => i.night === r.day)
    ) {
      const t = nightTemplate("imp");
      const item = {
        id: randomUUID(),
        night: r.day,
        seatId: c.seatId,
        roleId: "imp",
        ...t,
        note: "继任后补入小恶魔行动；开始后才通知选择。",
        status: "planned" as const,
      };
      const at = r.nightPlan.findIndex(
        (i) =>
          i.night === r.day &&
          OTHER_NIGHT_ORDER.indexOf(i.roleId) >
            OTHER_NIGHT_ORDER.indexOf("imp"),
      );
      if (at < 0) r.nightPlan.push(item);
      else r.nightPlan.splice(at, 0, item);
    }
    r.planVersion++;
    r.dismissedNotices.push(notice!.id);
  } else if (c.type === "apply_action") {
    const a = r.actions.find((a) => a.id === c.actionId);
    check(
      a &&
        a.night === r.day &&
        ["FIRST_NIGHT", "OTHER_NIGHT"].includes(r.phase) &&
        ["SUBMITTED", "ST_REVIEW", "APPROVED"].includes(a.status),
      "待办已完成或不是当前夜晚",
    );
    check(
      (a!.selectionVersion ?? 0) === c.expectedVersion,
      "玩家已修改选择，请重新核对",
    );
    const role = r.assignments[a!.seatId]?.actualRoleId;
    const expected = {
      poison: "poison",
      protect: "protect",
      kill: "kill",
    } as const;
    if (c.effect !== "none") {
      check(
        a!.targets.length === 1 && a!.choiceKind === expected[c.effect],
        "行动类型或目标数量不匹配",
      );
      const target = r.seats.find((s) => s.id === a!.targets[0])!;
      const ref = informationReference(r, a!);
      const targetRole = r.assignments[target.id]?.actualRoleId;
      const targetHealthy =
        !r.conditions[target.id]?.poisoned && !r.conditions[target.id]?.drunk;
      const actorAlive = r.seats.find((s) => s.id === a!.seatId)?.alive;
      const expectedRole = { poison: "poisoner", protect: "monk", kill: "imp" }[
        c.effect
      ];
      const unusual =
        ref.impaired ||
        !actorAlive ||
        role !== expectedRole ||
        (c.effect === "protect" && (target.id === a!.seatId || r.day === 1)) ||
        (c.effect === "kill" &&
          (r.day === 1 ||
            r.conditions[target.id]?.protected ||
            (["soldier", "mayor"].includes(targetRole) && targetHealthy)));
      check(
        !unusual || c.force,
        "存在中毒、醉酒、保护或特殊角色条件，请核对后明确覆盖，或仅确认收到",
      );
      if (c.effect === "kill")
        setLife(
          r,
          target.id,
          false,
          true,
          target.id === a!.seatId && role === "imp" && !ref.impaired,
        );
      else {
        const condition = c.effect === "poison" ? "poisoned" : "protected";
        (r.conditions[target.id] ??= emptyConditions())[condition] = true;
        r.staleConditions = r.staleConditions.filter(
          (x) => x.seatId !== target.id || x.condition !== condition,
        );
      }
    }
    a!.reference = informationReference(r, a!);
    a!.response = c.response;
    a!.status = "DELIVERED";
    a!.responseVersion = 1;
    a!.responseHistory = [
      { version: 1, response: c.response, sentAt: new Date().toISOString() },
    ];
  }
  r.contextVersion++;
  return c.type === "apply_action"
    ? "确认行动并记录说书人裁定效果"
    : c.type === "send_evil_info"
      ? "已私密发放首夜邪恶信息与假身份"
      : c.type === "promote_imp"
        ? "说书人确认恶魔继任"
        : c.type === "clear_expired_conditions"
          ? "已清除到期中毒/保护标记"
          : "更新说书人辅助状态";
}
