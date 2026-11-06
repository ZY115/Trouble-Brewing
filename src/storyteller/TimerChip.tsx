import { useEffect, useState } from "react";
import type { RoomView } from "../../shared/types";

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export default function TimerChip({ room, onOpen }: { room: RoomView; onOpen: () => void }) {
  const timer = room.storyteller?.dayTimer;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!timer || timer.endsAt === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [timer?.endsAt]);
  if (room.phase !== "DAY" || !timer) return null;
  const left = Math.max(0, Math.ceil((timer.endsAt === null ? timer.remainingMs : timer.endsAt - now) / 1000));
  return (
    <button className={`top-chip timer${left === 0 ? " expired" : ""}`} title="打开白天计时" aria-haspopup="dialog" onClick={onOpen}>
      {left === 0 ? "讨论时间到" : timer.endsAt === null ? `已暂停 ${clock(left)}` : `剩 ${clock(left)}`}
    </button>
  );
}
