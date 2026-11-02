import type { ChoiceKind } from "./action-choice";
import type { Setup } from "./setup";
export type Phase =
  | "LOBBY"
  | "SETUP"
  | "FIRST_NIGHT"
  | "DAY"
  | "OTHER_NIGHT"
  | "ENDED";
export const PHASE_NAMES: Record<Phase, string> = {
  LOBBY: "等待入座",
  SETUP: "准备配板",
  FIRST_NIGHT: "第一个夜晚",
  DAY: "白天",
  OTHER_NIGHT: "夜晚",
  ENDED: "已结束",
};
export interface PublicSeat {
  id: string;
  number: number;
  nickname: string;
  alive: boolean;
  deadVoteAvailable: boolean;
}
export interface Assignment {
  actualRoleId: string;
  perceivedRoleId: string;
}
export interface NightAction {
  choiceKind?: ChoiceKind;
  id: string;
  night: number;
  seatId: string;
  prompt: string;
  targetCount: number;
  targets: string[];
  status:
    | "REQUESTED"
    | "SUBMITTED"
    | "ST_REVIEW"
    | "APPROVED"
    | "DELIVERED"
    | "CANCELLED"
    | "OFFLINE";
  response?: string;
  responseVersion?: number;
  responseHistory?: {
    version: number;
    response: string;
    reason?: string;
    sentAt: string;
  }[];
  selectionVersion?: number;
  resolutionReason?: string;
  canChangeTargets?: boolean;
  referenceRoleId?: string;
  reference?: InformationReference;
}
export interface ChatMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  createdAt: string;
  sequence: number;
}
export interface AuditEvent {
  id: string;
  type: string;
  actor: string;
  detail: string;
  revision: number;
  timestamp: string;
}
export interface RoomView {
  code: string;
  title: string;
  capacity: number;
  phase: Phase;
  day: number;
  revision: number;
  gameNo: number;
  groups: ChatGroup[];
  invitations: GroupInvitation[];
  notebook: NotebookEntry[];
  pastNotebooks: {
    gameNo: number;
    entries: NotebookEntry[];
    seats: PublicSeat[];
  }[];
  publicRecords: PublicRecord[];
  liveVote?: LiveVote;
  pastPublicRecords: { gameNo: number; records: PublicRecord[] }[];
  seatRequests: SeatRequest[];
  registration: {
    open: boolean;
    joined: number;
    duplicateNumbers: number[];
    missingNumbers: number[];
    ready: boolean;
  };
  seats: PublicSeat[];
  viewer: { kind: "storyteller" | "player"; seatId?: string };
  messages: ChatMessage[];
  evilEnabled: boolean;
  evilMembers?: string[];
  actions: NightAction[];
  self?: {
    canChangeNumber: boolean;
    perceivedRoleId?: string;
    note: string;
    bluffs?: string[];
  };
  storyteller?: {
    notices: RuleNotice[];
    staleConditions: { seatId: string; condition: "poisoned" | "protected" }[];
    evilInfoSent: boolean;
    setup: Setup;
    assignments: Record<string, Assignment>;
    events: AuditEvent[];
    evilReleased: boolean;
    phaseVersion: number;
    publishedAlive: Record<string, boolean>;
    nightPlan: NightPlanItem[];
    planVersion: number;
    contextVersion: number;
    conditions: Record<string, PlayerConditions>;
    redHerring?: string;
    executions: ExecutionRecord[];
    dayTimer?: DayTimerState;
  };
}
export interface Session {
  code: string;
  token: string;
}
export interface Preset {
  id: string;
  name: string;
  description: string;
  count: number;
  setup: Setup;
}

export interface ChatGroup {
  id: string;
  name: string;
  members: Record<string, number>;
}
export interface GroupInvitation {
  id: string;
  groupId: string;
  groupName: string;
  from: string;
  to: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
}
export interface NoteRevision {
  seatNumbers: Record<string, number>;
  version: number;
  day: number;
  period: "DAY" | "NIGHT";
  roleId: string;
  source: "claimed" | "suspected";
  body: string;
  info: Record<string, string>;
  savedAt: string;
}
export interface NotebookEntry {
  id: string;
  kind: "text" | "claim";
  target: string;
  revisions: NoteRevision[];
}
export interface PublicRecord {
  id: string;
  day: number;
  period: "DAY" | "NIGHT";
  type: "vote" | "phase" | "status" | "execution";
  text: string;
  voters?: string[];
  deadAtVote?: string[];
  eligibleAtVote?: string[];
  deadVoters?: string[];
  seatNumbers?: Record<string, number>;
  nominee?: string;
  nominator?: string;
  supersedes?: string;
  createdAt: string;
}
export interface SeatRequest {
  id: string;
  seatId: string;
  fromNumber: number;
  number: number;
  status: "pending" | "accepted" | "rejected" | "cancelled";
}

export interface LiveVote {
  id: string;
  day: number;
  nominator: string;
  nominee: string;
  order: string[];
  hands: Record<string, boolean>;
  counted: Record<string, boolean>;
  cursor: number;
  status: "OPEN" | "COUNTING" | "FINISHED" | "CANCELLED";
  deadAtVote: string[];
  eligibleAtVote?: string[];
  recordId?: string;
}

export interface PlayerConditions {
  poisoned: boolean;
  drunk: boolean;
  protected: boolean;
  note: string;
}
export interface InformationReference {
  contextVersion: number;
  roleId: string;
  actual: string;
  evidence: string[];
  warnings: string[];
  suggestedResponse?: string;
  impaired: boolean;
}
export interface ExecutionRecord {
  id: string;
  day: number;
  seatId: string;
  actualRoleId: string;
  died: boolean;
  supersedes?: string;
  voided?: boolean;
  reason?: string;
  publicRecordId?: string;
  impaired?: boolean;
}
export interface DayTimerState {
  id: string;
  day: number;
  endsAt: number | null;
  remainingMs: number;
}

export interface NightPlanItem {
  id: string;
  night: number;
  seatId: string;
  roleId: string;
  prompt: string;
  targetCount: number;
  note: string;
  status: "planned" | "skipped" | "offline" | "started";
  actionId?: string;
  retiredReason?: string;
}

export interface DeathEvent {
  id: string;
  seatId: string;
  roleId: string;
  day: number;
  phase: Phase;
  aliveBefore: number;
  selfKill: boolean;
  impaired: boolean;
  candidates: string[];
  scarletEligible: boolean;
  minionsAtDeath?: string[];
  successorId?: string;
}
export interface RuleNotice {
  id: string;
  kind: "demon" | "saint" | "victory" | "mayor";
  text: string;
  candidates: string[];
  deathId?: string;
  canConfirmSelfKill?: boolean;
}
