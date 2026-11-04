import { useEffect, useRef, useState } from "react";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
import { Checks, TaskActions, TaskCard } from "./TaskCard";

const WINNER = { good: "善良", evil: "邪恶" } as const;

/** Shown at the front of the queue as soon as an ending condition is met. */
export function EndTask({ room, onEnd, onDismiss }: { room: RoomView; onEnd: () => void; onDismiss: () => void }) {
  const review = room.storyteller!.endReview!;
  const winner = review.suggestedWinner;
  return (
    <TaskCard eyebrow="结束条件" title={winner ? `${WINNER[winner]}阵营可以获胜了` : "达成了结束条件"}>
      <Checks items={review.suggestions.map((s) => ({ ok: s.status === "met", text: s.text }))} />
      <TaskActions>
        <button className="primary" onClick={onEnd}>
          结束游戏…
        </button>
        <button onClick={onDismiss}>先不结束，继续游戏</button>
      </TaskActions>
    </TaskCard>
  );
}

/**
 * One confirmation for both ways a game stops: a normal finish names the
 * winner and publishes the recap; an early stop names nobody and keeps the
 * grimoire private.
 */
export function EndGameDialog({ room, send, onClose }: { room: RoomView; send: Send; onClose: () => void }) {
  const review = room.storyteller!.endReview!;
  const dialog = useRef<HTMLDialogElement>(null);
  const met = review.suggestions.some((s) => s.status === "met");
  const [mode, setMode] = useState<"normal" | "early">(met ? "normal" : "early");
  const [winner, setWinner] = useState<"good" | "evil" | "">(review.suggestedWinner ?? "");
  const [endDay, setEndDay] = useState(false);
  const [reason, setReason] = useState("");
  const [seen, setSeen] = useState(review.key);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    if (!review.available) onClose();
  }, [review.available, onClose]);

  const dusk = room.phase === "DAY" ? review.suggestions.find((s) => s.status === "end_day") : undefined;
  const winners = [
    ...new Set(
      review.suggestions
        .filter((s) => s.status === "met" || (endDay && s.status === "end_day"))
        .map((s) => s.winner)
        .filter(Boolean),
    ),
  ];
  const agrees = winners.length === 1 && winners[0] === winner;
  const needsReason = mode === "normal" && !agrees;
  const stale = seen !== review.key;
  const ready = !busy && !stale && (mode === "early" || (!!winner && (!needsReason || !!reason.trim())));

  async function finish() {
    setBusy(true);
    const ok = await send({
      type: "finish_game",
      mode,
      winner: mode === "normal" ? (winner as "good" | "evil") : "none",
      reason: reason.trim(),
      endDay: mode === "normal" && endDay,
      confirmed: true,
      expectedReviewKey: review.key,
    });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <dialog
      ref={dialog}
      className="end-dialog"
      aria-labelledby="end-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="end-dialog-title">{met ? "结束游戏" : "提前结束本局？"}</h2>
      <Checks
        items={
          review.suggestions.length
            ? review.suggestions.map((s) => ({ ok: s.status === "met", text: s.text }))
            : [{ ok: false, text: "还没有达成任何结束条件。" }]
        }
      />

      <div className="segmented" role="group" aria-label="结束方式">
        <button aria-pressed={mode === "normal"} onClick={() => setMode("normal")}>
          按胜负结算
        </button>
        <button aria-pressed={mode === "early"} onClick={() => setMode("early")}>
          提前结束
        </button>
      </div>

      {mode === "normal" ? (
        <>
          <div className="segmented verdict" role="group" aria-label="获胜阵营">
            <button className="good" aria-pressed={winner === "good"} onClick={() => setWinner("good")}>
              善良获胜
            </button>
            <button className="evil" aria-pressed={winner === "evil"} onClick={() => setWinner("evil")}>
              邪恶获胜
            </button>
          </div>
          {dusk && (
            <label className="check-line">
              <input
                type="checkbox"
                checked={endDay}
                onChange={(e) => {
                  setEndDay(e.target.checked);
                  if (e.target.checked && !winner && dusk.winner) setWinner(dusk.winner);
                }}
              />
              今天到此结束，不再处决
            </label>
          )}
          <label className="field">
            {needsReason ? "裁定说明（与系统建议不同，必填）" : "裁定说明（可选）"}
            <textarea value={reason} maxLength={1000} rows={2} onChange={(e) => setReason(e.target.value)} />
          </label>
          <p className="task-note">结算后，所有玩家会看到身份真相和本局复盘。</p>
        </>
      ) : (
        <>
          <label className="field">
            原因（可选）
            <textarea value={reason} maxLength={1000} rows={2} onChange={(e) => setReason(e.target.value)} />
          </label>
          <p className="task-note">提前结束不判胜负，玩家看不到复盘。</p>
        </>
      )}

      {review.pendingActions > 0 && <p className="task-note">还有 {review.pendingActions} 项行动没处理完，结束后会一并取消。</p>}
      {review.activeVote && <p className="task-note">正在进行的投票会被取消。</p>}
      {stale && (
        <p className="end-stale" role="alert">
          局面刚刚有变化，请重新看一遍上面的内容。
          <button className="link-button" onClick={() => setSeen(review.key)}>
            已核对
          </button>
        </p>
      )}

      <div className="end-dialog-actions">
        <button disabled={busy} onClick={onClose}>
          取消
        </button>
        <button className={mode === "normal" ? "primary" : "danger-fill"} disabled={!ready} onClick={() => void finish()}>
          {mode === "normal" ? (winner ? `确认${WINNER[winner]}获胜` : "先选获胜阵营") : "确认提前结束"}
        </button>
      </div>
    </dialog>
  );
}
