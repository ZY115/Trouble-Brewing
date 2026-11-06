import type { NightAction, RoomView } from "../../shared/types";
import type { CheckItem } from "./TaskCard";
import { roleName } from "../../shared/roles";

const num = (room: RoomView, id?: string) => room.seats.find((s) => s.id === id)?.number;

export function impaired(room: RoomView, seatId: string) {
  const st = room.storyteller!;
  return (
    !!st.conditions[seatId]?.poisoned ||
    !!st.conditions[seatId]?.drunk ||
    st.assignments[seatId]?.actualRoleId === "drunk"
  );
}

const EXPECTED: Record<string, string> = { poison: "poisoner", protect: "monk", kill: "imp" };

export function effectChecks(room: RoomView, a: NightAction): CheckItem[] {
  const st = room.storyteller!;
  const items: CheckItem[] = [];
  const target = a.targets[0];
  const n = num(room, target);
  if (a.choiceKind === "kill" && target) {
    const role = st.assignments[target]?.actualRoleId;
    if (st.conditions[target]?.protected)
      items.push({ ok: false, text: target === a.seatId ? `${n} 号受保护：自杀不会成功` : `${n} 号受保护` });
    else if (target === a.seatId)
      items.push({ ok: true, text: `小恶魔选择了自己：${n} 号死亡后，由一名爪牙成为小恶魔` });
    else if (role === "soldier" && !impaired(room, target)) items.push({ ok: false, text: `${n} 号是士兵：不会死亡` });
    else if (role === "mayor" && !impaired(room, target)) items.push({ ok: true, text: `${n} 号是镇长：可以让别人替他死` });
    else items.push({ ok: true, text: `${n} 号没有受保护` });
    if (room.day === 1) items.push({ ok: false, text: "首夜小恶魔不行动" });
  }
  if (a.choiceKind === "protect" && target === a.seatId) items.push({ ok: false, text: "僧侣不能保护自己" });
  if (a.choiceKind === "protect" && room.day === 1) items.push({ ok: false, text: "首夜僧侣不行动" });
  const expected = EXPECTED[a.choiceKind ?? ""];
  const role = st.assignments[a.seatId]?.actualRoleId;
  if (expected && role !== expected && role !== "drunk")
    items.push({ ok: false, text: `${num(room, a.seatId)} 号现在是${roleName(role)}，没有这个能力` });
  items.push(...actorChecks(room, a));
  return items;
}

export function actorChecks(room: RoomView, a: NightAction): CheckItem[] {
  const st = room.storyteller!;
  const items: CheckItem[] = [];
  const role = st.assignments[a.seatId]?.actualRoleId;
  if (role === "drunk")
    items.push({ ok: false, text: `${num(room, a.seatId)} 号其实是酒鬼，能力无效` });
  else if (impaired(room, a.seatId))
    items.push({ ok: false, text: `${num(room, a.seatId)} 号中毒或醉酒，能力无效` });
  else items.push({ ok: true, text: `${num(room, a.seatId)} 号状态正常` });
  const dead = !room.seats.find((s) => s.id === a.seatId)?.alive;
  if (dead && a.referenceRoleId !== "ravenkeeper")
    items.push({ ok: false, text: `${num(room, a.seatId)} 号已死亡` });
  return items;
}
