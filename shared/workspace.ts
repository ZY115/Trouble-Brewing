import type { NightAction, NoteRevision, PublicSeat } from "./types";

export interface DeliveredResult {
  actionId: string;
  night: number;
  prompt: string;
  targets: string[];
  response: string;
  version: number;
  /** Missing only for legacy results that predate delivery timestamps. */
  sentAt?: string;
  history: NonNullable<NightAction["responseHistory"]>;
}
export interface NoteSummary {
  entryId: string;
  kind: "text" | "claim";
  target: string;
  latest: NoteRevision;
}
export interface PlayerWorkspace {
  /** Delivered immediately, including the current night; never draft rulings. */
  results: DeliveredResult[];
  notebook: {
    defaultDate: { day: number; period: "DAY" | "NIGHT" };
    seats: {
      seat: PublicSeat;
      notes: NoteSummary[];
      /** Separate what they claimed from what I suspect. Never real assignments. */
      claimed?: NoteSummary;
      suspected?: NoteSummary;
    }[];
    general: NoteSummary[];
    archived: NoteSummary[];
  };
}
export type WorkStatus =
  | "unstarted"
  | "manual"
  | "waiting"
  | "ruling"
  | "completed";
export interface NightWorkItem {
  planItemId?: string;
  actionId?: string;
  seatId?: string;
  prompt: string;
  status: WorkStatus;
}
export interface StorytellerWorkbench {
  /** Current night only, in the actual editable plan order, then custom actions. */
  nightQueue: NightWorkItem[];
  counts: Record<WorkStatus, number>;
  nextRulingActionId?: string;
  /** Same player card for structured actions and direct chat; sorted by number. */
  seats: {
    seatId: string;
    number: number;
    actionIds: string[];
    messageIds: string[];
    needsRuling: number;
    waiting: number;
  }[];
  attention: {
    noticeIds: string[];
    evilInfoPending: boolean;
    staleConditions: number;
    unpublishedDeaths: string[];
    unpublishedRevivals: string[];
    activeVoteId?: string;
  };
  phaseTransition?: {
    expectedPhaseVersion: number;
    publish: { lines: string[]; blocked: boolean; key: string };
    hold: { lines: string[]; blocked: boolean; key: string };
  };
}
