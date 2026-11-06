import type { NightAction, RoomView } from "../../shared/types";

export const isNight = (room: RoomView) =>
  room.phase === "FIRST_NIGHT" || room.phase === "OTHER_NIGHT";

export function revealedActions(room: RoomView): NightAction[] {
  return room.actions.filter((a) => a.status === "DELIVERED");
}

export function visibleRoom(room: RoomView): RoomView {
  return room;
}

export function nightMessages(room: RoomView) {
  const me = room.viewer.seatId;
  const nights = room.publicRecords.filter((r) => r.type === "phase");
  return visibleRoom(room)
    .messages.filter((m) => m.from === "storyteller" && m.to === me)
    .map((m) => {
      const t = Date.parse(m.createdAt);
      const before = [...nights]
        .reverse()
        .find((r) => Date.parse(r.createdAt) <= t);
      return {
        id: m.id,
        createdAt: m.createdAt,
        night: before ? before.day : 1,
        atNight: !before || before.period === "NIGHT",
        text: m.content,
      };
    });
}
