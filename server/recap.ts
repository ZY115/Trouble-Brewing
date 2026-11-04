import { randomUUID } from "node:crypto";
import type { Command } from "../shared/commands";
import type { GameRecap, RecapEntry } from "../shared/endgame";
import { roleName } from "../shared/roles";
import { effectiveExecutions } from "./life";
import type { Room } from "./game";

export const recapSnapshot = (r: Room) =>
  structuredClone({
    phase: r.phase,
    day: r.day,
    assignments: r.assignments,
    conditions: r.conditions,
    seats: r.seats,
    actions: r.actions,
  });
type Snapshot = ReturnType<typeof recapSnapshot>;
const infoRoles = new Set([
  "washerwoman",
  "librarian",
  "investigator",
  "chef",
  "empath",
  "fortuneteller",
  "undertaker",
  "ravenkeeper",
]);

/** Record actual mutations, not guessed effects from player selections or replies. */
export function captureRecap(r: Room, before: Snapshot, c: Command) {
  if (
    !["DAY", "FIRST_NIGHT", "OTHER_NIGHT"].includes(before.phase) ||
    ["finish_game", "end", "edit_recap", "new_round"].includes(c.type)
  )
    return;
  const log = (r.recapLog ??= []);
  const priorLength = log.length;
  const period = before.phase === "DAY" ? ("DAY" as const) : ("NIGHT" as const);
  const add = (
    kind: RecapEntry["kind"],
    text: string,
    id: string = randomUUID(),
  ) => {
    const entry = { id, day: before.day, period, kind, text };
    log.push(entry);
    return entry;
  };
  const number = (id: string) =>
    `${before.seats.find((s) => s.id === id)?.number ?? "?"} 号`;
  for (const a of r.actions) {
    const old = before.actions.find((old) => old.id === a.id);
    if (a.status !== "DELIVERED" || old?.status === "DELIVERED") continue;
    const assignment = before.assignments[a.seatId];
    const actor = `${number(a.seatId)}（${roleName(assignment?.actualRoleId ?? "")}）`;
    const targets = a.targets.map(number).join("、");
    const impaired =
      before.conditions[a.seatId]?.poisoned ||
      before.conditions[a.seatId]?.drunk ||
      assignment?.actualRoleId === "drunk";
    const label = (
      {
        inspect: "查验",
        poison: "选择下毒",
        protect: "选择保护",
        kill: "选择击杀",
        master: "选择主人",
        select: "选择",
      } as Record<string, string>
    )[a.choiceKind ?? "select"];
    let text = `${actor}${targets ? `${label} ${targets}` : "获得夜间信息"}。`;
    if (
      c.type === "apply_action" &&
      c.actionId === a.id &&
      c.effect !== "none"
    ) {
      const effect = {
        poison: "标记中毒",
        protect: "标记保护",
        kill: "登记死亡",
      }[c.effect];
      text += `说书人已为 ${targets}${effect}${c.force ? "（手动覆盖裁定）" : ""}。`;
    } else if (["poison", "protect", "kill"].includes(a.choiceKind ?? ""))
      text += "此行动仅确认收到，未在行动上登记实际效果。";
    if (impaired) text += "行动时存在中毒或醉酒，能力/信息需按说书人裁定。";
    const includeResponse = infoRoles.has(
      a.referenceRoleId ?? assignment?.perceivedRoleId ?? "",
    );
    if (includeResponse && a.reference?.actual)
      text += `当时实际参考：${a.reference.actual}`;
    log.push({
      day: a.night,
      period: "NIGHT",
      id: `action:${a.id}`,
      kind: "action",
      text,
      actionId: a.id,
      includeResponse,
    });
  }
  for (const seat of r.seats) {
    const old = before.seats.find((s) => s.id === seat.id);
    const prev = before.assignments[seat.id],
      next = r.assignments[seat.id];
    if (
      prev &&
      next &&
      (prev.actualRoleId !== next.actualRoleId ||
        prev.perceivedRoleId !== next.perceivedRoleId)
    )
      add(
        "role",
        `${number(seat.id)} 从 ${roleName(prev.actualRoleId)} 变为 ${roleName(next.actualRoleId)}${next.actualRoleId !== next.perceivedRoleId ? `，认知身份为 ${roleName(next.perceivedRoleId)}` : ""}${c.type === "promote_imp" ? "（恶魔继任）" : "（说书人调整）"}。`,
      );
    if (
      old &&
      old.alive !== seat.alive &&
      c.type !== "execute_player" &&
      c.type !== "correct_execution" &&
      !(c.type === "apply_action" && c.effect === "kill")
    )
      add(
        "life",
        `${number(seat.id)} 被说书人登记为${seat.alive ? "存活" : "死亡"}；具体原因以说书人说明为准。`,
      );
    for (const condition of ["poisoned", "protected", "drunk"] as const) {
      const was = !!before.conditions[seat.id]?.[condition],
        now = !!r.conditions[seat.id]?.[condition];
      if (
        was === now ||
        c.type === "clear_expired_conditions" ||
        (c.type === "apply_action" &&
          ((c.effect === "poison" && condition === "poisoned") ||
            (c.effect === "protect" && condition === "protected")))
      )
        continue;
      add(
        "condition",
        `说书人${now ? "标记" : "解除"} ${number(seat.id)} 的${{ poisoned: "中毒", protected: "保护", drunk: "醉酒" }[condition]}状态。`,
      );
    }
  }
  if (c.type === "execute_player") {
    const execution = r.executions.at(-1)!;
    add("execution", "", `execution:${execution.id}`);
  }
  if (c.type === "correct_phase") r.dayEndVictory = undefined;
  if (
    log.length !== priorLength ||
    [
      "correct_action_response",
      "correct_execution",
      "set_red_herring",
      "correct_phase",
    ].includes(c.type)
  )
    r.recapVersion = (r.recapVersion ?? 0) + 1;
}

