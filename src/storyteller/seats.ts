import type { RoomView } from "../../shared/types";
import { roleName } from "../../shared/roles";
import {
  roleGlyph,
  roleTone,
  type GrimoireSeat,
  type MarkKind,
  type SeatRing,
} from "../ui/Grimoire";

export interface SeatOverlay {
  rings?: Record<string, SeatRing[]>;
  marks?: Record<string, { text: string; kind: MarkKind }[]>;
  badges?: Record<string, string>;
}

export function storytellerSeats(
  room: RoomView,
  overlay: SeatOverlay = {},
): GrimoireSeat[] {
  const st = room.storyteller!;
  return room.seats.map((s) => {
    const a = st.assignments[s.id];
    const c = st.conditions[s.id];
    const marks: { text: string; kind: MarkKind }[] = [];
    if (c?.poisoned) marks.push({ text: "毒", kind: "poison" });
    if (c?.protected) marks.push({ text: "护", kind: "protect" });
    if (c?.drunk) marks.push({ text: "醉", kind: "drunk" });
    if (st.redHerring === s.id) marks.push({ text: "误", kind: "herring" });
    if (st.claims[s.id]) marks.push({ text: `称${roleGlyph(st.claims[s.id])}`, kind: "tag" });
    if (s.alive !== st.publishedAlive[s.id])
      marks.push({ text: s.alive ? "待公布" : "未公布", kind: "dead" });
    marks.push(...(overlay.marks?.[s.id] ?? []));
    const role = a?.actualRoleId;
    const label = role
      ? `${roleName(role)}${!s.alive && s.deadVoteAvailable ? " · 票" : ""}`
      : `${s.number} 号`;
    return {
      key: s.id,
      number: s.number,
      glyph: roleGlyph(role) || String(s.number),
      label,
      tone: role ? roleTone(role) : "neutral",
      dead: !s.alive,
      rings: overlay.rings?.[s.id],
      marks,
      badge: overlay.badges?.[s.id],
      ariaLabel: `${s.number} 号${role ? ` ${roleName(role)}` : ""}，${s.alive ? "存活" : "死亡"}${marks.length ? `，${marks.map((m) => m.text).join("、")}` : ""}`,
    };
  });
}
