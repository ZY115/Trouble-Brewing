import { useEffect, useState, type FormEvent } from "react";
import { api } from "../useRoom";
import { isHostEntry, joinCode, loadSession, hostSessions } from "../session";
import type { RoomView, Session } from "../../shared/types";
type Discovery = Pick<
  RoomView,
  "code" | "title" | "capacity" | "phase" | "registration"
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
  const savedHosts = hostSessions();
  const recovery = new URLSearchParams(location.hash.slice(1)).get("recover");
  const [backup, setBackup] = useState("");
  async function restoreBackup() {
    setBusy(true);
    setError("");
    try {
      const s = JSON.parse(backup) as Session;
      if (!/^[A-Z2-9]{6}$/.test(s.code) || typeof s.token !== "string")
        throw Error("备份格式不正确");
      const res = await fetch(`/api/rooms/${s.code}/state`, {
        headers: { Authorization: `Bearer ${s.token}` },
      });
      const v = await res.json();
      if (!res.ok || v.viewer?.kind !== "storyteller")
        throw Error("不是有效的说书人管理凭据");
      onSession(s);
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
          isHostEntry ? { capacity } : { number: Number(number) },
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
            {!!savedHosts.length && (
              <section>
                <h2>继续已有房间</h2>
                {savedHosts.map((s) => (
                  <button
                    className="primary wide"
                    key={s.code}
                    onClick={() => onSession(s)}
                  >
                    返回房间 {s.code}
                  </button>
                ))}
              </section>
            )}
            <details open={!savedHosts.length}>
              <summary>创建新房间</summary>
              <p>创建新房间不会覆盖已有房间的管理凭据。</p>
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
            <details>
              <summary>从管理备份恢复</summary>
              <input
                type="file"
                accept=".json"
                aria-label="导入管理凭据备份"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void file.text().then(setBackup);
                }}
              />
              <textarea
                aria-label="管理凭据备份内容"
                value={backup}
                onChange={(e) => setBackup(e.target.value)}
              />
              <button
                disabled={busy || !backup}
                onClick={() => void restoreBackup()}
              >
                验证并恢复管理入口
              </button>
            </details>
            <small>开放入场后分享二维码。满员且号码不重复时自动发身份。</small>
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
                <label className="field">
                  你的座位号
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={room?.capacity ?? 13}
                    step={1}
                    required
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    placeholder={room ? `1–${room.capacity}` : "输入座位号"}
                  />
                </label>
                <button
                  className="primary wide"
                  disabled={busy || !room?.registration.open || !number}
                >
                  提交号码
                </button>
              </form>
            )}
            {room && (
              <p>
                {!["LOBBY", "SETUP"].includes(room.phase)
                  ? "本局已开始。换设备或清除数据后，请说书人为你的原座位签发恢复二维码。"
                  : !room.registration.open
                    ? "说书人正在准备配板，请等待开放入场。"
                    : `已登记 ${room.registration.joined} / ${room.capacity} 人。请填写自己的实际座位号。`}
              </p>
            )}
          </>
        ) : (
          <p>请扫描说书人提供的房间二维码。此页面不提供角色选择。</p>
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
