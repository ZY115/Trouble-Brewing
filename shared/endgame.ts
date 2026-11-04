import type { Assignment } from "./types";

export type Winner = "good" | "evil" | "none";
export interface EndSuggestion {
  id: string;
  winner?: "good" | "evil";
  status: "met" | "check" | "end_day";
  text: string;
}
export interface EndReview {
  available: boolean;
  buttonLabel: "提前结束" | "结束游戏" | "已结束";
  suggestions: EndSuggestion[];
  suggestedWinner?: "good" | "evil";
  pendingActions: number;
  activeVote: boolean;
  key: string;
}
export interface GameResult {
  gameNo: number;
  mode: "normal" | "early";
  winner: Winner;
  reason: string;
  endedAt: string;
  day: number;
  period: "DAY" | "NIGHT";
  suggestions: EndSuggestion[];
}
export interface RecapEntry {
  id: string;
  day: number;
  period: "DAY" | "NIGHT";
  kind: "action" | "life" | "role" | "condition" | "execution" | "manual";
  text: string;
  hidden?: boolean;
}
export interface GameRecap {
  gameNo: number;
  version: number;
  result?: GameResult;
  seats: {
    seatId: string;
    number: number;
    initial?: Assignment;
    final: Assignment;
    alive: boolean;
  }[];
  redHerring?: string;
  entries: RecapEntry[];
  limitations: string[];
}
