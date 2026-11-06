import PublicRoster from "./PublicRoster";
import Picker, { seatOptions } from "../ui/Picker";
import { abstentionSummary, canRecordVote } from "../../shared/vote-display";
import LiveVoting, { DeadVoteControls } from "./LiveVoting";
import { useEffect, useRef, useState } from "react";
import type { PublicRecord, RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
function Timeline({
  records,
  onEdit,
}: {
  records: PublicRecord[];
  onEdit?: (r: PublicRecord) => void;
}) {
  return (
    <div className="public-timeline">
      {[...records].reverse().map((r) => {
        const superseded = records.some((e) => e.supersedes === r.id);
        return (
          <article
            className={`panel public-record ${superseded ? "superseded" : ""}`}
            key={r.id}
          >
            <small>
              第 {r.day} {r.period === "DAY" ? "天" : "夜"}
              {superseded
                ? " · 已更正（保留原记录）"
                : r.supersedes
                  ? " · 更正记录"
                  : ""}
            </small>
            <p>{r.text}</p>
            {r.type === "vote" && (
              <p className="muted">{abstentionSummary(r)}</p>
            )}
            {onEdit && r.type === "vote" && !superseded && (
              <button onClick={() => onEdit(r)}>更正记录</button>
            )}
          </article>
        );
      })}
    </div>
  );
}
export default function PublicPanel({
  room,
  send,
  prefill,
  onRecorded,
}: {
  room: RoomView;
  send: Send;
  prefill?: { nominator: string; nominee: string } | null;
  onRecorded?: () => void;
}) {
  const [nominator, setNominator] = useState(prefill?.nominator ?? "");
  const [nominee, setNominee] = useState(prefill?.nominee ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (prefill) formRef.current?.scrollIntoView({ block: "start" });
  }, []);
  const [voters, setVoters] = useState<string[]>([]);
  const [editing, setEditing] = useState<PublicRecord>();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const today = room.publicRecords.filter(
    (r) =>
      r.type === "vote" &&
      r.day === room.day &&
      !room.publicRecords.some((next) => next.supersedes === r.id),
  );
  const highest = Math.max(0, ...today.map((r) => r.voters?.length ?? 0));
  const living = room.seats.filter((s) => s.alive).length;
  const warnings = [
    nominator && !room.seats.find((s) => s.id === nominator)?.alive
      ? "提名者已死亡，请核对提名资格。"
      : "",
    today.some((r) => r.nominator === nominator)
      ? "他今天已经提名过。"
      : "",
    today.some((r) => r.nominee === nominee)
      ? "他今天已经被提名过。"
      : "",
  ].filter(Boolean);

  function reset() {
    setNominator("");
    setNominee("");
    setVoters([]);
    setEditing(undefined);
    setReason("");
  }
  return (
    <div>
      <div className="section-title">
        <div>
          <h2>公开记录</h2>
        </div>
      </div>
      {room.phase === "DAY" && (
        <p className="notice">
          {living} 人存活，处决至少 {Math.ceil(living / 2)} 票；今天最高 {highest} 票。
        </p>
      )}
      <LiveVoting key={room.liveVote?.id} room={room} send={send} />
      <PublicRoster room={room} />
      {room.storyteller &&
        !["OPEN", "COUNTING"].includes(room.liveVote?.status ?? "") && (
          <form
            ref={formRef}
            className="panel vote-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              if (
                await send({
                  type: "record_vote",
                  nominator,
                  nominee,
                  voters,
                  supersedes: editing?.id,
                  reason,
                })
              ) {
                const fromNomination = !!prefill && !editing;
                reset();
                setSaved(true);
                if (fromNomination) onRecorded?.();
              }
              setBusy(false);
            }}
          >
            <h3>
              {editing ? `更正第 ${editing.day} 天的投票` : prefill ? "登记现场投票" : "发起或登记投票"}
            </h3>
            <div className="form-grid">
              {[
                { label: "提名者", value: nominator, set: setNominator },
                { label: "被提名者", value: nominee, set: setNominee },
              ].map((f) => (
                <Picker
                  key={f.label}
                  label={f.label}
                  value={f.value}
                  options={seatOptions(room.seats)}
                  onChange={(v) => {
                    f.set(v);
                    setSaved(false);
                  }}
                  placeholder="选择玩家"
                />
              ))}
            </div>
            {!editing &&
              warnings.map((w) => (
                <p className="muted" key={w}>
                  {w}
                </p>
              ))}
            {!editing && !prefill && (
              <button
                className="primary"
                type="button"
                disabled={
                  busy || !nominee || !nominator || room.phase !== "DAY"
                }
                onClick={async () => {
                  setBusy(true);
                  await send({ type: "open_vote", nominator, nominee });
                  setBusy(false);
                }}
              >
                发起手机举手
              </button>
            )}
            <details open={!!editing || !!prefill}>
              <summary>{editing ? "修订票数" : "直接登记现场投票"}</summary>
              <p className="muted">点举了手的人 · {voters.length} 票</p>
              {editing && !editing.eligibleAtVote && (
                <p className="muted">这条记录没有保存当时的投票资格，请核对后更正。</p>
              )}
              <div className="vote-grid editable" role="group" aria-label="投票者">
                {[...room.seats]
                  .sort((a, b) => a.number - b.number)
                  .map((s) => {
                    const on = voters.includes(s.id);
                    const noVote = !canRecordVote(s, editing) && !on;
                    const dead = editing?.deadAtVote ? editing.deadAtVote.includes(s.id) : !s.alive;
                    return (
                      <button
                        type="button"
                        key={s.id}
                        className={`${on ? "on" : ""}${dead ? " dead" : ""}`}
                        aria-pressed={on}
                        disabled={noVote}
                        onClick={() => setVoters(on ? voters.filter((id) => id !== s.id) : [...voters, s.id])}
                      >
                        {s.number}
                        {noVote && <small>无票</small>}
                      </button>
                    );
                  })}
              </div>
              {editing && (
                <label>
                  更正原因
                  <input
                    aria-label="更正原因"
                    maxLength={200}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                  />
                </label>
              )}
              <div className="action-buttons">
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !nominee ||
                    !nominator ||
                    (!editing && room.phase !== "DAY") ||
                    (!!editing && !reason.trim())
                  }
                >
                  {editing ? "保存更正" : `登记 ${voters.length} 票并公开`}
                </button>
                {editing && (
                  <button type="button" onClick={reset}>
                    取消更正
                  </button>
                )}
                {saved && <span role="status">已记录</span>}
              </div>
            </details>
          </form>
        )}
      <DeadVoteControls room={room} send={send} />
      {!room.publicRecords.length && <p className="muted">暂无公开记录</p>}
      <Timeline
        records={room.publicRecords}
        onEdit={
          room.storyteller
            ? (r) => {
                setEditing(r);
                setNominator(r.nominator!);
                setNominee(r.nominee!);
                setVoters(r.voters!);
                setReason("");
                setSaved(false);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            : undefined
        }
      />
    </div>
  );
}
