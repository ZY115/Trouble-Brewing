import type { NightAction, RoomView } from "../../shared/types";
import { choiceSentence } from "../../shared/action-choice";
import { nightMessages, revealedActions } from "./visibility";

export interface InformationItem {
  key: string;
  night: number;
  head: string;
  body: string;
  note: string;
  timestamp: number;
  history: NonNullable<NightAction["responseHistory"]>;
}

export function informationItems(room: RoomView): InformationItem[] {
  const items: InformationItem[] = [
    ...revealedActions(room).map((a) => ({
      key: `action:${a.id}`,
      night: a.night,
      head: a.targets.length
        ? choiceSentence(a, room.seats, a.targets, "")
        : "说书人给你的信息",
      body: a.response ?? "",
      note:
        (a.responseVersion ?? 1) > 1
          ? `已更正${a.responseHistory?.at(-1)?.reason ? `：${a.responseHistory.at(-1)!.reason}` : ""}`
          : "",
      timestamp: Date.parse(a.responseHistory?.at(-1)?.sentAt ?? "") || 0,
      history: a.responseHistory ?? [],
    })),
    ...nightMessages(room)
      .filter((m) => m.atNight)
      .map((m) => ({
        key: `message:${m.id}`,
        night: m.night,
        head: "说书人私信",
        body: m.text,
        note: "",
        timestamp: Date.parse(m.createdAt) || 0,
        history: [],
      })),
  ];
  // Reverse first so legacy responses without timestamps still show newest first.
  return items
    .reverse()
    .sort((a, b) => b.night - a.night || b.timestamp - a.timestamp);
}

export function MyInfo({ room }: { room: RoomView }) {
  const items = informationItems(room);
  if (!items.length)
    return (
      <span className="pl-small">
        还没有收到信息。
      </span>
    );
  return (
    <>
      {items.slice(0, 6).map((i) => (
        <div
          key={i.key}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            paddingBottom: 6,
          }}
        >
          <span className="pl-small">
            第 {i.night} 夜 · {i.head}
          </span>
          <span className="role-name" style={{ fontSize: 22 }}>
            {i.body}
          </span>
          {i.note && <span className="pl-small">{i.note}</span>}
        </div>
      ))}
      {items.length > 6 && (
        <span className="pl-small">
          共 {items.length} 条，可在菜单查看完整信息记录。
        </span>
      )}

    </>
  );
}

export default function InformationHistory({ room }: { room: RoomView }) {
  const items = informationItems(room);
  return (
    <>
      {!items.length && <div className="pl-card">还没有可查看的信息。</div>}
      {items.map((i) => (
        <section className="pl-card" key={i.key}>
          <span className="pl-small">
            第 {i.night} 夜 · {i.head}
          </span>
          <span style={{ whiteSpace: "pre-wrap" }}>{i.body}</span>
          {i.note && <span className="pl-small">{i.note}</span>}
          {i.history.length > 1 && (
            <details>
              <summary>更正历史（{i.history.length - 1} 次）</summary>
              <div className="pl-list">
                {[...i.history].reverse().map((h) => (
                  <div
                    key={h.version}
                    style={{
                      flexDirection: "column",
                      alignItems: "flex-start",
                      gap: 2,
                    }}
                  >
                    <span className="pl-small">
                      版本 {h.version}
                      {h.reason ? ` · ${h.reason}` : ""}
                    </span>
                    <span style={{ whiteSpace: "pre-wrap" }}>{h.response}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      ))}

    </>
  );
}
