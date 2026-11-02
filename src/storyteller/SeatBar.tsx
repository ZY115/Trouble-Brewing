import { useState } from "react";
import type { RoomView } from "../../shared/types";
import { roleName } from "../../shared/roles";
import type { Send } from "../useRoom";

/** Tap a seat on the grimoire: toggle reminders in one touch, no reason needed. */
export default function SeatBar({
  room,
  send,
  seatId,
  onClose,
  onChat,
  onDetail,
}: {
  room: RoomView;
  send: Send;
  seatId: string;
  onClose: () => void;
  onChat: () => void;
  onDetail: () => void;
}) {
  const st = room.storyteller!;
  const seat = room.seats.find((s) => s.id === seatId);
  const [busy, setBusy] = useState(false);
  const [confirmLife, setConfirmLife] = useState(false);
  if (!seat) return null;
  const a = st.assignments[seat.id];
  const c = st.conditions[seat.id];
  const playing = ["FIRST_NIGHT", "OTHER_NIGHT", "DAY"].includes(room.phase);
  async function act(command: Parameters<Send>[0]) {
    setBusy(true);
    await send(command);
    setBusy(false);
  }
  const toggle = (condition: "poisoned" | "protected" | "drunk") =>
    act({
      type: "set_condition",
      seatId: seat.id,
      condition,
      value: !c?.[condition],
      expectedContextVersion: st.contextVersion,
    });
  return (
    <section className="seat-bar" aria-label={`${seat.number} 号快捷操作`}>
      <div className="seat-bar-head">
        <b>{seat.number} 号</b>
        <span className="muted">
          {roleName(a?.actualRoleId)}
          {a && a.actualRoleId !== a.perceivedRoleId
            ? ` · 以为自己是${roleName(a.perceivedRoleId)}`
            : ""}
          {" · "}
          {seat.alive ? "存活" : "死亡"}
        </span>
        <span style={{ flex: 1 }} />
        <button className="icon-button ghost" aria-label="关闭" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="seat-bar-buttons">
        <button
          className={c?.poisoned ? "on-poison" : ""}
          aria-pressed={!!c?.poisoned}
          disabled={busy || !playing}
          onClick={() => void toggle("poisoned")}
        >
          毒
        </button>
        <button
          className={c?.protected ? "on-protect" : ""}
          aria-pressed={!!c?.protected}
          disabled={busy || !playing}
          onClick={() => void toggle("protected")}
        >
          护
        </button>
        <button
          className={c?.drunk ? "on-drunk" : ""}
          aria-pressed={!!c?.drunk}
          disabled={busy || !playing}
          onClick={() => void toggle("drunk")}
        >
          醉
        </button>
        <button
          disabled={busy || !playing}
          className={confirmLife ? "primary" : ""}
          onClick={() => {
            if (!confirmLife) return setConfirmLife(true);
            setConfirmLife(false);
            void act({ type: "set_alive", seatId: seat.id, alive: !seat.alive });
          }}
        >
          {confirmLife
            ? `确认${seat.alive ? "登记死亡" : "改为存活"}`
            : seat.alive
              ? "登记死亡"
              : "改为存活"}
        </button>
        <button onClick={onChat}>私聊</button>
        <button onClick={onDetail} disabled={!playing}>
          详情…
        </button>
      </div>
      {room.phase !== "DAY" && playing && (
        <small className="muted">夜里登记的死亡默认在宣布天亮时统一公布。</small>
      )}
    </section>
  );
}
