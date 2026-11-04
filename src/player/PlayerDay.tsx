import { useState } from "react";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";

export function PlayerVote({ room, send }: { room: RoomView; send: Send }) {
  const vote = room.liveVote!;
  const me = room.viewer.seatId!;
  const self = room.seats.find((s) => s.id === me);
  const [busy, setBusy] = useState(false);
  const num = (id: string) => room.seats.find((s) => s.id === id)?.number;
  const locked = me in vote.counted;
  const eligible = !!self?.alive || !!self?.deadVoteAvailable;
  const raised = !!vote.hands[me];
  const tally = Object.values(vote.counted).filter(Boolean).length;
  const myTurn = vote.order.indexOf(me) - vote.cursor;
  return (
    <section className="pl-card" aria-label="投票">
      <span className="pl-small">投票 · 过半需 {Math.ceil(room.seats.filter((s) => s.alive).length / 2)} 票</span>
      <span className="pl-picked">
        {num(vote.nominator)} 号提名 {num(vote.nominee)} 号
      </span>
      <div className="pl-vote-strip" aria-label="计票顺序">
        {vote.order.map((id, i) => {
          const cls =
            id in vote.counted
              ? vote.counted[id]
                ? "yes"
                : "no"
              : vote.status === "COUNTING" && i === vote.cursor
                ? "now"
                : vote.hands[id]
                  ? "up"
                  : "";
          return (
            <span key={id} className={cls}>
              {num(id)}
            </span>
          );
        })}
      </div>
      <span className="pl-small">
        已计 {tally} 票
        {vote.status === "OPEN"
          ? " · 等待说书人开始计票"
          : locked
            ? " · 你的票已计入"
            : myTurn > 0
              ? ` · 再过 ${myTurn} 人轮到你`
              : " · 正在计你的票"}
      </span>
      <button
        className="pl-hand"
        aria-pressed={raised}
        disabled={busy || locked || !eligible}
        onClick={async () => {
          setBusy(true);
          await send({ type: "raise_hand", voteId: vote.id, raised: !raised });
          setBusy(false);
        }}
      >
        {locked ? (vote.counted[me] ? "已投票" : "未投票") : raised ? "已举手" : "举手"}
      </button>
      <span className="pl-small">
        {!eligible ? "你的死者票已用。" : locked ? "" : raised ? "再点一次放下。指针到你时锁定。" : "指针到你之前都可以改。"}
      </span>
    </section>
  );
}

export function TodayList({ room }: { room: RoomView }) {
  const today = room.publicRecords.filter(
    (r) =>
      r.day === room.day &&
      r.period === "DAY" &&
      r.type !== "phase" &&
      !room.publicRecords.some((n) => n.supersedes === r.id),
  );
  return (
    <section className="pl-card" aria-label="今天">
      <span className="pl-small">今天</span>
      <div className="pl-list">
        {today.length ? (
          [...today].reverse().map((r) => <div key={r.id}>{r.text}</div>)
        ) : (
          <div>还没有提名。开始投票时，所有人会同时看到。</div>
        )}
      </div>
    </section>
  );
}
