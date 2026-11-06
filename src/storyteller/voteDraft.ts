import type { LiveVote, RoomView } from "../../shared/types";
import { localKey } from "../localState";
import { butlerWarning } from "./rules";

export const voteEditKey = (room: RoomView, voteId: string) => localKey(room, `vote-edit:${voteId}`);

export type VoteEdits = Record<string, boolean>;

export function draftVotes(room: RoomView, vote: LiveVote, edits: VoteEdits) {
  const eligible = (id: string) => vote.eligibleAtVote?.includes(id) ?? true;
  const phone = (id: string) => !!vote.counted[id];
  const votes = (id: string) => eligible(id) && (edits[id] ?? phone(id));
  const butler: Record<string, string> = {};
  for (const id of vote.order) {
    const note = butlerWarning(room, id, votes);
    if (note) butler[id] = note;
  }
  return {
    votes,
    eligible,
    butler,
    changed: (id: string) => votes(id) !== !!vote.hands[id],
    voters: vote.order.filter(votes),
    toggle: (id: string): VoteEdits => {
      const next = { ...edits };
      const value = !votes(id);
      if (value === phone(id)) delete next[id];
      else next[id] = value;
      return next;
    },
  };
}
