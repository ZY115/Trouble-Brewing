import { useEffect, useState, type FormEvent } from "react";
import { api } from "../useRoom";
import { isHostEntry, joinCode, loadSession, hostSessions } from "../session";
import type { RoomView, Session } from "../../shared/types";
type Latest = { code: string; capacity: number; phase: RoomView["phase"]; day: number; activeAt: number };
const stage = (l: Latest) =>
  l.phase === "LOBBY" || l.phase === "SETUP"
    ? "还没开局"
    : l.phase === "FIRST_NIGHT"
      ? "首夜"
      : l.phase === "DAY"
        ? `第 ${l.day} 天`
        : `第 ${l.day} 夜`;
const ago = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60000);
  return !at ? "" : minutes < 1 ? "刚刚" : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.round(minutes / 60)} 小时前` : `${Math.round(minutes / 1440)} 天前`;
};
type Discovery = Pick<
  RoomView,
  "code" | "title" | "capacity" | "phase" | "registration" | "gameNo"
>;
export default function Entry({
  onSession,
}: {
  onSession: (value: Session) => void;
}) {
  const [capacity, setCapacity] = useState(12);
  const [number, setNumber] = useState("");
  const [room, setRoom] = useState<Discovery | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const previous = loadSession();
  const recovery = new URLSearchParams(location.hash.slice(1)).get("recover");
  const linkGame = Number(new URLSearchParams(location.search).get("g")) || undefined;
  const staleLink = !!room && !!linkGame && room.gameNo !== linkGame;
  const [latest, setLatest] = useState<Latest | null | undefined>(undefined);
  useEffect(() => {
    if (!isHostEntry) return;
    api<Latest | null>("/api/host/latest", { sessions: hostSessions(), resume: false })
      .then(setLatest)
      .catch(() => setLatest(null));
  }, []);
  async function resume() {
    setBusy(true);
    setError("");
    try {
      onSession(await api<Session>("/api/host/latest", { sessions: hostSessions(), resume: true }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function recover() {
    setBusy(true);
    setError("");
    try {
      const s = await api<Session>(`/api/rooms/${joinCode}/recover`, {
        recoveryToken: recovery,
      });
      history.replaceState(null, "", location.pathname);
      onSession(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (isHostEntry || !joinCode) return;
    let cancelled = false;
    const refresh = () =>
      void api<Discovery>(`/api/rooms/${joinCode}`)
        .then((value) => {
          if (!cancelled) {
            setRoom(value);
            setError("");
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onSession(
        await api<Session>(
          isHostEntry ? "/api/host/rooms" : `/api/rooms/${joinCode}/join`,
          isHostEntry ? { capacity } : { number: Number(number), ...(linkGame ? { gameNo: linkGame } : {}) },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="access-page">
      <section className="panel access-card">
        <h1>{isHostEntry ? "暗流涌动 · 说书人" : "暗流涌动 · 玩家登记"}</h1>
        {isHostEntry ? (
          <>
            <section className="resume">
              <h2>继续上一局</h2>
              {latest === undefined ? (
                <p className="muted">正在查找…</p>
              ) : latest ? (
                <button className="primary wide" disabled={busy} onClick={() => void resume()}>
                  继续：房间 {latest.code} · {latest.capacity} 人 · {stage(latest)}
                  {ago(latest.activeAt) && <small> · {ago(latest.activeAt)}</small>}
                </button>
              ) : (
                <p className="muted">没有未完成的对局</p>
              )}
            </section>
            <details open={latest === null}>
              <summary>创建新房间</summary>
              <form onSubmit={submit}>
                <label className="field">玩家人数（不含说书人）</label>
                <div className="count-picker">
                  {[10, 11, 12, 13].map((n) => (
                    <button
                      type="button"
                      key={n}
                      aria-pressed={capacity === n}
                      className={capacity === n ? "selected" : ""}
                      onClick={() => setCapacity(n)}
                    >
                      {n} 人
                    </button>
                  ))}
                </div>
                <button className="primary wide" disabled={busy}>
                  创建房间
                </button>
              </form>
            </details>
            <small>人齐且号码不重复后自动发身份。</small>
          </>
        ) : joinCode ? (
          <>
            <p>
              房间 {joinCode}
              {room ? ` · ${room.capacity} 人` : ""}
            </p>
            {recovery ? (
              <button
                className="primary wide"
                disabled={busy}
                onClick={() => void recover()}
              >
                恢复我的原座位
              </button>
            ) : previous ? (
              <button
                className="primary wide"
                onClick={() => onSession(previous)}
              >
                返回已登记的房间
              </button>
            ) : (
              <form onSubmit={submit}>
                {staleLink && (
                  <p role="alert" className="error">
                    已经开了新的一局，请重新扫说书人屏幕上的二维码。
                  </p>
                )}
                <span className="field">你坐在几号？</span>
                <div className="join-numbers" role="group" aria-label="你的座位号">
                  {Array.from({ length: room?.capacity ?? 12 }, (_, i) => i + 1).map((n) => {
                    const taken = !!room && !room.registration.missingNumbers.includes(n);
                    return (
                      <button
                        type="button"
                        key={n}
                        className={taken ? "taken" : ""}
                        aria-pressed={number === String(n)}
                        onClick={() => setNumber(String(n))}
                      >
                        {n}
                        {taken && <small>已有人</small>}
                      </button>
                    );
                  })}
                </div>
                <button
                  className="primary wide"
                  disabled={busy || staleLink || !room?.registration.open || !number}
                >
                  {number ? `我是 ${number} 号` : "先点你的座位号"}
                </button>
              </form>
            )}
            {room && (
              <p>
                {!["LOBBY", "SETUP"].includes(room.phase)
                  ? "本局已经开始。换了手机或清过数据，请找说书人要恢复二维码。"
                  : !room.registration.open
                    ? "说书人正在配板，稍后开放入场。"
                    : `已登记 ${room.registration.joined} / ${room.capacity} 人。`}
              </p>
            )}
          </>
        ) : (
          <p>请扫说书人屏幕上的二维码入场。</p>
        )}
        {error && (
          <div className="error inline" role="alert">
            {error}
          </div>
        )}
      </section>
    </main>
  );
}
