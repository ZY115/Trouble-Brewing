import type { NightAction, NoteRevision, PublicSeat } from "./types";

export interface DeliveredResult {
  actionId: string;
  night: number;
  prompt: string;
  targets: string[];
  response: string;
  version: number;
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
  results: DeliveredResult[];
  notebook: {
    defaultDate: { day: number; period: "DAY" | "NIGHT" };
    seats: {
      seat: PublicSeat;
      notes: NoteSummary[];
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
  nightQueue: NightWorkItem[];
  counts: Record<WorkStatus, number>;
  nextRulingActionId?: string;
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
