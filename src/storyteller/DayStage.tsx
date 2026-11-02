import { useState } from "react";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
import Grimoire, { type MarkKind, type SeatRing } from "../ui/Grimoire";
import LiveVoting from "../components/LiveVoting";
import DayTimer from "../components/DayTimer";
import { seatNumber, storytellerSeats } from "./seats";

export default function DayStage({
  room,
  send,
  onSeat,
  openLog,
}: {
  room: RoomView;
  send: Send;
  onSeat: (seatId: string) => void;
  openLog: () => void;
}) {
  const vote = room.liveVote;
  const active = !!vote && ["OPEN", "COUNTING"].includes(vote.status);
  const [picking, setPicking] = useState<"" | "nominator" | "nominee">("");
  const [nominator, setNominator] = useState("");
  const [nominee, setNominee] = useState("");
  const [busy, setBusy] = useState(false);
  const living = room.seats.filter((s) => s.alive).length;
  const needed = Math.ceil(living / 2);
  const today = room.publicRecords.filter(
    (r) => r.day === room.day && !room.publicRecords.some((n) => n.supersedes === r.id),
  );
  const votesToday = today.filter((r) => r.type === "vote");
  const highest = Math.max(0, ...votesToday.map((r) => r.voters?.length ?? 0));
  const rings: Record<string, SeatRing[]> = {};
  const marks: Record<string, { text: string; kind: MarkKind }[]> = {};
  if (active && vote) {
    rings[vote.nominator] = ["actor"];
    rings[vote.nominee] = [...(rings[vote.nominee] ?? []), "target"];
    if (vote.status === "COUNTING" && vote.order[vote.cursor])
      rings[vote.order[vote.cursor]] = [...(rings[vote.order[vote.cursor]] ?? []), "focus"];
    for (const s of room.seats) {
      if (s.id in vote.counted)
        marks[s.id] = [vote.counted[s.id] ? { text: "票", kind: "vote" } : { text: "弃", kind: "tag" }];
      else if (vote.hands[s.id]) marks[s.id] = [{ text: "举", kind: "hand" }];
    }
  } else {
    if (nominator) rings[nominator] = ["actor"];
    if (nominee) rings[nominee] = [...(rings[nominee] ?? []), "target"];
  }
  const line =
    active && vote
      ? [{ from: seatNumber(room, vote.nominator) ?? 0, to: seatNumber(room, vote.nominee) ?? 0 }]
      : nominator && nominee
        ? [{ from: seatNumber(room, nominator) ?? 0, to: seatNumber(room, nominee) ?? 0, dashed: true }]
        : [];
  const warnings = [
    nominator && !room.seats.find((s) => s.id === nominator)?.alive ? "提名者已死亡，请核对提名资格。" : "",
    votesToday.some((r) => r.nominator === nominator) ? "该玩家今天已经提名过。" : "",
    votesToday.some((r) => r.nominee === nominee) ? "该玩家今天已经被提名过。" : "",
  ].filter(Boolean);
  function reset() {
    setPicking("");
    setNominator("");
    setNominee("");
  }
  function pick(seatId: string) {
    if (picking === "nominator") {
      setNominator(seatId);
      setPicking("nominee");
    } else if (picking === "nominee") {
      setNominee(seatId);
      setPicking("");
    } else onSeat(seatId);
  }
  const latest = !active && !picking && !nominee;
  return (
    <>
      <nav className="st-rail" aria-label="白天">
        <div className="rail-title">
          <span>第 {room.day} 天</span>
          <span>{living} 人存活</span>
        </div>
        <DayTimer room={room} send={send} />
        <div className="rail-title" style={{ marginTop: 14 }}>
          <span>今天</span>
          <span>过半 {needed} 票</span>
        </div>
        {today.length ? (
          [...today].reverse().slice(0, 8).map((r) => (
            <div key={r.id} className="rail-item done" style={{ minHeight: 0, padding: "6px 10px", lineHeight: 1.5 }}>
              <span style={{ fontSize: 13 }}>{r.text}</span>
            </div>
          ))
        ) : (
          <p className="step-note">还没有提名或公开记录。</p>
        )}
        <div className="rail-actions">
          <button
            className={active ? "" : "primary"}
            disabled={active}
            onClick={() => {
              reset();
              setPicking("nominator");
            }}
          >
            发起提名
          </button>
          <button onClick={openLog}>补录线下投票 · 更正记录</button>
        </div>
      </nav>
      <main className="st-stage">
        <div className="stage-row">
          <div className="stage-circle">
          <Grimoire
            label="魔典"
            capacity={room.capacity}
            seats={storytellerSeats(room, { rings, marks })}
            lines={line}
            onSeat={(s) => pick(s.key)}
            center={
              <>
                <span className="eyebrow">第 {room.day} 天</span>
                <span className="tally">{living}</span>
                <span className="muted" style={{ fontSize: 13 }}>
                  人存活 · 过半需 {needed} 票 · 今日最高 {highest}
                </span>
              </>
            }
          />
          </div>
          <div className="stage-card">
            {active ? (
              <LiveVoting key={vote!.id} room={room} send={send} />
            ) : picking || nominee ? (
              <section className="step-card" aria-label="发起提名">
                <div className="step-head">
                  <span className="step-badge">提名</span>
                  <span className="step-who">
                    {picking === "nominator"
                      ? "在圆桌上点提名者"
                      : picking === "nominee"
                        ? "再点被提名者"
                        : "确认后玩家手机同时出现举手"}
                  </span>
                </div>
                <span className="step-title">
                  {seatNumber(room, nominator) ?? "__"} 号 提名 {seatNumber(room, nominee) ?? "__"} 号
                </span>
                {warnings.map((w) => (
                  <p key={w} className="reference-warning">
                    {w}
                  </p>
                ))}
                <div className="step-row">
                  <button
                    className="primary"
                    disabled={busy || !nominator || !nominee}
                    onClick={async () => {
                      setBusy(true);
                      if (await send({ type: "open_vote", nominator, nominee })) reset();
                      setBusy(false);
                    }}
                  >
                    开始手机举手
                  </button>
                  <button onClick={reset}>取消</button>
                </div>
                <p className="step-note">现场举手也可以：计票时逐座代录，或在「记录」里直接补录整次投票。</p>
              </section>
            ) : (
              latest && (
                <LatestOrHint room={room} send={send} />
              )
            )}
          </div>
        </div>
        <div className="st-hint">
          <span>点「发起提名」后依次点提名者、被提名者</span>
          <span>票 已计 · 举 已举手 · 弃 未投</span>
        </div>
      </main>
    </>
  );
}

function LatestOrHint({ room, send }: { room: RoomView; send: Send }) {
  const hasRecord = room.publicRecords.some((r) => r.type === "vote");
  if (hasRecord || room.liveVote) return <LiveVoting room={room} send={send} />;
  return (
    <section className="step-card quiet" aria-label="白天">
      <span className="step-who">自由讨论中</span>
      <span className="step-title">等待提名</span>
      <p className="step-note">
        有人提名时，点「发起提名」，再在圆桌上依次点提名者和被提名者。所有玩家的手机会同时出现同样的投票界面。
      </p>
    </section>
  );
}
