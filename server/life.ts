import { roleById } from "../shared/roles";
import { randomUUID } from "node:crypto";
import type { Room } from "./game";
import type { ExecutionRecord } from "../shared/types";
import { publicRecord } from "./public-records";

export function publishLife(r: Room, ids = r.seats.map((s) => s.id)) {
  for (const seat of r.seats.filter((s) => ids.includes(s.id))) {
    if (r.publishedAlive[seat.id] === seat.alive) continue;
    r.publishedAlive[seat.id] = seat.alive;
    publicRecord(r, {
      type: "status",
      text: `说书人公布 ${seat.number} 号${seat.alive ? "存活" : "死亡"}`,
    });
  }
}

export function effectiveExecutions(r: Room) {
  return r.executions.filter(
    (e) => !r.executions.some((next) => next.supersedes === e.id),
  );
}

export function reviseExecution(
  r: Room,
  original: ExecutionRecord,
  changes: { died: boolean; voided: boolean; reason: string },
) {
  const next = {
    ...original,
    ...changes,
    id: randomUUID(),
    supersedes: original.id,
  };
  const number = r.seats.find((s) => s.id === original.seatId)!.number;
  publicRecord(r, {
    type: "execution",
    supersedes: original.publicRecordId,
    text: `更正第 ${original.day} 天 ${number} 号的处决：${changes.voided ? "已撤销" : changes.died ? "因处决死亡" : "处决未导致死亡"}。${changes.reason}`,
  });
  next.publicRecordId = r.publicRecords.at(-1)!.id;
  r.executions.push(next);
  return next;
}

export function setLife(
  r: Room,
  seatId: string,
  alive: boolean,
  correctExecution = true,
  selfKill = false,
) {
  const seat = r.seats.find((s) => s.id === seatId)!;
  if (seat.alive === alive) return;
  if (!alive) {
    const aliveBefore = r.seats.filter((s) => s.alive).length;
    const impaired = !!(
      r.conditions[seatId]?.poisoned ||
      r.conditions[seatId]?.drunk ||
      r.assignments[seatId]?.actualRoleId === "drunk"
    );
    const scarlet = r.seats.filter(
      (s) =>
        s.alive &&
        r.assignments[s.id]?.actualRoleId === "scarletwoman" &&
        !r.conditions[s.id]?.poisoned &&
        !r.conditions[s.id]?.drunk,
    );
    const scarletEligible = aliveBefore >= 5 && scarlet.length > 0;
    const candidates = scarletEligible
      ? scarlet
      : selfKill && !impaired
        ? r.seats.filter(
            (s) =>
              s.alive &&
              roleById(r.assignments[s.id]?.actualRoleId)?.team === "minion",
          )
        : [];
    r.deathEvents.push({
      id: randomUUID(),
      seatId,
      roleId: r.assignments[seatId]?.actualRoleId ?? "",
      day: r.day,
      phase: r.phase,
      aliveBefore,
      selfKill,
      impaired,
      candidates: candidates.map((s) => s.id),
      scarletEligible,
      minionsAtDeath: r.seats
        .filter(
          (s) =>
            s.alive &&
            roleById(r.assignments[s.id]?.actualRoleId)?.team === "minion",
        )
        .map((s) => s.id),
    });
  }
  seat.alive = alive;
  if (alive && correctExecution) {
    for (const execution of effectiveExecutions(r).filter(
      (e) => e.seatId === seatId && e.died && !e.voided,
    ))
      reviseExecution(r, execution, {
        died: false,
        voided: true,
        reason: "说书人更正生死，撤销原处决死亡登记",
      });
  }
  if (r.phase === "DAY") publishLife(r, [seatId]);
}
