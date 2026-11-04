import type { ChatMessage, RoomView } from "../../shared/types";

export interface Contact {
  id: string;
  name: string;
  avatar: string;
  kind: "storyteller" | "seat" | "group" | "evil";
}

const isChannel = (id: string) => id === "evil" || id.startsWith("group:");

export function chatContacts(room: RoomView): Contact[] {
  const me = room.viewer.seatId ?? "storyteller";
  return [
    ...(me !== "storyteller" ? [{ id: "storyteller", name: "说书人", avatar: "说", kind: "storyteller" as const }] : []),
    ...[...room.seats]
      .filter((s) => s.id !== me)
      .sort((a, b) => a.number - b.number)
      .map((s) => ({ id: s.id, name: `${s.number} 号`, avatar: String(s.number), kind: "seat" as const })),
    ...room.groups.map((g) => ({ id: g.id, name: g.name, avatar: "群", kind: "group" as const })),
    ...(room.evilEnabled ? [{ id: "evil", name: "邪恶队友频道", avatar: "◆", kind: "evil" as const }] : []),
  ];
}

/** Every message between me and one contact, or in one shared channel. */
export function threadWith(room: RoomView, id: string): ChatMessage[] {
  const me = room.viewer.seatId ?? "storyteller";
  return room.messages.filter((m) =>
    isChannel(id) ? m.to === id : (m.from === me && m.to === id) || (m.from === id && m.to === me),
  );
}

export function contactName(room: RoomView, id: string) {
  return chatContacts(room).find((c) => c.id === id)?.name ?? "私聊";
}

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
