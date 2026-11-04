import { useEffect, useState } from "react";
import type { Session } from "../../shared/types";
import { debugSeatId, hostSessions, joinCode } from "../session";

export default function DebugEntry({
  onSession,
}: {
  onSession: (session: Session) => void;
}) {
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    async function enter() {
      const host = hostSessions().find((s) => s.code === joinCode);
      if (!host) throw new Error("请在同一浏览器的说书人页面打开测试玩家。");
      const response = await fetch(`/api/rooms/${joinCode}/debug/player`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${host.token}`,
        },
        body: JSON.stringify({ seatId: debugSeatId }),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "调试入口不可用");
      if (!controller.signal.aborted) onSession(result as Session);
    }
    void enter().catch((e: Error) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, [attempt, onSession]);
  return (
    <main className="access-page">
      <section className="panel access-card">
        <h1>测试玩家</h1>
        {error ? (
          <>
            <p role="alert" className="error">
              {error}
            </p>
            <button onClick={() => setAttempt((n) => n + 1)}>重试</button>
          </>
        ) : (
          <p>正在进入玩家视角…</p>
        )}
        <a href="/host">返回说书人</a>
      </section>
    </main>
  );
}
