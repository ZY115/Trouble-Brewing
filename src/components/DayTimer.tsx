import { useEffect, useState } from "react";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";

export default function DayTimer({
  room,
  send,
}: {
  room: RoomView;
  send: Send;
}) {
  const timer = room.storyteller?.dayTimer;
  const [now, setNow] = useState(Date.now());
  const [minutes, setMinutes] = useState(5);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (room.phase !== "DAY" || timer?.endsAt == null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [room.phase, timer?.endsAt]);
  if (!room.storyteller || room.phase !== "DAY") return null;
  const left = timer
    ? Math.max(
        0,
        Math.ceil(
          (timer.endsAt === null ? timer.remainingMs : timer.endsAt - now) /
            1000,
        ),
      )
    : 0;
  const expired = !!timer && left === 0;
  async function act(operation: "start" | "pause" | "resume" | "clear") {
    setBusy(true);
    await send({
      type: "day_timer",
      operation,
      ...(operation === "start" ? { seconds: minutes * 60 + seconds } : {}),
    });
    setNow(Date.now());
    setBusy(false);
  }
  return (
    <section
      className={`day-timer ${expired ? "expired" : ""}`}
      aria-label="白天倒计时"
    >
      <div className="timer-status">
        <strong>
          {timer
            ? `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`
            : "白天计时"}
        </strong>
        {expired ? (
          <span role="alert">时间到 · 可继续讨论，游戏不会自动推进</span>
        ) : (
          <span>{timer?.endsAt === null ? "已暂停 · " : ""}仅提醒说书人</span>
        )}
      </div>
      <div className="action-buttons">
        {timer && !expired && (
          <button
            disabled={busy}
            onClick={() => void act(timer.endsAt === null ? "resume" : "pause")}
          >
            {timer.endsAt === null ? "继续计时" : "暂停计时"}
          </button>
        )}
        {timer && (
          <button disabled={busy} onClick={() => void act("clear")}>
            清除提醒
          </button>
        )}
        <details>
          <summary>{timer ? "重新设置" : "设置倒计时"}</summary>
          <form
            className="timer-form"
            onSubmit={(e) => {
              e.preventDefault();
              void act("start");
            }}
          >
            <label>
              分钟
              <input
                aria-label="倒计时分钟"
                type="number"
                min={0}
                max={180}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              />
            </label>
            <label>
              秒
              <input
                aria-label="倒计时秒"
                type="number"
                min={0}
                max={59}
                value={seconds}
                onChange={(e) => setSeconds(Number(e.target.value))}
              />
            </label>
            <button
              disabled={
                busy ||
                minutes * 60 + seconds < 1 ||
                minutes * 60 + seconds > 10800
              }
            >
              开始提醒计时
            </button>
          </form>
        </details>
      </div>
    </section>
  );
}
