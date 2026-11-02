import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import type { RoomView } from "../../shared/types";
import { api } from "../useRoom";

/** Join link for phones on the same Wi-Fi; localhost is swapped for the LAN address. */
export function useJoinLink(room: RoomView) {
  const [base, setBase] = useState(location.origin);
  useEffect(() => {
    if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
      void api<{ addresses: string[] }>("/api/network")
        .then(({ addresses }) => {
          if (addresses[0])
            setBase(
              `${location.protocol}//${addresses[0]}${location.port ? `:${location.port}` : ""}`,
            );
        })
        .catch(() => {});
    }
  }, []);
  let link = `${location.origin}/join/${room.code}`;
  try {
    const url = new URL(base);
    if (["http:", "https:"].includes(url.protocol))
      link = `${url.origin}/join/${room.code}`;
  } catch {
    /* Keep current origin until a valid address is entered. */
  }
  return { link, base, setBase };
}

export default function Invitation({
  room,
  onFullscreen,
}: {
  room: RoomView;
  onFullscreen?: () => void;
}) {
  const { link, base, setBase } = useJoinLink(room);
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState(false);
  return (
    <section className="panel" aria-label="入场二维码">
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div className="qr-box">
          <QRCode value={link} size={128} fgColor="#17140d" bgColor="#ece6da" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="room-code">{room.code}</span>
          <span className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
            玩家扫码后只填座位号
            <br />
            需要连同一个 Wi-Fi
          </span>
          {onFullscreen && (
            <button
              onClick={onFullscreen}
              style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
            >
              全屏展示二维码
            </button>
          )}
        </div>
      </div>
      <button
        className="wide"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
          } catch {
            setCopied(false);
            setCopyFallback(true);
          }
        }}
      >
        {copied ? "邀请链接已复制" : "复制邀请链接"}
      </button>
      {copyFallback && (
        <label className="field">
          请长按或选中复制
          <input
            aria-label="邀请链接"
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
      )}
      <details>
        <summary>手机扫不开？修改连接地址</summary>
        <p className="muted" style={{ fontSize: 13, margin: "6px 0" }}>
          如果当前为 localhost，请改为电脑的局域网地址（启动终端会显示），并保留端口。
        </p>
        <input
          aria-label="邀请链接地址"
          value={base}
          onChange={(e) => setBase(e.target.value)}
        />
        <p style={{ marginTop: 8 }}>
          <a href={link} target="_blank" rel="noreferrer">
            打开玩家入口 ↗
          </a>
        </p>
      </details>
    </section>
  );
}
