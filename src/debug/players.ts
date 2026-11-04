import type { RoomView } from "../../shared/types";

export function debugPlayers(room: RoomView) {
  const ids = new Set(room.storyteller?.debug?.seatIds ?? []);
  return room.seats.filter(seat => ids.has(seat.id)).sort((a, b) => a.number - b.number);
}

export function nextWaitingPlayer(room: RoomView, selected: string) {
  const players = debugPlayers(room);
  if (room.phase === "DAY" && room.liveVote?.status === "COUNTING") {
    const voter = room.liveVote.order[room.liveVote.cursor];
    if (players.some(seat => seat.id === voter)) return voter;
  }
  const waiting = new Set(room.actions.filter(action =>
    ["FIRST_NIGHT", "OTHER_NIGHT"].includes(room.phase) && action.night === room.day && action.status === "REQUESTED"
  ).map(action => action.seatId));
  const index = players.findIndex(seat => seat.id === selected);
  for (let offset = 1; offset <= players.length; offset++) {
    const candidate = players[(index + offset) % players.length];
    if (waiting.has(candidate.id)) return candidate.id;
  }
  return undefined;
}

export function debugPlayerStatus(room: RoomView, seatId: string) {
  if (["LOBBY", "SETUP"].includes(room.phase)) return "等待开局";
  if (room.phase === "ENDED") return "已结束";
  const actions = room.actions.filter(a => a.seatId === seatId && a.night === room.day);
  if (["FIRST_NIGHT", "OTHER_NIGHT"].includes(room.phase)) {
    if (actions.some(a => a.status === "REQUESTED")) return "待选择";
    if (actions.some(a => ["SUBMITTED", "ST_REVIEW", "APPROVED"].includes(a.status))) return "待裁定";
    if (actions.some(a => a.status === "DELIVERED")) return "已收到反馈";
  }
  if (room.liveVote && ["OPEN", "COUNTING"].includes(room.liveVote.status))
    return room.liveVote.hands[seatId] ? "已举手" : "未举手";
  return "可操作";
}
