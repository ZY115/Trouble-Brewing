import type { RoomView } from "../shared/types";

export function acceptRoomState(
  previous: RoomView | null,
  next: RoomView,
  code: string,
) {
  return (
    next.code === code &&
    (!previous ||
      next.gameNo > previous.gameNo ||
      (next.gameNo === previous.gameNo && next.revision >= previous.revision))
  );
}

export function currentPlayerState(room: RoomView): RoomView {
  if (room.viewer.kind !== "player") return room;
  const current = {
    ...room,
    pastNotebooks: [],
    pastPublicRecords: [],
    pastRecaps: [],
    result: room.result?.gameNo === room.gameNo ? room.result : undefined,
    recap: room.recap?.gameNo === room.gameNo ? room.recap : undefined,
  };
  if (!["LOBBY", "SETUP"].includes(room.phase)) return current;
  return {
    ...current,
    actions: [],
    messages: [],
    notebook: [],
    publicRecords: [],
    groups: [],
    invitations: [],
    liveVote: undefined,
    playerWorkspace: undefined,
    result: undefined,
    recap: undefined,
    evilEnabled: false,
    evilMembers: undefined,
    self: room.self
      ? { canChangeNumber: room.self.canChangeNumber, note: "" }
      : undefined,
  };
}
