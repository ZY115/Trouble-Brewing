import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
import { useUnread } from "../localState";
import Conversation from "./Conversation";
import GroupControls from "./GroupControls";
import { chatContacts, clock, threadWith } from "./chat";

/**
 * Chat opens on a list of conversations, newest first, the way WeChat does:
 * whoever wrote last is at the top with an unread count, no matter their seat.
 * Every number stays one tap away underneath for starting a new conversation.
 */
export default function ChatPanel({
  room,
  send,
  recipient,
  onOpen,
}: {
  room: RoomView;
  send: Send;
  recipient: string;
  onOpen: (id: string) => void;
}) {
  const me = room.viewer.seatId ?? "storyteller";
  const unread = useUnread(room);
  const contacts = chatContacts(room);

  if (recipient && contacts.some((c) => c.id === recipient))
    return (
      <div className="thread">
        <GroupControls room={room} send={send} selected={recipient} part="group" />
        <Conversation key={recipient} room={room} send={send} recipient={recipient} bare />
      </div>
    );

  const threads = contacts
    .map((c) => ({ ...c, last: threadWith(room, c.id).at(-1), count: unread.contactCount(c.id) }))
    .filter((t) => t.last)
    .sort((a, b) => Date.parse(b.last!.createdAt) - Date.parse(a.last!.createdAt));
  const unreadTotal = threads.reduce((n, t) => n + t.count, 0);
  const sender = (from: string) =>
    from === me ? "我：" : from === "storyteller" ? "说书人：" : `${room.seats.find((s) => s.id === from)?.number ?? "?"} 号：`;

  return (
    <>
      <GroupControls room={room} send={send} selected="" part="invites" />
      <section className="inbox" aria-label="会话">
        <div className="inbox-head">
          <span className="note-label">会话</span>
          {unreadTotal > 0 && <span className="inbox-total">{unreadTotal} 条未读</span>}
        </div>
        {threads.length ? (
          threads.map((t) => (
            <button key={t.id} className={`inbox-row${t.count ? " unread" : ""}`} onClick={() => onOpen(t.id)}>
              <span className={`inbox-avatar ${t.kind}`}>{t.avatar}</span>
              <span className="inbox-main">
                <span className="inbox-line">
                  <b>{t.name}</b>
                  <time>{clock(t.last!.createdAt)}</time>
                </span>
                <span className="inbox-line">
                  <span className="inbox-preview">
                    {t.kind === "seat" || t.kind === "storyteller" ? (t.last!.from === me ? "我：" : "") : sender(t.last!.from)}
                    {t.last!.content}
                  </span>
                  {t.count > 0 && <span className="inbox-count">{t.count}</span>}
                </span>
              </span>
            </button>
          ))
        ) : (
          <p className="inbox-empty">还没有私聊。点下面的号码开始。</p>
        )}
      </section>
      <section className="inbox-start" aria-label="发起私聊">
        <span className="note-label">找人私聊</span>
        <div className="inbox-numbers">
          {contacts.map((c) => (
            <button key={c.id} className={c.kind === "seat" ? "" : "wide"} onClick={() => onOpen(c.id)}>
              {c.kind === "seat" ? c.avatar : c.name}
            </button>
          ))}
        </div>
        <GroupControls room={room} send={send} selected="" part="create" />
        <p className="inbox-note">私信只有双方能看到，说书人也看不到玩家之间的私聊。</p>
      </section>
    </>
  );
}
