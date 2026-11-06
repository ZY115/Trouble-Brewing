import { useEffect, useState } from "react";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
import Picker from "../ui/Picker";

type SeatMode = "keep" | "host" | "rescan";

export function NextRound({ send }: { send: Send }) {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [rescan, setRescan] = useState(false);
  const [busy, setBusy] = useState(false);
  async function start(seatMode: SeatMode) {
    setBusy(true);
    await send({ type: "new_round", seatMode });
    setBusy(false);
  }
  if (!open)
    return (
      <button className="primary next-main" onClick={() => setOpen(true)}>
        再来一局
      </button>
    );
  return (
    <section className="next-round" aria-label="再来一局">
      <div className="next-head">
        <span className="note-label">再来一局</span>
        <button
          className="link-button"
          onClick={() => {
            setOpen(false);
            setMoving(false);
            setRescan(false);
          }}
        >
          收起
        </button>
      </div>
      <button className="next-option" disabled={busy} onClick={() => void start("keep")}>
        <b>保持原号码</b>
        <span>大家坐在原位，直接进入配板</span>
      </button>
      <button className="next-option" aria-expanded={moving} disabled={busy} onClick={() => setMoving(!moving)}>
        <b>座位变动</b>
        <span>有人换了座位</span>
        <svg className="picker-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {moving && (
        <div className="next-sub">
          <button className="next-option" disabled={busy} onClick={() => void start("host")}>
            <b>由我修改号码</b>
            <span>你在座位表里给每位玩家改成新号码，玩家不用操作</span>
          </button>
          {rescan ? (
            <div className="next-confirm" role="alert">
              <span>所有玩家要重新扫码选号，原来的登录会失效。</span>
              <button className="danger-fill" disabled={busy} onClick={() => void start("rescan")}>
                确认，让大家重新扫码
              </button>
              <button className="link-button" disabled={busy} onClick={() => setRescan(false)}>
                取消
              </button>
            </div>
          ) : (
            <button className="next-option" disabled={busy} onClick={() => setRescan(true)}>
              <b>玩家重新扫码</b>
              <span>所有人重新扫码，自己选号码</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function SeatingEditor({ room, send }: { room: RoomView; send: Send }) {
  const st = room.storyteller!;
  const confirmed = !!room.roundSetup?.seatingConfirmed;
  const seats = [...room.seats].sort((a, b) => a.number - b.number);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState(!confirmed);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!confirmed) setEditing(true);
  }, [confirmed]);
  const value = (id: string) => draft[id] ?? seats.find((s) => s.id === id)!.number;
  const options = Array.from({ length: room.capacity }, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1),
    text: `${i + 1} 号`,
  }));
  const assign = (id: string, n: number) => {
    const other = seats.find((s) => s.id !== id && value(s.id) === n);
    setDraft({ ...draft, [id]: n, ...(other ? { [other.id]: value(id) } : {}) });
  };
  const numbers = seats.map((s) => value(s.id));
  const duplicate = numbers.some((n, i) => numbers.indexOf(n) !== i);
  const changes = seats.filter((s) => value(s.id) !== s.number).length;
  async function confirm() {
    setBusy(true);
    const ok = await send({
      type: "set_seating",
      seats: seats.map((s) => ({ seatId: s.id, number: value(s.id) })),
      expectedContextVersion: st.contextVersion,
    });
    setBusy(false);
    if (ok) {
      setDraft({});
      setEditing(false);
    }
  }
  return (
    <section className={`panel seating${confirmed ? "" : " pending"}`} aria-label="调整座位">
      <div className="panel-heading">
        <h3>调整座位</h3>
        <span className="muted" style={{ fontSize: 12 }}>
          {confirmed ? "已确认" : "待确认"}
        </span>
      </div>
      {!editing ? (
        <button onClick={() => setEditing(true)}>重新调整座位</button>
      ) : room.registration.open ? (
        <p className="task-note">先暂停入场，再修改座位。</p>
      ) : (
        <>
          <p className="task-note">每行是一台手机，改成他现在坐的号码；选到别人的号码会自动互换。</p>
          <div className="seating-rows">
            {seats.map((s) => (
              <div key={s.id} className={value(s.id) !== s.number ? "changed" : ""}>
                <Picker
                  label={`上局 ${s.number} 号`}
                  value={String(value(s.id))}
                  options={options}
                  onChange={(v) => v && assign(s.id, Number(v))}
                  clearable={false}
                />
              </div>
            ))}
          </div>
          <button className="primary" disabled={busy || duplicate} onClick={() => void confirm()}>
            {changes ? `确认座位表（${changes} 人换号）` : "确认座位表（号码不变）"}
          </button>
        </>
      )}
    </section>
  );
}