export function buildRecap(r: Room, includeHidden = false): GameRecap {
  const entries: RecapEntry[] = (r.recapLog ?? []).map(
    ({ actionId, includeResponse, ...entry }) => {
      const action = actionId
        ? r.actions.find((a) => a.id === actionId)
        : undefined;
      return {
        ...entry,
        text:
          entry.text +
          (includeResponse && action?.status === "DELIVERED"
            ? `；最终告知玩家：${action.response ?? ""}${(action.responseVersion ?? 1) > 1 ? "（已更正）" : ""}`
            : ""),
      };
    },
  );
  for (const execution of effectiveExecutions(r)) {
    let original = execution;
    while (original.supersedes) {
      const parent = r.executions.find((e) => e.id === original.supersedes);
      if (!parent) break;
      original = parent;
    }
    const id = `execution:${original.id}`;
    const entry: RecapEntry = {
      id,
      day: execution.day,
      period: "DAY",
      kind: "execution",
      text: `${r.seats.find((s) => s.id === execution.seatId)?.number ?? "?"} 号（${roleName(execution.actualRoleId)}）${execution.voided ? "的处决记录已撤销" : execution.died ? "被处决并死亡" : "被处决，但未因此死亡"}。`,
    };
    const index = entries.findIndex((e) => e.id === id);
    if (index < 0) entries.push(entry);
    else entries[index] = entry;
  }
  for (const edit of r.recapEdits ?? []) {
    const index = entries.findIndex((e) => e.id === edit.id);
    if (index < 0) entries.push(edit);
    else entries[index] = edit;
  }
  const limitations = [
    "只汇总已登记的关键行动和裁定；未记录的线下行动不会自动推断。私聊、私人笔记和全部投票明细不列入复盘。",
  ];
  if (!r.initialAssignments)
    limitations.push(
      "本局缺少开局身份快照，不能完整还原旧版本的身份变化和历史行动；以下为已记录内容。 ",
    );
  return {
    gameNo: r.gameNo,
    version: r.recapVersion ?? 0,
    result: r.result,
    seats: [...r.seats]
      .sort((a, b) => a.number - b.number)
      .map((s) => ({
        seatId: s.id,
        number: s.number,
        initial: r.initialAssignments?.[s.id],
        final: r.assignments[s.id],
        alive: s.alive,
      })),
    redHerring: r.redHerring,
    entries: entries
      .filter((e) => includeHidden || !e.hidden)
      .sort(
        (a, b) =>
          a.day - b.day ||
          (a.period === "NIGHT" ? 0 : 1) - (b.period === "NIGHT" ? 0 : 1),
      ),
    limitations,
  };
}

export function editRecap(
  r: Room,
  c: Extract<Command, { type: "edit_recap" }>,
) {
  if (!["DAY", "FIRST_NIGHT", "OTHER_NIGHT", "ENDED"].includes(r.phase))
    throw new Error("请先开始游戏");
  if (c.expectedVersion !== (r.recapVersion ?? 0))
    throw new Error("复盘已有新版本，请重新载入后修改");
  if (c.day > r.day) throw new Error("不能记录尚未到来的日期");
  const existing = c.entryId
    ? buildRecap(r, true).entries.find((e) => e.id === c.entryId)
    : undefined;
  if (c.entryId && !existing) throw new Error("复盘条目不存在");
  const edit: RecapEntry = {
    id: c.entryId ?? `manual:${randomUUID()}`,
    day: c.day,
    period: c.period,
    kind: existing?.kind ?? "manual",
    text: c.text,
    hidden: c.hidden,
  };
  r.recapEdits = [
    ...(r.recapEdits ?? []).filter((e) => e.id !== edit.id),
    edit,
  ];
  r.recapVersion = (r.recapVersion ?? 0) + 1;
  if (r.recap) r.recap = buildRecap(r);
}
