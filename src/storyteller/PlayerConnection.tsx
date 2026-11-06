import type { RoomView } from "../../shared/types";

export type Away = "" | "offline" | "background";
export const AWAY_SHORT = { offline: "离线", background: "后台" } as const;

export function away(room: RoomView, seatId: string): Away {
  const presence = room.storyteller?.presence?.[seatId];
  return presence && presence.connection !== "foreground" ? presence.connection : "";
}

export default function PlayerConnection({ room, seatId, brief = false }: { room: RoomView; seatId: string; brief?: boolean }) {
  const state = away(room, seatId);
  if (!state) return null;
  return (
    <p className={`conn-note ${state}`} role="status">
      {state === "offline" ? "手机离线" : "页面在后台"}
      {brief ? "" : " · 可以当面提醒，或线下处理"}
    </p>
  );
}
