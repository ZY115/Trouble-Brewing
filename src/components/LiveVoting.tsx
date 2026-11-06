import ExecutionControl from "./ExecutionControl";
import Picker from "../ui/Picker";
import { latestVoteRecord } from "../../shared/vote-display";
import { useState } from "react";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
export default function LiveVoting({
  room,
  send,
}: {
  room: RoomView;
  send: Send;
}) {
  const vote = room.liveVote;
  const latest = latestVoteRecord(room.publicRecords);
  const num = (id?: string) => room.seats.find((s) => s.id === id)?.number;
  if (vote && ["OPEN", "COUNTING"].includes(vote.status))
    return (
      <section className="panel live-voting">
        <h3>
          {num(vote.nominator)} 号提名 {num(vote.nominee)} 号
        </h3>
        <p>
          {vote.status === "OPEN"
            ? `正在举手 · ${Object.values(vote.hands).filter(Boolean).length} 人举手`
            : "举手已锁定，等待确认票数"}
        </p>
      </section>
    );
  return latest ? (
    <section className="panel live-voting">
      {vote?.status === "CANCELLED" && (
        <p className="muted">这次投票已取消，下面是上一次的记录。</p>
      )}
      <h3>
        {latest.seatNumbers?.[latest.nominator!] ?? num(latest.nominator)} 号提名{" "}
        {latest.seatNumbers?.[latest.nominee!] ?? num(latest.nominee)} 号
      </h3>
      <p>
        第 {latest.day} 天 · 已记录 {latest.voters?.length ?? 0} 票
        {latest.supersedes ? "（已更正）" : ""}
      </p>
      {room.storyteller && latest.nominee && (
        <ExecutionControl
          key={latest.id}
          room={room}
          seatId={latest.nominee}
          send={send}
        />
      )}
    </section>
  ) : vote?.status === "CANCELLED" ? (
    <p className="notice">本次投票已取消</p>
  ) : null;
}
export function DeadVoteControls({
  room,
  send,
}: {
  room: RoomView;
  send: Send;
}) {
  const [seatId, setSeatId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const seat = room.seats.find((s) => s.id === seatId);
  if (!room.storyteller || ["LOBBY", "SETUP", "ENDED"].includes(room.phase))
    return null;
  return (
    <details className="panel">
      <summary>说书人更正死者票</summary>
      <Picker
        label="玩家"
        value={seatId}
        options={[...room.seats]
          .filter((s) => !s.alive)
          .sort((a, b) => a.number - b.number)
          .map((s) => ({ value: s.id, label: `${s.number} 号 · ${s.deadVoteAvailable ? "可用" : "已用"}`, text: `${s.number} 号` }))}
        onChange={setSeatId}
        placeholder="选择玩家"
      />
      <label className="field">
        公开原因
        <input
          aria-label="死者票更正原因"
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button
        disabled={!seat || busy || !reason.trim()}
        onClick={async () => {
          if (!seat) return;
          setBusy(true);
          if (
            await send({
              type: "set_dead_vote",
              seatId,
              available: !seat.deadVoteAvailable,
              reason,
            })
          )
            setReason("");
          setBusy(false);
        }}
      >
        改为{seat?.deadVoteAvailable ? "已使用" : "可用"}
      </button>
    </details>
  );
}
