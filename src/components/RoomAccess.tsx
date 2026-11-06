import { useEffect, useState } from "react";
import Picker, { seatOptions } from "../ui/Picker";
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
  return (
    <details className="room-access">
      <summary>给玩家恢复座位</summary>
      <p className="muted">
        给换了手机的玩家用：让他扫码，身份、号码和笔记都会回来，旧手机随即失效。15 分钟内有效，只能用一次。
      </p>
      <Picker label="玩家" value={seat} options={seatOptions(room.seats)} onChange={setSeat} placeholder="选择号码" clearable={false} />
      <button disabled={!seat || busy} onClick={() => void issue()}>
        生成一次性恢复二维码
      </button>
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
