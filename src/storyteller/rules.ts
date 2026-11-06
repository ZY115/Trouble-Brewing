import type { RoomView } from "../../shared/types";
import { roleById, roleName } from "../../shared/roles";

const number = (room: RoomView, id?: string) => room.seats.find((s) => s.id === id)?.number;
const actual = (room: RoomView, id?: string) => room.storyteller!.assignments[id ?? ""]?.actualRoleId ?? "";
const healthy = (room: RoomView, id: string) => {
  const c = room.storyteller!.conditions[id];
  return !c?.poisoned && !c?.drunk;
};

export function nominations(room: RoomView) {
  return room.publicRecords.filter(
    (r) => !!r.nominee && r.type !== "phase" && !room.publicRecords.some((n) => n.supersedes === r.id),
  );
}

export function virginCheck(room: RoomView, nominator: string, nominee: string) {
  if (actual(room, nominee) !== "virgin" || !room.seats.find((s) => s.id === nominee)?.alive) return null;
  const st = room.storyteller!;
  const nominatedBefore =
    nominations(room).some((r) => r.nominee === nominee) || st.executions.some((e) => e.nominee === nominee);
  if (nominatedBefore) return null;
  const by = actual(room, nominator);
  const n = number(room, nominee);
  const m = number(room, nominator);
  if (!healthy(room, nominee))
    return { trigger: false, text: `${n} 号贞洁者中毒或醉酒：不触发，能力就此用掉` };
  if (roleById(by)?.team === "townsfolk")
    return { trigger: true, text: `${n} 号是贞洁者、第一次被提名，${m} 号是镇民：${m} 号立即被处决` };
  if (by === "spy")
    return { trigger: false, optional: true, text: `${m} 号是间谍，可以被当作镇民：由你决定是否触发贞洁者` };
  return { trigger: false, text: `${n} 号是贞洁者，但 ${m} 号不是镇民：不触发，能力就此用掉` };
}

function butlerMaster(room: RoomView, butler: string) {
  return room.actions
    .filter((a) => a.seatId === butler && a.choiceKind === "master" && a.status === "DELIVERED" && a.targets[0])
    .sort((a, b) => b.night - a.night)[0]?.targets[0];
}

export function butlerWarning(room: RoomView, seatId: string, votes: (id: string) => boolean) {
  const alive = room.seats.find((s) => s.id === seatId)?.alive;
  if (!alive || actual(room, seatId) !== "butler" || !healthy(room, seatId) || !votes(seatId)) return "";
  const master = butlerMaster(room, seatId);
  if (!master || votes(master)) return "";
  return `${number(room, seatId)} 号是管家，主人 ${number(room, master)} 号没投票。这一票照常计入，私下提醒他即可`;
}

export function slayerStatus(room: RoomView) {
  const st = room.storyteller!;
  const real = room.seats.find((s) => st.assignments[s.id]?.actualRoleId === "slayer");
  const believers = room.seats.filter(
    (s) => st.assignments[s.id]?.perceivedRoleId === "slayer" && st.assignments[s.id]?.actualRoleId !== "slayer",
  );
  const fake = believers.map((s) => `${s.number} 号是${roleName(st.assignments[s.id]!.actualRoleId)}，以为自己是猎手`);
  const claimed = room.seats.filter((s) => st.claims[s.id] === "slayer" && st.assignments[s.id]?.actualRoleId !== "slayer");
  if (claimed.length) fake.push(`${claimed.map((s) => `${s.number} 号`).join("、")}自称猎手`);
  if (!real) return ["场上没有猎手：无论谁开枪都不会有效果", ...fake];
  const shot = room.publicRecords.some((r) => r.shooter === real.id);
  return [
    `真正的猎手是 ${real.number} 号${!real.alive ? "（已死亡）" : shot ? "（已经开过枪）" : ""}`,
    ...fake,
  ];
}

export function slayerOutcome(room: RoomView, slayer: string, target: string) {
  const sn = number(room, slayer);
  const n = number(room, target);
  const role = actual(room, slayer);
  const believed = room.storyteller!.assignments[slayer]?.perceivedRoleId === "slayer";
  const none = (text: string) => ({ kill: false, decide: false, text });
  if (role !== "slayer")
    return none(
      believed
        ? `${sn} 号其实是${roleName(role)}（以为自己是猎手）：开枪无效`
        : `${sn} 号不是猎手（是${roleName(role)}）：开枪无效`,
    );
  if (room.publicRecords.some((r) => r.shooter === slayer)) return none(`${sn} 号猎手已经开过枪：能力已用完`);
  if (!healthy(room, slayer)) return none(`${sn} 号猎手中毒或醉酒：开枪无效，能力就此用掉`);
  const targetRole = actual(room, target);
  if (roleById(targetRole)?.team === "demon")
    return { kill: true, decide: false, text: `${sn} 号是真猎手，${n} 号是恶魔：${n} 号死亡` };
  if (targetRole === "recluse") return { kill: false, decide: true, text: `${n} 号是隐士，可以被当作恶魔：由你决定` };
  return none(`${sn} 号是真猎手，但 ${n} 号不是恶魔：没有发生任何事`);
}

export function saintWarning(room: RoomView, seatId: string) {
  return actual(room, seatId) === "saint" && healthy(room, seatId)
    ? `${number(room, seatId)} 号是圣徒：处决后邪恶阵营获胜`
    : "";
}
