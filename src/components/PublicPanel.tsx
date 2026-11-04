import PublicRoster from "./PublicRoster";
import { RecapFacts, RecapTimeline, ResultBanner } from "./Recap";
import { abstentionSummary } from "../../shared/vote-display";
import LiveVoting, { DeadVoteControls } from "./LiveVoting";
import { useState } from "react";
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
}: {
  room: RoomView;
  send: Send;
}) {
  const [nominator, setNominator] = useState("");
  const [nominee, setNominee] = useState("");
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
      ? "已有该玩家今天的提名记录，请核对。"
      : "",
    today.some((r) => r.nominee === nominee)
      ? "已有该玩家今天被提名的记录，请核对。"
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
          <p>记录投票和公开状态。玩家发言由自己记入私人笔记。</p>
        </div>
      </div>
      {room.phase === "DAY" && (
        <p className="notice">
          常规计票参考：{living} 人存活，至少 {Math.ceil(living / 2)}{" "}
          票；今天已记录最高 {highest} 票。处决仍由说书人裁定。
        </p>
      )}
      <LiveVoting key={room.liveVote?.id} room={room} send={send} />
      <PublicRoster room={room} />
      {room.storyteller &&
        !["OPEN", "COUNTING"].includes(room.liveVote?.status ?? "") && (
          <form
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
                reset();
                setSaved(true);
              }
              setBusy(false);
            }}
          >
            <h3>
              {editing ? `更正第 ${editing.day} 天的投票` : "发起或登记投票"}
            </h3>
            <p className="muted">
              可发起手机举手，也可登记现场投票。系统计数并记录，处决和特殊规则由说书人裁定。
            </p>
            <div className="form-grid">
              {[
                { label: "提名者", value: nominator, set: setNominator },
                { label: "被提名者", value: nominee, set: setNominee },
              ].map((f) => (
                <label key={f.label}>
                  {f.label}
                  <select
                    aria-label={f.label}
                    value={f.value}
                    onChange={(e) => {
                      f.set(e.target.value);
                      setSaved(false);
                    }}
                    required
                  >
                    <option value="">选择玩家</option>
                    {room.seats.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nickname}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {!editing &&
              warnings.map((w) => (
                <p className="muted" key={w}>
                  {w}
                </p>
              ))}
            {!editing && (
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
            <details open={!!editing}>
              <summary>{editing ? "修订票数" : "直接登记现场投票"}</summary>
              <fieldset>
                <legend>投票者 · {voters.length} 票</legend>
                <div className="seat-checkboxes">
                  {room.seats.map((s) => (
                    <label key={s.id}>
                      <input
                        type="checkbox"
                        checked={voters.includes(s.id)}
                        onChange={(e) =>
                          setVoters(
                            e.target.checked
                              ? [...voters, s.id]
                              : voters.filter((id) => id !== s.id),
                          )
                        }
                      />
                      {s.nickname}
                    </label>
                  ))}
                </div>
              </fieldset>
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
                  {editing ? "保存更正" : "保存并公开"}
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
      {room.storyteller &&
        room.pastPublicRecords.map((a) => (
          <details className="panel" key={a.gameNo}>
            <summary>第 {a.gameNo} 局公开记录</summary>
            <Timeline records={a.records} />
          </details>
        ))}
      {[...(room.pastRecaps ?? [])]
        .sort((a, b) => b.gameNo - a.gameNo)
        .map((recap) => (
          <details className="panel" key={`recap-${recap.gameNo}`}>
            <summary>第 {recap.gameNo} 局复盘</summary>
            <ResultBanner result={recap.result} />
            <RecapFacts recap={recap} />
            <RecapTimeline recap={recap} room={room} />
          </details>
        ))}
    </div>
  );
}
