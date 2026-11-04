import { useState } from "react";
import type { RoomView } from "../../shared/types";
import { completedAction } from "../../shared/assistance";
import { choiceSentence } from "../../shared/action-choice";
import { isEvil, roleById, roleName, TEAM_NAMES } from "../../shared/roles";
import type { Send } from "../useRoom";
import Conversation from "../components/Conversation";
import ExecutionControl from "../components/ExecutionControl";
import RulingCorrection from "../components/RulingCorrection";

/** Everything about one player in one place: role, markers, chat and night history. */
export default function SeatPanel({
  room,
  send,
  seatId,
  onClose,
  onEdit,
}: {
  room: RoomView;
  send: Send;
  seatId: string;
  onClose: () => void;
  onEdit: () => void;
}) {
  const st = room.storyteller!;
  const seat = room.seats.find((s) => s.id === seatId);
  const [busy, setBusy] = useState(false);
  const [confirmLife, setConfirmLife] = useState(false);
  if (!seat) return null;
  const a = st.assignments[seat.id];
  const c = st.conditions[seat.id];
  const role = roleById(a?.actualRoleId ?? "");
  const playing = ["FIRST_NIGHT", "OTHER_NIGHT", "DAY"].includes(room.phase);
  const actions = room.actions.filter((x) => x.seatId === seat.id).sort((x, y) => y.night - x.night);
  async function act(command: Parameters<Send>[0]) {
    setBusy(true);
    await send(command);
    setBusy(false);
  }
  const toggle = (condition: "poisoned" | "protected" | "drunk") =>
    act({ type: "set_condition", seatId: seat.id, condition, value: !c?.[condition], expectedContextVersion: st.contextVersion });
  const herring = st.redHerring === seat.id;
  return (
    <section className="seat-panel" aria-label={`${seat.number} 号`}>
      <header className="seat-panel-head">
        <button className="link-button" onClick={onClose}>
          ← 回到当前任务
        </button>
      </header>
      <div className="seat-panel-title">
        <span className={`seat-panel-number ${role?.team ?? ""}`}>{seat.number}</span>
        <div>
          <h2>{role ? role.name : `${seat.number} 号`}</h2>
          <span className="muted">
            {role ? TEAM_NAMES[role.team] : "未发身份"}
            {a && a.actualRoleId !== a.perceivedRoleId ? ` · 以为自己是${roleName(a.perceivedRoleId)}` : ""}
            {" · "}
            {seat.alive ? "存活" : seat.deadVoteAvailable ? "死亡 · 有死者票" : "死亡 · 死者票已用"}
            {seat.alive !== st.publishedAlive[seat.id] ? "（未公布）" : ""}
          </span>
        </div>
      </div>

      {playing && (
        <div className="seat-toggles" role="group" aria-label="标记">
          <button className={c?.poisoned ? "on-poison" : ""} aria-pressed={!!c?.poisoned} disabled={busy} onClick={() => void toggle("poisoned")}>
            中毒
          </button>
          <button className={c?.protected ? "on-protect" : ""} aria-pressed={!!c?.protected} disabled={busy} onClick={() => void toggle("protected")}>
            受保护
          </button>
          <button className={c?.drunk ? "on-drunk" : ""} aria-pressed={!!c?.drunk} disabled={busy} onClick={() => void toggle("drunk")}>
            醉酒
          </button>
          {!isEvil(a?.actualRoleId ?? "") && (
            <button
              aria-pressed={herring}
              disabled={busy}
              onClick={() => void act({ type: "set_red_herring", seatId: herring ? "" : seat.id, expectedContextVersion: st.contextVersion })}
            >
              占卜误判
            </button>
          )}
          <button
            className={confirmLife ? "primary" : ""}
            disabled={busy}
            onClick={() => {
              if (!confirmLife) return setConfirmLife(true);
              setConfirmLife(false);
              void act({ type: "set_alive", seatId: seat.id, alive: !seat.alive });
            }}
          >
            {confirmLife ? `确认${seat.alive ? "登记死亡" : "改为存活"}` : seat.alive ? "登记死亡" : "改为存活"}
          </button>
        </div>
      )}
      {c?.note && <p className="task-note">备注：{c.note}</p>}
      <div className="task-links">
        {playing && (
          <button className="link-button" onClick={onEdit}>
            改身份或写备注…
          </button>
        )}
      </div>
      {room.phase === "DAY" && <ExecutionControl room={room} seatId={seat.id} send={send} />}

      <div className="seat-panel-section">
        <h3>私聊</h3>
        <Conversation key={seat.id} room={room} send={send} recipient={seat.id} compact bare />
      </div>

      {!!actions.length && (
        <div className="seat-panel-section">
          <h3>夜间行动</h3>
          <ul className="seat-history">
            {actions.map((x) => (
              <li key={x.id}>
                <span className="muted">第 {x.night} 夜</span>
                <span>{x.targets.length ? choiceSentence(x, room.seats, x.targets, "") : x.prompt}</span>
                <b>{x.response ?? (completedAction(x) ? "已处理" : x.status === "REQUESTED" ? "等待选择" : "待回复")}</b>
                {x.status === "DELIVERED" && (
                  <details className="task-more">
                    <summary>更正</summary>
                    <RulingCorrection room={room} action={x} send={send} />
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
