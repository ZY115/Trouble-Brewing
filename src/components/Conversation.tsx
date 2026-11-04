import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
import { localKey, useLocalState, useUnread } from "../localState";
import { clock, threadWith } from "./chat";

/** The workbench and full chat use the same conversation and draft keys. */
export default function Conversation({
  room,
  send,
  recipient,
  compact = false,
  bare = false,
}: {
  room: RoomView;
  send: Send;
  recipient: string;
  compact?: boolean;
  /** The surrounding sheet already names the contact. */
  bare?: boolean;
}) {
  const me = room.viewer.seatId ?? "storyteller";
  const name = (id: string) =>
    id === "storyteller"
      ? "说书人"
      : `${room.seats.find((s) => s.id === id)?.number ?? "?"} 号`;
  const channel = recipient === "evil" || recipient.startsWith("group:");
  const messages = threadWith(room, recipient);
  const title =
    recipient === "evil"
      ? "邪恶队友频道"
      : (room.groups.find((g) => g.id === recipient)?.name ??
        (recipient ? name(recipient) : "请选择联系人"));
  const [content, setContent, clearContent] = useLocalState(
    localKey(room, `chat-draft:${recipient}`),
    "",
  );
  const [busy, setBusy] = useState(false);
  const unread = useUnread(room);
  const container = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const messageKey = messages.map((m) => m.id).join(",");
  useLayoutEffect(() => {
    if (pinned.current && container.current)
      container.current.scrollTop = container.current.scrollHeight;
  }, [messageKey]);
  useEffect(() => {
    // Only messages actually visible in an open, visible pane become read.
    const observer = new IntersectionObserver((entries) => {
      if (document.visibilityState !== "visible") return;
      const ids = entries
        .filter((e) => e.isIntersecting)
        .map((e) => (e.target as HTMLElement).dataset.messageId!)
        .filter(Boolean);
      if (ids.length) unread.markMessages(ids);
    });
    const observe = () => {
      observer.disconnect();
      if (document.visibilityState === "visible")
        container.current
          ?.querySelectorAll("[data-message-id]")
          .forEach((el) => observer.observe(el));
    };
    observe();
    document.addEventListener("visibilitychange", observe);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", observe);
    };
  }, [messageKey, recipient]);
  return (
    <section
      className={`conversation ${compact ? "compact-conversation" : ""}`}
      aria-label={`与${title}的私聊`}
    >
      {!bare && (
        <div className="conversation-header">
          {compact ? "私聊" : title}
          {unread.contactCount(recipient) > 0 && (
            <span className="nav-count">{unread.contactCount(recipient)}</span>
          )}
        </div>
      )}
      <div
        className="messages"
        ref={container}
        onScroll={() => {
          const el = container.current;
          if (el)
            pinned.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 36;
        }}
      >
        {messages.length ? (
          messages.map((m) => (
            <div
              data-message-id={m.id}
              key={m.id}
              className={`message ${m.from === me ? "mine" : ""}`}
            >
              <small>
                {channel && m.from !== me ? `${name(m.from)} · ` : ""}
                {clock(m.createdAt)}
              </small>
              <p>{m.content}</p>
            </div>
          ))
        ) : (
          <p className="muted messages-empty">还没有消息</p>
        )}
      </div>
      <form
        className="composer"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !recipient || !content.trim()) return;
          setBusy(true);
          if (await send({ type: "send_message", to: recipient, content }))
            clearContent();
          setBusy(false);
        }}
      >
        <input
          disabled={busy || !recipient || room.phase === "ENDED"}
          aria-label={compact ? `给${title}的私聊` : "私信内容"}
          maxLength={2000}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={compact ? "单独确认或补充说明" : `发给 ${title}`}
        />
        <button
          className="primary"
          disabled={
            busy || !recipient || !content.trim() || room.phase === "ENDED"
          }
          aria-label={compact ? `发送给${title}的私聊` : "发送私信"}
        >
          发送
        </button>
      </form>
    </section>
  );
}
