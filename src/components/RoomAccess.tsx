import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import type { RoomView, Session } from "../../shared/types";
import { api } from "../useRoom";
export default function RoomAccess({
  room,
  session,
}: {
  room: RoomView;
  session: Session;
}) {
  const [seat, setSeat] = useState(""),
    [link, setLink] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [base, setBase] = useState(location.origin);
  useEffect(() => {
    if (["localhost", "127.0.0.1"].includes(location.hostname))
      void api<{ addresses: string[] }>("/api/network")
        .then((x) => {
          if (x.addresses[0])
            setBase(
              `${location.protocol}//${x.addresses[0]}${location.port ? `:${location.port}` : ""}`,
            );
        })
        .catch(() => {});
  }, []);
  async function issue() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/rooms/${room.code}/recovery`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ seatId: seat }),
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.error);
      setLink(
        `${base.replace(/\/$/, "")}/join/${room.code}#recover=${encodeURIComponent(data.recoveryToken)}`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function backup() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(session)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `clocktower-host-${room.code}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <details className="room-access">
      <summary>恢复玩家 / 备份管理入口</summary>
      <p className="muted">
        恢复原身份、号码和笔记；新设备接入后旧设备失效。链接15分钟内仅可使用一次，请只给该座位本人。
      </p>
      <label>
        玩家
        <select
          aria-label="恢复玩家号码"
          value={seat}
          onChange={(e) => setSeat(e.target.value)}
        >
          <option value="">选择号码</option>
          {room.seats.map((s) => (
            <option key={s.id} value={s.id}>
              {s.number}号
            </option>
          ))}
        </select>
      </label>
      <button disabled={!seat || busy} onClick={() => void issue()}>
        生成一次性恢复二维码
      </button>
      <button onClick={backup}>下载本房间管理凭据备份</button>
      <small>备份可在另一设备的说书人入口导入，请勿发给玩家。</small>
      {error && <p role="alert">{error}</p>}
      {link && (
        <div
          className="recovery-screen"
          role="dialog"
          aria-label="玩家恢复二维码"
        >
          <h2>{room.seats.find((s) => s.id === seat)?.number}号恢复入口</h2>
          <QRCode value={link} size={240} />
          <p>15分钟内有效，使用一次后失效</p>
          <input
            aria-label="玩家恢复链接"
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button onClick={() => setLink("")}>关闭恢复二维码</button>
        </div>
      )}
    </details>
  );
}
