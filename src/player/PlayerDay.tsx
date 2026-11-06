import { useState } from "react";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
import { useCountdown } from "../components/useCountdown";

export function PlayerVote({ room, send }: { room: RoomView; send: Send }) {
  const vote = room.liveVote!;
  const me = room.viewer.seatId!;
  const self = room.seats.find((s) => s.id === me);
  const [busy, setBusy] = useState(false);
  const left = useCountdown(vote.status === "OPEN" ? vote.closesInMs : undefined);
  const num = (id: string) => room.seats.find((s) => s.id === id)?.number;
  const locked = vote.status !== "OPEN" || left === 0;
  const eligible = !!self?.alive || !!self?.deadVoteAvailable;
  const raised = locked ? !!vote.counted[me] || (!!vote.hands[me] && vote.status === "OPEN") : !!vote.hands[me];
  const hands = vote.order.filter((id) => (vote.status === "OPEN" ? vote.hands[id] : vote.counted[id])).length;
  return (
    <section className="pl-card" aria-label="投票">
      <span className="pl-small">投票 · 处决至少 {Math.ceil(room.seats.filter((s) => s.alive).length / 2)} 票</span>
      <span className="pl-picked">
        {num(vote.nominator)} 号提名 {num(vote.nominee)} 号
      </span>
      <div className="pl-vote-strip" aria-label="举手情况">
        {vote.order.map((id) => (
          <span key={id} className={(vote.status === "OPEN" ? vote.hands[id] : vote.counted[id]) ? "up" : ""}>
            {num(id)}
          </span>
        ))}
      </div>
      <span className="pl-small">
        {hands} 人举手
        {locked ? " · 已锁定，等待说书人确认" : left !== null ? ` · ${left} 秒后锁定` : ""}
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
        {raised ? "已举手" : locked ? "未举手" : "举手"}
      </button>
      <span className="pl-small">
        {!eligible ? "你的死者票已用。" : locked ? "" : raised ? "再点一次放下。" : "锁定前都可以改。"}
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
          <div>还没有提名。</div>
        )}
      </div>
    </section>
  );
}
