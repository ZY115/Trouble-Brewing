import { useState } from "react";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
export default function Registration({
  room,
  send,
}: {
  room: RoomView;
  send: Send;
}) {
  const st = !!room.storyteller;
  const me = room.seats.find((s) => s.id === room.viewer.seatId);
  const [number, setNumber] = useState(String(me?.number ?? ""));
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState("");
  const status = room.registration;
  return (
    <section className="panel registration-panel">
      <div className="panel-heading">
        <h2>{st ? "玩家号码登记" : `已登记：${me?.number} 号`}</h2>
        <span>
          {status.joined} / {room.capacity} 人
        </span>
      </div>
      {status.duplicateNumbers.length > 0 ? (
        <div className="error" role="alert">
          号码重复：{status.duplicateNumbers.join("、")}{" "}
          号，请改号码。
        </div>
      ) : (
        <p>
          {status.open
            ? "等大家登记好，号码不重复就自动发身份。"
            : "还没开放入场，等说书人配板。"}
        </p>
      )}
      {st && status.missingNumbers.length > 0 && (
        <p className="muted">未登记号码：{status.missingNumbers.join("、")}</p>
      )}
      <div className="registration-numbers">
        {Array.from({ length: room.capacity }, (_, i) => i + 1).map((n) => {
          const count = room.seats.filter((s) => s.number === n).length;
          const mine = !st && n === me?.number;
          const label = st
            ? count > 1 ? `${count} 人重号` : count ? "已登记" : "未登记"
            : mine ? "我" : count > 1 ? `${count} 人重号` : count ? "已有人" : "";
          const className = [count > 1 ? "conflict" : count ? "registered" : "", mine ? "mine" : ""].join(" ");
          return !st && room.self?.canChangeNumber && !mine ? (
            <button
              type="button"
              key={n}
              className={className}
              aria-pressed={number === String(n)}
              onClick={() => setNumber(number === String(n) ? String(me?.number ?? "") : String(n))}
            >
              <strong>{n}</strong>
              <small>{label}</small>
            </button>
          ) : (
            <div key={n} className={className}>
              <strong>{n}</strong>
              <small>{label}</small>
            </div>
          );
        })}
      </div>
      {!st && room.self?.canChangeNumber && number && number !== String(me?.number) && (
        <div className="registration-move">
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await send({ type: "move_seat", number: Number(number) });
              setBusy(false);
            }}
          >
            改为 {number} 号
          </button>
          <button disabled={busy} onClick={() => setNumber(String(me?.number ?? ""))}>
            取消
          </button>
        </div>
      )}
      {st && room.seats.length > 0 && (
        <details>
          <summary>管理异常登记</summary>
          <p className="muted">
            移除后，这台手机要重新登记。
          </p>
          <div className="registration-entries">
            {room.seats.map((seat, i) => (
              <div key={seat.id}>
                <span>
                  登记 {i + 1} · {seat.number} 号
                  {status.duplicateNumbers.includes(seat.number)
                    ? " · 重复"
                    : ""}
                </span>
                <button onClick={() => setRemove(seat.id)}>移除</button>
              </div>
            ))}
          </div>
        </details>
      )}
      {remove && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>移除这条登记？</h2>
            <p>这台手机会退出房间，之后可以重新扫码登记。</p>
            <div className="action-buttons">
              <button onClick={() => setRemove("")}>取消</button>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  if (await send({ type: "remove_player", seatId: remove }))
                    setRemove("");
                  setBusy(false);
                }}
              >
                确认移除
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
