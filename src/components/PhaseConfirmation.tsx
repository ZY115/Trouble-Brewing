import { useEffect, useRef, useState } from "react";
import { phaseReview } from "../../shared/phase-review";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
import { markAdvance } from "../storyteller/phaseIntent";

export default function PhaseConfirmation({
  room,
  publishLifeOnDawn,
  send,
  onClose,
}: {
  room: RoomView;
  publishLifeOnDawn: boolean;
  send: Send;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const snapshot = () => ({
    review: phaseReview(room, publishLifeOnDawn),
    phase: room.phase,
    day: room.day,
    version: room.storyteller!.phaseVersion,
  });
  const [reviewed, setReviewed] = useState(snapshot);
  const stale =
    reviewed.review.key !== phaseReview(room, publishLifeOnDawn).key;
  const active = ["FIRST_NIGHT", "OTHER_NIGHT", "DAY"].includes(room.phase);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="phase-confirmation"
      aria-labelledby="phase-confirmation-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="phase-confirmation-title">
        {reviewed.phase === "DAY" ? "确认进入下一夜？" : "确认宣布天亮？"}
      </h2>
      <p>
        当前：第 {reviewed.day} {reviewed.phase === "DAY" ? "天" : "夜"}
      </p>
      <ul>
        {reviewed.review.lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {stale ? (
        <p role="alert">情况有变化，请重新核对。</p>
      ) : (
        reviewed.phase !== "DAY" &&
        !reviewed.review.blocked && (
          <p className="muted">
            以上只是提醒，确认后照常推进。
          </p>
        )
      )}
      <div className="action-buttons">
        <button autoFocus disabled={busy} onClick={onClose}>
          取消，返回检查
        </button>
        {stale && active ? (
          <button disabled={busy} onClick={() => setReviewed(snapshot())}>
            重新核对最新状态
          </button>
        ) : (
          <button
            className="primary"
            disabled={busy || stale || !active || reviewed.review.blocked}
            onClick={async () => {
              setBusy(true);
              try {
                if (
                  await markAdvance(
                    reviewed.version,
                    send({
                      type: "next_phase",
                      expectedPhaseVersion: reviewed.version,
                      expectedReviewKey: reviewed.review.key,
                      publishLifeOnDawn,
                    }),
                  )
                )
                  onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {reviewed.phase === "DAY" ? "确认进入下一夜" : "确认宣布天亮"}
          </button>
        )}
      </div>
    </dialog>
  );
}
