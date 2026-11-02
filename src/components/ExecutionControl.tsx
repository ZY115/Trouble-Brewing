import { useState } from "react";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";

export default function ExecutionControl({
  room,
  seatId,
  send,
}: {
  room: RoomView;
  seatId: string;
  send: Send;
}) {
  const seat = room.seats.find((s) => s.id === seatId);
  const [died, setDied] = useState(seat?.alive ?? true);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!room.storyteller || room.phase !== "DAY") return null;
  if (!seat) return null;
  return (
    <details className="execution-control">
      <summary>手动处决 {seat.number} 号</summary>
      <p className="muted">
        登记处决结果；未完成的计票将取消。补录已登记的死亡时，勾选“因本次处决死亡”。
      </p>
      <label className="check-line">
        <input
          type="checkbox"
          checked={died}
          onChange={(e) => setDied(e.target.checked)}
        />
        因本次处决死亡（含补录）
      </label>
      <label className="field">
        公开原因
        <input
          aria-label={`处决 ${seat.number} 号原因`}
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <label className="check-line">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        确认处决 {seat.number} 号
      </label>
      <button
        className="danger-text"
        disabled={busy || !confirmed || !reason.trim()}
        onClick={async () => {
          setBusy(true);
          if (
            await send({
              type: "execute_player",
              seatId,
              reason,
              confirmed: true,
              died,
              expectedContextVersion: room.storyteller!.contextVersion,
            })
          ) {
            setConfirmed(false);
            setReason("");
          }
          setBusy(false);
        }}
      >
        执行并公开记录
      </button>
    </details>
  );
}
