import { useEffect, useState } from "react";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
import { useUnread } from "../localState";
import { roleName } from "../../shared/roles";
import Conversation from "../components/Conversation";
import { ActionCard } from "../components/NightPanel";

/** One timeline per player: their night actions and the private chat, side by side. */
export default function ChatDrawer({
  room,
  send,
  seatId,
  setSeatId,
}: {
  room: RoomView;
  send: Send;
  seatId: string;
  setSeatId: (id: string) => void;
}) {
  const st = room.storyteller!;
  const unread = useUnread(room);
  const seats = [...room.seats].sort((a, b) => a.number - b.number);
  // Snapshot the initial unread contact before Conversation marks it as read.
  // Read receipts and incoming messages must never change the active recipient.
  const [initialSeatId] = useState(
    () => seats.find((s) => unread.contactCount(s.id) > 0)?.id ?? seats[0]?.id,
  );
  const selected =
    seats.find((s) => s.id === seatId) ??
    seats.find((s) => s.id === initialSeatId) ??
    seats[0];
  useEffect(() => {
    if (selected && selected.id !== seatId) setSeatId(selected.id);
  }, [selected?.id, seatId, setSeatId]);
  const actions = room.actions
    .filter((a) => a.seatId === selected?.id)
    .sort((a, b) => b.night - a.night);
  const night = ["FIRST_NIGHT", "OTHER_NIGHT"].includes(room.phase);
  return (
    <div className="chat-layout">
      <div className="contacts" aria-label="玩家">
        {seats.map((s) => (
          <button
            key={s.id}
            aria-current={selected?.id === s.id}
            onClick={() => setSeatId(s.id)}
          >
            <span className="contact-avatar">{s.number}</span>
            <span>
              {roleName(st.assignments[s.id]?.actualRoleId)}
              {!s.alive && <span className="muted"> · 亡</span>}
            </span>
            {unread.contactCount(s.id) > 0 && (
              <span className="nav-count">{unread.contactCount(s.id)}</span>
            )}
          </button>
        ))}
      </div>
      {selected && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minWidth: 0,
          }}
        >
          {night && (
            <p className="notice">私聊即时送达；夜间裁定在天亮后查看。</p>
          )}
          <Conversation
            key={selected.id}
            room={room}
            send={send}
            recipient={selected.id}
          />
          {!!actions.length && (
            <details
              className="panel"
              open={actions.some((a) => a.night === room.day)}
            >
              <summary>
                {selected.number} 号的夜间行动（{actions.length}）
              </summary>
              {actions.map((a) => (
                <ActionCard key={a.id} action={a} room={room} send={send} />
              ))}
            </details>
          )}
        </div>
      )}
    </div>
  );
}
