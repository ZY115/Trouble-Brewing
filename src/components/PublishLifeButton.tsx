import { useState } from "react";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";

export default function PublishLifeButton({
  room,
  send,
  seatIds,
  label,
  primary = false,
}: {
  room: RoomView;
  send: Send;
  seatIds: string[];
  label: string;
  primary?: boolean;
}) {
  const st = room.storyteller!;
  const snapshot = () => ({
    ids: seatIds,
    context: st.contextVersion,
    phase: st.phaseVersion,
    lines: seatIds.map((id) => {
      const seat = room.seats.find((s) => s.id === id)!;
      return `${seat.number} 号${seat.alive ? "存活" : "死亡"}`;
    }),
  });
  const [review, setReview] = useState<ReturnType<typeof snapshot> | null>(null);
  const [busy, setBusy] = useState(false);
  if (!review)
    return (
      <button className={primary ? "primary" : ""} onClick={() => setReview(snapshot())}>
        {label}
      </button>
    );
  const stale =
    review.context !== st.contextVersion || review.phase !== st.phaseVersion || review.ids.join() !== seatIds.join();
  return (
    <div className="publish-confirm" role="group" aria-label="确认公布生死">
      <p className="task-note">
        {stale ? "状态刚刚有变化，请重新核对。" : "公开后只能更正，不能收回。"}
      </p>
      {stale ? (
        <button className={primary ? "primary" : ""} onClick={() => setReview(snapshot())}>
          重新核对
        </button>
      ) : (
        <button
          className={primary ? "primary" : ""}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              if (await send({ type: "publish_life", seatIds: review.ids, expectedContextVersion: review.context }))
                setReview(null);
            } finally {
              setBusy(false);
            }
          }}
        >
          确认公布：{review.lines.join("、")}
        </button>
      )}
      <button disabled={busy} onClick={() => setReview(null)}>
        取消
      </button>
    </div>
  );
}
