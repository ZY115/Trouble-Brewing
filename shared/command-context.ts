import type { Command } from "./commands";
import type { RoomView } from "./types";

/** Capture the state the sender actually saw, before any async send/retry. */
export function commandWithContext(command: Command, room: RoomView): Command {
  if (command.type === "next_phase" || command.type === "request_action")
    return {
      ...command,
      expectedPhaseVersion:
        command.expectedPhaseVersion ?? room.storyteller?.phaseVersion,
    };
  if (command.type === "day_timer")
    return {
      ...command,
      expectedPhaseVersion:
        command.expectedPhaseVersion ?? room.storyteller?.phaseVersion,
      expectedTimerId:
        command.expectedTimerId === undefined
          ? (room.storyteller?.dayTimer?.id ?? null)
          : command.expectedTimerId,
    };
  return command;
}
