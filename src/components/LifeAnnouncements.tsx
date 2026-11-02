import { useState } from "react";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";

export default function LifeAnnouncements({
  room,
  send,
}: {
  room: RoomView;
  send: Send;
}) {
  const [busy, setBusy] = useState(false);
  const st = room.storyteller!;
  const pending = room.seats.filter((s) => s.alive !== st.publishedAlive[s.id]);
  if (!["FIRST_NIGHT", "OTHER_NIGHT", "DAY"].includes(room.phase)) return null;
  if (!pending.length) return null;
  const publish = async (ids: string[]) => {
    setBusy(true);
    await send({
      type: "publish_life",
      seatIds: ids,
      expectedContextVersion: st.contextVersion,
    });
    setBusy(false);
  };
  return (
    <section className="notice life-announcements" aria-label="待公布生死">
      <strong>{pending.length} 人生死状态尚未公布 · 仅说书人可见</strong>
      <p>
        {pending
          .map((s) => `${s.number} 号：${s.alive ? "存活" : "死亡"}`)
          .join("；")}
        。
        {room.phase === "DAY"
          ? "尚未公布，请选择公布时机。"
          : "默认在你宣布天亮时统一公布，也可在阶段控制中选择延后。"}
      </p>
      <button
        disabled={busy}
        onClick={() => void publish(pending.map((s) => s.id))}
      >
        立即公布全部生死变化
      </button>
      <details>
        <summary>单独公布某位玩家</summary>
        <div className="action-buttons">
          {pending.map((s) => (
            <button
              disabled={busy}
              key={s.id}
              onClick={() => void publish([s.id])}
            >
              公布 {s.number} 号
            </button>
          ))}
        </div>
      </details>
    </section>
  );
}
