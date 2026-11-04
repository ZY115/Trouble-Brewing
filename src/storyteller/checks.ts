import type { NightAction, RoomView } from "../../shared/types";
import { roleName } from "../../shared/roles";
import type { CheckItem } from "./TaskCard";

const num = (room: RoomView, id?: string) => room.seats.find((s) => s.id === id)?.number;

export function impaired(room: RoomView, seatId: string) {
  const st = room.storyteller!;
  return (
    !!st.conditions[seatId]?.poisoned ||
    !!st.conditions[seatId]?.drunk ||
    st.assignments[seatId]?.actualRoleId === "drunk"
  );
}

/** The conditions the server checks before a one-tap effect, stated up front. */
export function effectChecks(room: RoomView, a: NightAction): CheckItem[] {
  const st = room.storyteller!;
  const items: CheckItem[] = [];
  const target = a.targets[0];
  if (a.choiceKind === "kill" && target) {
    const role = st.assignments[target]?.actualRoleId;
    items.push(
      st.conditions[target]?.protected
        ? { ok: false, text: `${num(room, target)} 号受保护` }
        : { ok: true, text: `${num(room, target)} 号未受保护` },
      ["soldier", "mayor"].includes(role) && !impaired(room, target)
        ? { ok: false, text: `${num(room, target)} 号是${roleName(role)}，能力会生效` }
        : { ok: true, text: `${num(room, target)} 号不是健康的士兵或镇长` },
    );
    if (room.day === 1) items.push({ ok: false, text: "首夜小恶魔通常不行动" });
  }
  if (a.choiceKind === "protect" && target === a.seatId)
    items.push({ ok: false, text: "僧侣不能保护自己" });
  if (a.choiceKind === "protect" && room.day === 1)
    items.push({ ok: false, text: "首夜僧侣通常不行动" });
  items.push(...actorChecks(room, a));
  return items;
}

/** Whether the acting player's own ability works tonight. */
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
