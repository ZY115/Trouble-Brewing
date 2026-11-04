import { useState } from "react";
import type { RoomView, Session } from "../../shared/types";
import type { Send } from "../useRoom";
import PhaseControls from "../components/PhaseControls";
import RoomAccess from "../components/RoomAccess";
import DebugPanel from "./DebugPanel";

export default function MoreDrawer({
  room,
  send,
  session,
  onScan,
  onLeave,
  onEnd,
}: {
  room: RoomView;
  send: Send;
  session: Session;
  onScan: () => void;
  onLeave: () => void;
  onEnd: () => void;
}) {
  const st = room.storyteller!;
  const [confirm, setConfirm] = useState<"" | "evil">("");
  const playing = ["FIRST_NIGHT", "OTHER_NIGHT", "DAY"].includes(room.phase);
  return (
    <>
      <DebugPanel room={room} send={send} />
      {playing && (
        <section className="panel">
          <h3>阶段</h3>
          <PhaseControls room={room} send={send} part="settings" />
        </section>
      )}
      <section className="panel">
        <h3>房间控制</h3>
        <div className="action-buttons">
          <button onClick={onScan}>全屏展示入场二维码</button>
          <button
            disabled={!playing}
            onClick={() =>
              st.evilReleased
                ? void send({ type: "evil_channel", enabled: false, confirm: false })
                : setConfirm("evil")
            }
          >
            {st.evilReleased ? "关闭邪恶频道" : "开放邪恶频道（线下已告知队友）"}
          </button>
          {st.endReview?.available && (
            <button className="danger-text" onClick={onEnd}>
              {st.endReview.buttonLabel}…
            </button>
          )}
        </div>
        {confirm && (
          <div className="notice" role="alert">
            <span style={{ width: "100%" }}>
              开放后，邪恶玩家可见队友名单，小恶魔可见三个假身份。确认线下信息环节已经完成？
            </span>
            <button onClick={() => setConfirm("")}>取消</button>
            <button
              className="primary"
              onClick={async () => {
                if (await send({ type: "evil_channel", enabled: true, confirm: true })) setConfirm("");
              }}
            >
              确认
            </button>
          </div>
        )}
      </section>
      <section className="panel">
        <h3>恢复玩家 · 备份管理入口</h3>
        <RoomAccess room={room} session={session} />
      </section>
      <details className="panel">
        <summary>操作日志（仅说书人）</summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[...st.events].reverse().slice(0, 120).map((e) => (
            <div key={e.id} style={{ display: "flex", gap: 10, fontSize: 13, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
              <span className="muted" style={{ flex: "none" }}>
                {new Date(e.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span>
                {e.detail}
                <span className="muted">
                  {" · "}
                  {e.actor === "storyteller" ? "说书人" : `${room.seats.find((s) => s.id === e.actor)?.number ?? "?"} 号`}
                </span>
              </span>
            </div>
          ))}
        </div>
      </details>
      <button onClick={onLeave}>返回入口（保留本房间管理凭据）</button>
    </>
  );
}
