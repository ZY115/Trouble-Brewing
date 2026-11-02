import { localKey, useLocalState, useUnread } from "../localState";
import Conversation from "./Conversation";
import { LockKeyhole } from "lucide-react";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
import GroupControls from "./GroupControls";
export default function ChatPanel({
  room,
  send,
}: {
  room: RoomView;
  send: Send;
}) {
  const me = room.viewer.seatId ?? "storyteller";
  const contacts = [
    ...(me !== "storyteller" ? [{ id: "storyteller", name: "说书人" }] : []),
    ...room.seats
      .filter((s) => s.id !== me)
      .map((s) => ({ id: s.id, name: `${s.number} 号` })),
    ...room.groups.map((g) => ({ id: g.id, name: g.name })),
    ...(room.evilEnabled ? [{ id: "evil", name: "邪恶队友频道" }] : []),
  ];
  const [to, setTo] = useLocalState(
    localKey(room, "chat-contact"),
    contacts[0]?.id ?? "",
  );
  const recipient = contacts.some((c) => c.id === to) ? to : "";
  const unread = useUnread(room);
  return (
    <div>
      <div className="section-title">
        <div>
          <h2>私密消息</h2>
          <p>私信仅对参与者可见。说书人看不到玩家之间的私聊。</p>
        </div>
        <LockKeyhole size={25} />
      </div>
      <GroupControls
        key={recipient}
        room={room}
        send={send}
        selected={recipient}
      />
      {!recipient && (
        <p className="notice">
          原会话已不可用，请重新选择联系人；原草稿已保留，不会转发到其他会话。
        </p>
      )}
      <div className="panel chat-layout">
        <div className="contacts">
          {contacts.map((c) => (
            <button
              className={recipient === c.id ? "active" : ""}
              key={c.id}
              onClick={() => setTo(c.id)}
            >
              <span className="contact-avatar">
                {c.id === "evil" ? "◆" : c.name.slice(0, 1)}
              </span>
              {c.name}
              {unread.contactCount(c.id) > 0 && (
                <span className="nav-count">{unread.contactCount(c.id)}</span>
              )}
            </button>
          ))}
        </div>
        <Conversation
          key={recipient}
          room={room}
          send={send}
          recipient={recipient}
        />
      </div>
    </div>
  );
}
