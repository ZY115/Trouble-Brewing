import { useState } from "react";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
export default function SeatChanges({
  room,
  send,
}: {
  room: RoomView;
  send: Send;
}) {
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const st = !!room.storyteller;
  const pending = room.seatRequests.filter((q) => q.status === "pending");
  const between =
    ["ENDED", "LOBBY", "SETUP"].includes(room.phase) && !room.registration.open;
  async function act(command: Parameters<Send>[0]) {
    setBusy(true);
    await send(command);
    setBusy(false);
  }
  return (
    <section className="panel seat-changes">
      <h3>{st ? "下局与换座" : "下局座位"}</h3>
      <p className="muted">下一局默认保留号码。换座由说书人在两局之间处理。</p>
      {st && room.phase === "ENDED" && (
        <button
          disabled={busy}
          className="primary"
          onClick={() => void act({ type: "new_round" })}
        >
          准备下一局（保留号码）
        </button>
      )}
      {!st && !room.registration.open && (
        <div className="inline-form">
          <label>
            申请号码
            <select
              aria-label="申请号码"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            >
              <option value="">选择号码</option>
              {Array.from({ length: room.capacity }, (_, i) => i + 1)
                .filter(
                  (n) =>
                    n !==
                    room.seats.find((s) => s.id === room.viewer.seatId)?.number,
                )
                .map((n) => (
                  <option key={n} value={n}>
                    {n} 号
                  </option>
                ))}
            </select>
          </label>
          <button
            disabled={!number || busy}
            onClick={() =>
              void act({ type: "request_seat", number: Number(number) })
            }
          >
            申请换座
          </button>
        </div>
      )}
      {pending.map((q) => (
        <div className="record-row" key={q.id}>
          <span>
            {q.fromNumber} 号 → {q.number} 号
          </span>
          {st ? (
            <>
              <button
                disabled={!between || busy}
                onClick={() =>
                  void act({
                    type: "resolve_seat_request",
                    requestId: q.id,
                    accept: true,
                  })
                }
              >
                同意交换
              </button>
              <button
                disabled={!between || busy}
                onClick={() =>
                  void act({
                    type: "resolve_seat_request",
                    requestId: q.id,
                    accept: false,
                  })
                }
              >
                拒绝
              </button>
            </>
          ) : (
            <button
              disabled={busy}
              onClick={() =>
                void act({ type: "cancel_seat_request", requestId: q.id })
              }
            >
              取消申请
            </button>
          )}
        </div>
      ))}
      {!st &&
        room.seatRequests
          .filter((q) => q.status !== "pending")
          .slice(-1)
          .map((q) => (
            <p className="muted" key={q.id}>
              最近申请：
              {
                {
                  accepted: "已同意",
                  rejected: "已拒绝",
                  cancelled: "已取消",
                  pending: "待处理",
                }[q.status]
              }
            </p>
          ))}
      {st && !!pending.length && (
        <p className="muted">先确认双方同意；同意后两人的号码一起交换。</p>
      )}
    </section>
  );
}
