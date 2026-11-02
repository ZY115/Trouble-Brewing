import ExecutionControl from "./ExecutionControl";
import { currentVoteRecord, latestVoteRecord } from "../../shared/vote-display";
import { useEffect, useRef, useState } from "react";
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
  const [busy, setBusy] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const [reason, setReason] = useState("");
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const pause = () => setAutomatic(false);
    document.addEventListener("visibilitychange", pause);
    window.addEventListener("blur", pause);
    return () => {
      document.removeEventListener("visibilitychange", pause);
      window.removeEventListener("blur", pause);
    };
  }, []);
  useEffect(() => {
    if (!automatic || !vote || vote.status !== "COUNTING") return;
    const timer = window.setTimeout(async () => {
      if (
        !(await sendRef.current({
          type: "count_vote",
          voteId: vote.id,
          cursor: vote.cursor,
        }))
      )
        setAutomatic(false);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [automatic, vote?.id, vote?.cursor, vote?.status]);
  const latest = latestVoteRecord(room.publicRecords);
  if (!vote || !["OPEN", "COUNTING"].includes(vote.status))
    return latest ? (
      <section className="panel live-voting">
        {vote?.status === "CANCELLED" && (
          <p className="muted">手机投票已取消，以下为最近已记录的投票。</p>
        )}
        <h3>
          {latest.seatNumbers?.[latest.nominator!] ??
            room.seats.find((s) => s.id === latest.nominator)?.number}{" "}
          号提名{" "}
          {latest.seatNumbers?.[latest.nominee!] ??
            room.seats.find((s) => s.id === latest.nominee)?.number}{" "}
          号
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
  const active = ["OPEN", "COUNTING"].includes(vote.status);
  const name = (id: string) =>
    room.seats.find((s) => s.id === id)?.nickname ?? "玩家";
  const me = room.viewer.seatId!;
  const self = room.seats.find((s) => s.id === me);
  const locked = me in vote.counted;
  const eligible = self?.alive || self?.deadVoteAvailable;
  async function act(c: Parameters<Send>[0]) {
    setBusy(true);
    const ok = await send(c);
    setBusy(false);
    return ok;
  }
  return (
    <section className="panel live-voting">
      <h3>
        {name(vote.nominator)} 提名 {name(vote.nominee)}
      </h3>
      <p>
        {vote.status === "FINISHED"
          ? "计票完成，已自动记录"
          : vote.status === "CANCELLED"
            ? "本次投票已取消"
            : vote.status === "OPEN"
              ? "等待开始计票，可举手或放下"
              : `正在计 ${name(vote.order[vote.cursor])} 的票 · ${vote.cursor} / ${vote.order.length}`}
      </p>
      <p>
        已计{" "}
        {(vote.status === "FINISHED"
          ? currentVoteRecord(vote, room.publicRecords)?.voters?.length
          : undefined) ??
          Object.values(vote.counted).filter(Boolean).length}{" "}
        票
        {active && (
          <> · 当前举手 {Object.values(vote.hands).filter(Boolean).length} 人</>
        )}
      </p>
      {!room.storyteller && active && (
        <div className="action-buttons">
          <button
            className="primary"
            aria-pressed={!!vote.hands[me]}
            disabled={busy || locked || !eligible}
            onClick={() =>
              void act({
                type: "raise_hand",
                voteId: vote.id,
                raised: !vote.hands[me],
              })
            }
          >
            {locked ? "你的票已计入" : vote.hands[me] ? "放下手" : "举手投票"}
          </button>
          {!eligible && <small>死者票已用；如需更正请联系说书人。</small>}
        </div>
      )}
      {room.storyteller && active && (
        <>
          <div className="action-buttons">
            {vote.status === "OPEN" && (
              <button
                disabled={busy}
                onClick={() =>
                  void act({ type: "start_count", voteId: vote.id })
                }
              >
                开始手动计票
              </button>
            )}
            {vote.status === "COUNTING" && (
              <button
                disabled={busy || automatic}
                onClick={() =>
                  void act({
                    type: "count_vote",
                    voteId: vote.id,
                    cursor: vote.cursor,
                  })
                }
              >
                计入 {name(vote.order[vote.cursor])} 并继续
              </button>
            )}
            <button
              disabled={busy}
              onClick={async () => {
                if (automatic) setAutomatic(false);
                else if (
                  vote.status === "COUNTING" ||
                  (await act({ type: "start_count", voteId: vote.id }))
                )
                  setAutomatic(true);
              }}
            >
              {automatic ? "暂停自动计票" : "自动逐座计票（每人 3 秒）"}
            </button>
          </div>
          <p className="muted">
            号码按顺时针排列，从被提名者下一号开始。计到某人时锁定该票；计完自动记账，不自动处决。离开此页会暂停自动计票。
          </p>
          {vote.status === "COUNTING" && !automatic && (
            <details>
              <summary>当前玩家按现场举手代录</summary>
              <div className="action-buttons">
                <button
                  disabled={busy}
                  onClick={() =>
                    void act({
                      type: "count_vote",
                      voteId: vote.id,
                      cursor: vote.cursor,
                      offlineVote: true,
                    })
                  }
                >
                  现场举手 · 计 1 票
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act({
                      type: "count_vote",
                      voteId: vote.id,
                      cursor: vote.cursor,
                      offlineVote: false,
                    })
                  }
                >
                  现场未举手 · 计 0 票
                </button>
              </div>
            </details>
          )}
          <details>
            <summary>取消 / 强制执行本次提名</summary>
            <label className="field">
              公开原因
              <input
                aria-label="提名裁定原因"
                value={reason}
                maxLength={200}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {vote.status === "OPEN" && (
              <button
                disabled={busy || !reason.trim()}
                onClick={() =>
                  void act({
                    type: "force_nomination",
                    voteId: vote.id,
                    reason,
                  })
                }
              >
                强制进入计票
              </button>
            )}
            <button
              disabled={busy || !reason.trim()}
              onClick={async () => {
                setAutomatic(false);
                await act({ type: "cancel_vote", voteId: vote.id, reason });
              }}
            >
              确认取消投票
            </button>
          </details>
        </>
      )}
      {room.storyteller && (
        <ExecutionControl room={room} seatId={vote.nominee} send={send} />
      )}
    </section>
  );
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
      <p className="muted">
        计票会自动记录死者票消耗。线下处理或历史记录有误时可在这里更正。
      </p>
      <label className="field">
        玩家
        <select
          aria-label="更正死者票玩家"
          value={seatId}
          onChange={(e) => setSeatId(e.target.value)}
        >
          <option value="">选择玩家</option>
          {room.seats
            .filter((s) => !s.alive)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.nickname} · {s.deadVoteAvailable ? "可用" : "已用"}
              </option>
            ))}
        </select>
      </label>
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
