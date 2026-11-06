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
  const who = (seatId: string) => {
    const assignment = before.assignments[seatId];
    const actual = assignment?.actualRoleId ?? "";
    const perceived = assignment?.perceivedRoleId ?? "";
    const believed = perceived && perceived !== actual ? `（以为自己是${roleName(perceived)}）` : "";
    const condition = before.conditions[seatId];
    const state = condition?.poisoned ? "（中毒）" : condition?.drunk ? "（醉酒）" : "";
    return `${number(seatId)}${roleName(actual)}${believed}${state}`;
  };
  for (const a of r.actions) {
    const old = before.actions.find((old) => old.id === a.id);
    if (a.status !== "DELIVERED" || old?.status === "DELIVERED") continue;
    const perceived = before.assignments[a.seatId]?.perceivedRoleId ?? "";
    const actor = who(a.seatId);
    const targets = a.targets.map(number).join("、");
    const applied = c.type === "apply_action" && c.actionId === a.id ? c : undefined;
    const ruled = applied?.force ? "（说书人裁定）" : "";
    const includeResponse = infoRoles.has(a.referenceRoleId ?? perceived);
    let text: string;
    if (includeResponse) text = `${actor}${targets ? `查验 ${targets}，` : ""}`;
    else if (a.choiceKind === "poison")
      text = applied?.effect === "poison" ? `${actor}毒了 ${targets}${ruled}。` : `${actor}想毒 ${targets}，没有生效。`;
    else if (a.choiceKind === "protect")
      text = applied?.effect === "protect" ? `${actor}保护了 ${targets}${ruled}。` : `${actor}想保护 ${targets}，没有生效。`;
    else if (a.choiceKind === "kill") {
      const target = a.targets[0];
      const targetRole = before.assignments[target]?.actualRoleId;
      const why = before.conditions[target]?.protected
        ? "被保护"
        : targetRole === "soldier"
          ? "是士兵"
          : targetRole === "mayor"
            ? "是镇长"
            : "";
      text =
        target === a.seatId
          ? `${actor}选择了自己${applied?.effect === "kill" ? "，自杀身亡" : ""}${ruled}。`
          : applied?.effect === "kill"
            ? `${actor}杀死了 ${targets}${ruled}。`
            : `${actor}袭击 ${targets}，${targets}${why ? `${why}，` : ""}没有死亡。`;
    } else if (a.choiceKind === "master") text = `${actor}选择 ${targets}作为主人。`;
    else if ((a.referenceRoleId ?? perceived) === "spy") text = `${actor}查看了魔典。`;
    else text = `${actor}${targets ? `选择了 ${targets}` : "行动了"}。`;
    log.push({
      day: a.night,
      period: "NIGHT",
      id: `action:${a.id}`,
      kind: "action",
      text,
      actionId: a.id,
      includeResponse,
      truth: includeResponse ? a.reference?.truth : undefined,
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
        c.type === "promote_imp"
          ? `${number(seat.id)}${roleName(prev.actualRoleId)}继任成为${roleName(next.actualRoleId)}。`
          : `${number(seat.id)}由${roleName(prev.actualRoleId)}变为${roleName(next.actualRoleId)}${next.actualRoleId !== next.perceivedRoleId ? `（以为自己是${roleName(next.perceivedRoleId)}）` : ""}（说书人调整）。`,
      );
    if (
      old &&
      old.alive !== seat.alive &&
      c.type !== "execute_player" &&
      c.type !== "correct_execution" &&
      c.type !== "slayer_shot" &&
      !(c.type === "apply_action" && c.effect === "kill")
    )
      add(
        "life",
        `${number(seat.id)}${seat.alive ? "被登记为存活" : "死亡"}（${c.type === "set_alive" && c.reason ? c.reason : "说书人登记"}）。`,
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
        `${number(seat.id)}被说书人${now ? "标记" : "解除"}${{ poisoned: "中毒", protected: "保护", drunk: "醉酒" }[condition]}。`,
      );
    }
  }
  if (c.type === "slayer_shot")
    add(
      "action",
      `${who(c.shooter)}向 ${number(c.target)}${roleName(before.assignments[c.target]?.actualRoleId ?? "")}开枪，${c.kill ? `${number(c.target)}死亡` : "没有发生任何事"}。`,
    );
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

export function buildRecap(r: Room): GameRecap {
  const entries: RecapEntry[] = (r.recapLog ?? []).map(
    ({ actionId, includeResponse, truth, ...entry }) => {
      const action = actionId
        ? r.actions.find((a) => a.id === actionId)
        : undefined;
      if (!includeResponse) return entry;
      const response = action?.status === "DELIVERED" ? (action.response ?? "") : "";
      return {
        ...entry,
        text:
          `${entry.text}得知「${response}」` +
          ((action?.responseVersion ?? 1) > 1 ? "（已更正）" : "") +
          (truth && truth !== response ? `，真实应为「${truth}」` : "") +
          "。",
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
      text: `${r.seats.find((s) => s.id === execution.seatId)?.number ?? "?"} 号${roleName(execution.actualRoleId)}${
        execution.voided
          ? "的处决记录已撤销"
          : execution.nominee
            ? `提名 ${r.seats.find((s) => s.id === execution.nominee)?.number ?? "?"} 号${roleName(r.assignments[execution.nominee]?.actualRoleId ?? "")}后立即被处决${execution.died ? "" : "，但没有死亡"}`
            : `被处决${execution.reason ? `（${execution.reason}）` : ""}${execution.died ? "" : "，但没有死亡"}`
      }。`,
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
    "只包含登记过的行动和裁定。",
  ];
  if (!r.initialAssignments)
    limitations.push(
      "本局缺少开局身份记录，身份变化可能不完整。",
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
      .map(({ hidden: _old, ...e }: RecapEntry & { hidden?: boolean }) => e)
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
    ? buildRecap(r).entries.find((e) => e.id === c.entryId)
    : undefined;
  if (c.entryId && !existing) throw new Error("复盘条目不存在");
  const edit: RecapEntry = {
    id: c.entryId ?? `manual:${randomUUID()}`,
    day: c.day,
    period: c.period,
    kind: existing?.kind ?? "manual",
    text: c.text,
  };
  r.recapEdits = [
    ...(r.recapEdits ?? []).filter((e) => e.id !== edit.id),
    edit,
  ];
  r.recapVersion = (r.recapVersion ?? 0) + 1;
  if (r.recap) r.recap = buildRecap(r);
}
