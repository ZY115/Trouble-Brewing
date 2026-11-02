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
          号。请相关玩家修改号码，暂不发身份。
        </div>
      ) : (
        <p>
          {status.open
            ? "等待全部玩家登记，号码无重复后自动发身份。"
            : "入场尚未开放，等待说书人确认配板。"}
        </p>
      )}
      {status.missingNumbers.length > 0 && (
        <p className="muted">未登记号码：{status.missingNumbers.join("、")}</p>
      )}
      <div className="registration-numbers">
        {Array.from({ length: room.capacity }, (_, i) => i + 1).map((n) => {
          const count = room.seats.filter((s) => s.number === n).length;
          return (
            <div
              key={n}
              className={count > 1 ? "conflict" : count ? "registered" : ""}
            >
              <strong>{n}</strong>
              <small>
                {count > 1 ? `${count} 人重号` : count ? "已登记" : "未登记"}
              </small>
            </div>
          );
        })}
      </div>
      {!st && room.self?.canChangeNumber && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            await send({ type: "move_seat", number: Number(number) });
            setBusy(false);
          }}
        >
          <label className="field">
            修改我的号码
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={room.capacity}
              step={1}
              required
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </label>
          <button disabled={busy || !number}>保存号码</button>
        </form>
      )}
      {st && room.seats.length > 0 && (
        <details>
          <summary>管理异常登记</summary>
          <p className="muted">
            每条登记对应一个浏览器会话。移除后，该浏览器需要重新登记。
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
            <p>将撤销该浏览器的房间访问权限。玩家可重新扫码登记。</p>
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
