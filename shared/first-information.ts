import type { NightAction, RoomView } from "./types";
import { roleById } from "./roles";
export function firstInformationTeam(role: string) {
  return role === "washerwoman"
    ? "townsfolk"
    : role === "librarian"
      ? "outsider"
      : role === "investigator"
        ? "minion"
        : null;
}
export function randomFirstInformation(
  room: RoomView,
  action: NightAction,
  random: () => number = Math.random,
) {
  const team = firstInformationTeam(action.referenceRoleId ?? "");
  if (!team || !room.storyteller) return null;
  const others = room.seats.filter((s) => s.id !== action.seatId);
  const candidates = others.filter(
    (s) =>
      roleById(room.storyteller!.assignments[s.id]?.actualRoleId)?.team ===
      team,
  );
  if (!candidates.length) return null;
  const truth = candidates[Math.floor(random() * candidates.length)];
  const wrong = others.filter((s) => s.id !== truth.id);
  if (!wrong.length) return null;
  const targets = [truth.id, wrong[Math.floor(random() * wrong.length)].id];
  if (random() < 0.5) targets.reverse();
  return {
    targets,
    roleId: room.storyteller.assignments[truth.id].actualRoleId,
  };
}
