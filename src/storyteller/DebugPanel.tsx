import { useState } from "react";
import type { RoomView } from "../../shared/types";
import { roleName } from "../../shared/roles";
import type { Send } from "../useRoom";

export default function DebugPanel({
  room,
  send,
}: {
  room: RoomView;
  send: Send;
}) {
  const [busy, setBusy] = useState(false);
  const debug = room.storyteller?.debug;
  if (!debug) return null;
  const waiting = ["LOBBY", "SETUP"].includes(room.phase);
  const players = room.seats.filter((s) => debug.seatIds.includes(s.id));
  async function fill(start: boolean) {
    setBusy(true);
    try {
      await send({ type: "debug_fill", start });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-label="单人调试">
      <h3>单人调试</h3>
      <p className="muted">同屏操作说书人和玩家，点击号码切换视角。</p>
      <a className="button primary" href={`/debug?room=${room.code}`} target="_top">打开同屏调试台</a>
      {waiting && (
        <>
          <div className="action-buttons">
            <button disabled={busy} onClick={() => void fill(false)}>
              补齐空位（暂不开局）
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void fill(true)}
            >
              补齐测试玩家并开局
            </button>
          </div>
          <p className="muted">
            已有玩家保留；暂不开局会暂停入场，方便检查登记页。
          </p>
        </>
      )}
      {!!players.length && (
        <div className="action-buttons">
          {players.map((s) => (
            <a
              className="button"
              key={s.id}
              href={`/join/${room.code}?debugSeat=${encodeURIComponent(s.id)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              打开 {s.number} 号玩家
              {room.storyteller?.assignments[s.id]
                ? ` · ${roleName(room.storyteller.assignments[s.id].actualRoleId)}`
                : ""}
            </a>
          ))}
        </div>
      )}
      {!waiting && !players.length && (
        <p className="muted">
          本局没有测试玩家。请结束后准备下一局再补齐空位。
        </p>
      )}
    </section>
  );
}
