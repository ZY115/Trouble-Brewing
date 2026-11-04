import { automationCommand, ruleNotices } from "./automation";
import { endReview, finishGame } from "./endgame";
import { captureRecap, recapSnapshot, buildRecap, editRecap } from "./recap";
import type { GameRecap, GameResult, RecapEntry } from "../shared/endgame";
import { playerWorkspace, storytellerWorkbench } from "./workspace";
import { phaseReview } from "../shared/phase-review";
import { choiceKindForRole } from "../shared/action-choice";
import { publishLife, setLife } from "./life";
import { planCommand } from "./night-plan";
import { informationReference } from "./information";
import { storytellerCommand } from "./storyteller";
import { completedAction, privateToolCommands } from "../shared/assistance";
import { voteActive, voteCommand } from "./voting";
import { nightCommand } from "./night";
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
} from "node:crypto";
import { featureCommand } from "./features";
import { publicRecord } from "./public-records";
import { registrationStatus } from "../shared/registration";
import presets from "../shared/presets.json";
import { commandSchema, type Command } from "../shared/commands";
import { isEvil, roleById } from "../shared/roles";
import { validateSetup, type Setup } from "../shared/setup";
import type {
  NightPlanItem,
  PlayerConditions,
  ExecutionRecord,
  DayTimerState,
  ChatGroup,
  GroupInvitation,
  NotebookEntry,
  PublicRecord,
  SeatRequest,
  LiveVote,
  Assignment,
  AuditEvent,
  ChatMessage,
  NightAction,
  Phase,
  PublicSeat,
  RoomView,
} from "../shared/types";
import type { Store } from "./store";
interface Identity {
  kind: "storyteller" | "player";
  seatId?: string;
}
export interface Room {
  roundSetup?: import("../shared/types").RoundSetup;
  initialAssignments?: Record<string, Assignment>;
  recapLog?: (RecapEntry & { actionId?: string; includeResponse?: boolean })[];
  recapEdits?: RecapEntry[];
  recapVersion?: number;
  result?: GameResult;
  recap?: GameRecap;
  dayEndVictory?: { day: number; seatId: string };
  deathEvents: import("../shared/types").DeathEvent[];
  dismissedNotices: string[];
  staleConditions: { seatId: string; condition: "poisoned" | "protected" }[];
  evilInfoSent: boolean;
  recoveryTickets: Record<
    string,
    { seatId: string; expiresAt: number; gameNo: number }
  >;
  phaseVersion: number;
  publishedAlive: Record<string, boolean>;
  nightPlan: NightPlanItem[];
  planVersion: number;
  contextVersion: number;
  conditions: Record<string, PlayerConditions>;
  redHerring?: string;
  executions: ExecutionRecord[];
  dayTimer?: DayTimerState;
  liveVote?: LiveVote;
  deadVoteOverrides: Record<string, boolean>;
  gameNo: number;
  playId?: string;
  debugSeatIds?: string[];
  groups: ChatGroup[];
  invitations: GroupInvitation[];
  notebooks: Record<string, NotebookEntry[]>;
  publicRecords: PublicRecord[];
  seatRequests: SeatRequest[];
  messageSequence: number;
  archives: {
    recap?: GameRecap;
    gameNo: number;
    notebooks: Record<string, NotebookEntry[]>;
    publicRecords: PublicRecord[];
    seats: PublicSeat[];
  }[];
  code: string;
  title: string;
  capacity: number;
  phase: Phase;
  day: number;
  revision: number;
  registrationOpen: boolean;
  seats: (PublicSeat & { joinedGameNo?: number })[];
  sessions: Record<string, Identity>;
  setup: Setup;
  assignments: Record<string, Assignment>;
  notes: Record<string, string>;
  actions: NightAction[];
  messages: ChatMessage[];
  events: AuditEvent[];
  evilReleased: boolean;
  applied: string[];
}
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const requireThat: (
  condition: unknown,
  message: string,
) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const night = (room: Room) =>
  room.phase === "FIRST_NIGHT" || room.phase === "OTHER_NIGHT";
function record(room: Room, actor: string, type: string, detail: string) {
  room.revision++;
  room.events.push({
    id: randomUUID(),
    actor,
    type,
    detail,
    revision: room.revision,
    timestamp: new Date().toISOString(),
  });
}
export class GameService {
  constructor(
    public store: Store,
    private debugEnabled = false,
  ) {}
  room(code: string) {
    const room = this.store.get(code.toUpperCase());
    requireThat(room, "房间不存在");
    room.deathEvents ??= [];
    room.dismissedNotices ??= [];
    room.staleConditions ??= [];
    room.evilInfoSent ??= false;
    room.recoveryTickets ??= {};
    room.gameNo ??= 1;
    room.contextVersion ??= 0;
    room.phaseVersion ??= 0;
    room.publishedAlive ??= {};
    room.seats.forEach((s) => (room.publishedAlive[s.id] ??= s.alive));
    room.nightPlan ??= [];
    // Older saves may have marked completed predecessor items as skipped.
    // Keep their recorded labels, but close the restore/restart path as well.
    for (const item of room.nightPlan) {
      if (
        !item.retiredReason &&
        item.seatId &&
        item.roleId &&
        item.roleId !== "imp" &&
        room.assignments[item.seatId]?.actualRoleId === "imp" &&
        room.deathEvents.some((d) => d.successorId === item.seatId)
      )
        item.retiredReason = "已继任小恶魔，原身份清单仅保留历史，不再发起";
    }
    room.planVersion ??= 0;
    room.conditions ??= {};
    room.executions ??= [];
    room.deadVoteOverrides ??= {};
    room.groups ??= [];
    room.invitations ??= [];
    room.notebooks ??= {};
    room.publicRecords ??= [];
    room.seatRequests ??= [];
    room.archives ??= [];
    for (const [owner, note] of Object.entries(room.notes)) {
      if (
        note &&
        !(room.notebooks[owner] ?? []).some((e) => e.id === `legacy:${owner}`)
      ) {
        (room.notebooks[owner] ??= []).push({
          id: `legacy:${owner}`,
          kind: "text",
          target: "",
          revisions: [
            {
              version: 1,
              day: Math.max(1, room.day),
              period: room.phase === "DAY" ? "DAY" : "NIGHT",
              roleId: "",
              source: "suspected",
              body: note,
              info: {},
              savedAt: new Date(0).toISOString(),
              seatNumbers: Object.fromEntries(
                room.seats.map((s) => [s.id, s.number]),
              ),
            },
          ],
        });
      }
    }
    room.messageSequence ??= room.messages.length;
    room.messages.forEach((m, index) => (m.sequence ??= index + 1));
    return room;
  }
  authenticate(room: Room, bearer: string): Identity {
    const identity = room.sessions[hash(bearer)];
    requireThat(identity, "会话无效，请使用原浏览器重新连接");
    return identity;
  }
  create(capacity: number, title: string) {
    requireThat([10, 11, 12, 13].includes(capacity), "仅支持 10–13 人");
    let code: string;
    do {
      code = Array.from(
        { length: 6 },
        () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(32)],
      ).join("");
    } while (this.store.get(code));
    const bearer = token();
    const room: Room = {
      deathEvents: [],
      dismissedNotices: [],
      staleConditions: [],
      evilInfoSent: false,
      recoveryTickets: {},
      phaseVersion: 0,
      publishedAlive: {},
      nightPlan: [],
      planVersion: 0,
      contextVersion: 0,
      conditions: {},
      executions: [],
      deadVoteOverrides: {},
      gameNo: 1,
      groups: [],
      invitations: [],
      notebooks: {},
      publicRecords: [],
      seatRequests: [],
      messageSequence: 0,
      archives: [],
      code,
      title,
      capacity,
      phase: "LOBBY",
      day: 0,
      revision: 0,
      registrationOpen: false,
      seats: [],
      sessions: { [hash(bearer)]: { kind: "storyteller" } },
      setup: structuredClone(presets.find((p) => p.count === capacity)!.setup),
      assignments: {},
      notes: {},
      actions: [],
      messages: [],
      events: [],
      evilReleased: false,
      applied: [],
    };
    record(room, "storyteller", "room_created", "创建房间");
    this.store.save(room);
    return { code, token: bearer };
  }
  private validateForDeal(r: Room) {
    requireThat(
      r.roundSetup?.mode !== "host" || r.roundSetup.seatingConfirmed,
      "请先由说书人保存并确认座位表",
    );
    requireThat(
      r.setup.roleIds.length === r.capacity &&
        new Set(r.setup.roleIds).size === r.capacity,
      "身份分配需要人数一致且不重复的角色",
    );
    requireThat(
      !r.setup.roleIds.includes("drunk") ||
        (roleById(r.setup.drunkAs)?.team === "townsfolk" &&
          !r.setup.roleIds.includes(r.setup.drunkAs)),
      "请设置有效的酒鬼认知身份",
    );
    const errors = validateSetup(r.capacity, r.setup).filter(
      (i) => i.level === "error",
    );
    requireThat(
      errors.length === 0 || r.setup.overrideReason.trim().length >= 5,
      "非标准配置请填写至少 5 字的房规说明",
    );
  }
  private dealIfReady(r: Room) {
    if (
      !["LOBBY", "SETUP"].includes(r.phase) ||
      !r.registrationOpen ||
      !registrationStatus(r.capacity, r.seats, true).ready
    )
      return;
    this.validateForDeal(r);
    // Older clients allowed tools during registration. Those entries are not
    // game notes and must not follow a changed seat number into the new game.
    r.notes = {};
    r.notebooks = {};
    r.messages = [];
    r.groups = [];
    r.invitations = [];
    r.actions = [];
    r.assignments = {};
    r.playId = randomUUID();
    const shuffled = [...r.setup.roleIds];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    r.seats.forEach((s, i) => {
      r.assignments[s.id] = {
        actualRoleId: shuffled[i],
        perceivedRoleId:
          shuffled[i] === "drunk" ? r.setup.drunkAs : shuffled[i],
      };
    });
    r.initialAssignments = structuredClone(r.assignments);
    r.recapLog = [];
    r.recapEdits = [];
    r.recapVersion = 0;
    r.result = undefined;
    r.recap = undefined;
    r.dayEndVictory = undefined;
    const good = r.seats.filter(
      (s) => !isEvil(r.assignments[s.id].actualRoleId),
    );
    if (good.length) r.redHerring = good[randomInt(good.length)].id;
    r.contextVersion++;
    r.phaseVersion++;
    r.phase = "FIRST_NIGHT";
    r.day = 1;
    r.registrationOpen = false;
    record(
      r,
      "storyteller",
      "roles_dealt",
      `人数与号码校验通过，统一发放身份${r.setup.overrideReason ? `；房规覆盖：${r.setup.overrideReason}` : ""}`,
    );
  }
  private addSeat(room: Room, number: number) {
    const seat = {
      joinedGameNo: room.gameNo,
      id: randomUUID(),
      number,
      nickname: `${number} 号`,
      alive: true,
      deadVoteAvailable: true,
    };
    room.seats.push(seat);
    room.publishedAlive[seat.id] = true;
    return seat;
  }
  join(code: string, number: number, expectedGame?: number) {
    const room = this.room(code);
    requireThat(
      (expectedGame === undefined && room.roundSetup?.mode !== "rescan") ||
        expectedGame === room.gameNo,
      "登记入口的局号已变化，请重新扫描说书人的本局二维码",
    );
    requireThat(
      ["LOBBY", "SETUP"].includes(room.phase),
      "本局已开始，暂不接受新玩家",
    );
    requireThat(room.registrationOpen, "说书人尚未开放入场");
    requireThat(Number.isInteger(number), "请输入整数号码");
    requireThat(
      room.seats.length < room.capacity &&
        number >= 1 &&
        number <= room.capacity,
      "座位不可用",
    );
    const seat = this.addSeat(room, number);
    const bearer = token();
    room.sessions[hash(bearer)] = { kind: "player", seatId: seat.id };
    record(room, seat.id, "player_joined", `${number} 号提交登记`);
    this.dealIfReady(room);
    this.store.save(room);
    return { code: room.code, token: bearer };
  }
  debugPlayerSession(code: string, bearer: string, seatId: string) {
    requireThat(this.debugEnabled, "调试模式未开启");
    const r = this.room(code);
    requireThat(
      this.authenticate(r, bearer).kind === "storyteller",
      "此操作仅限说书人",
    );
    requireThat(
      r.debugSeatIds?.includes(seatId) && r.seats.some((s) => s.id === seatId),
      "只能打开测试玩家",
    );
    // Stable per host and synthetic seat, without storing plaintext credentials.
    // Separate tabs of the same test player can reconnect without revoking one another.
    const playerToken = createHmac("sha256", bearer)
      .update(`clocktower-debug:${r.code}:${seatId}`)
      .digest("base64url");
    const key = hash(playerToken);
    if (!r.sessions[key]) {
      r.sessions[key] = { kind: "player", seatId };
      this.store.save(r);
    }
    return { code: r.code, token: playerToken };
  }
  issueRecovery(code: string, bearer: string, seatId: string) {
    const r = this.room(code);
    requireThat(
      this.authenticate(r, bearer).kind === "storyteller",
      "此操作仅限说书人",
    );
    requireThat(
      r.seats.some((s) => s.id === seatId),
      "玩家不存在",
    );
    for (const [key, ticket] of Object.entries(r.recoveryTickets))
      if (ticket.seatId === seatId || ticket.expiresAt < Date.now())
        delete r.recoveryTickets[key];
    const recoveryToken = token(),
      expiresAt = Date.now() + 15 * 60 * 1000;
    r.recoveryTickets[hash(recoveryToken)] = {
      seatId,
      expiresAt,
      gameNo: r.gameNo,
    };
    record(
      r,
      "storyteller",
      "issue_recovery",
      `为${r.seats.find((s) => s.id === seatId)!.number}号签发一次性恢复入口`,
    );
    this.store.save(r);
    return { recoveryToken, expiresAt };
  }
  recover(code: string, recoveryToken: string) {
    const r = this.room(code),
      ticket = r.recoveryTickets[hash(recoveryToken)];
    requireThat(
      ticket &&
        ticket.expiresAt > Date.now() &&
        ticket.gameNo === r.gameNo &&
        r.seats.some((s) => s.id === ticket.seatId),
      "恢复入口已失效，请说书人重新签发",
    );
    for (const [key, s] of Object.entries(r.sessions))
      if (s.kind === "player" && s.seatId === ticket.seatId)
        delete r.sessions[key];
    for (const [key, t] of Object.entries(r.recoveryTickets))
      if (t.seatId === ticket.seatId) delete r.recoveryTickets[key];
    const bearer = token();
    r.sessions[hash(bearer)] = { kind: "player", seatId: ticket.seatId };
    record(r, ticket.seatId, "recovery_used", "恢复原座位并撤销旧设备访问");
    this.store.save(r);
    return { code: r.code, token: bearer };
  }
  discovery(code: string) {
    const r = this.room(code);
    return {
      gameNo: r.gameNo,
      code: r.code,
      title: r.title,
      capacity: r.capacity,
      phase: r.phase,
      registration: registrationStatus(
        r.capacity,
        r.seats,
        !!r.registrationOpen,
      ),
    };
  }
  view(code: string, bearer: string): RoomView {
    const r = this.room(code);
    const viewer = this.authenticate(r, bearer);
    const st = viewer.kind === "storyteller";
    const waiting = !st && ["LOBBY", "SETUP"].includes(r.phase);
    const me = viewer.seatId ?? "storyteller";
    const evil =
      !st &&
      !waiting &&
      r.evilReleased &&
      isEvil(r.assignments[me]?.actualRoleId);
    const actions = r.actions
      .filter((a) => st || (!waiting && a.seatId === me))
      .map((a) => {
        const {
          response,
          resolutionReason,
          responseHistory,
          responseVersion,
          referenceRoleId,
          reference,
          ...visible
        } = a;
        if (st)
          return {
            ...visible,
            response,
            resolutionReason,
            responseHistory,
            responseVersion,
            referenceRoleId,
            reference: completedAction(a)
              ? reference
              : informationReference(r, a),
          };
        return completedAction(a)
          ? {
              ...visible,
              ...(a.status === "DELIVERED"
                ? { response, responseHistory, responseVersion }
                : {}),
            }
          : {
              ...visible,
              canChangeTargets: ["REQUESTED", "SUBMITTED"].includes(a.status),
              status:
                a.status === "REQUESTED"
                  ? ("REQUESTED" as const)
                  : ("SUBMITTED" as const),
            };
      });
    const groups = st || waiting ? [] : r.groups.filter((g) => me in g.members);
    const view: RoomView = {
      roundSetup: r.roundSetup,
      result: waiting
        ? undefined
        : r.result &&
          (st || r.result.mode === "normal"
            ? r.result
            : { ...r.result, suggestions: [] }),
      recap: waiting ? undefined : r.recap,
      pastRecaps: !st
        ? []
        : r.archives.flatMap((a) => (a.recap ? [a.recap] : [])),
      gameNo: r.gameNo,
      playId: waiting ? undefined : r.playId,
      liveVote: waiting ? undefined : r.liveVote,
      groups,
      invitations:
        st || waiting
          ? []
          : r.invitations.filter(
              (i) => i.to === me || groups.some((g) => g.id === i.groupId),
            ),
      notebook: st || waiting ? [] : (r.notebooks[me] ?? []),
      pastNotebooks: [],
      publicRecords: waiting ? [] : r.publicRecords,
      pastPublicRecords: !st
        ? []
        : r.archives.map((a) => ({
            gameNo: a.gameNo,
            records: a.publicRecords,
          })),
      seatRequests: r.seatRequests.filter((q) => st || q.seatId === me),
      code: r.code,
      title: r.title,
      capacity: r.capacity,
      phase: r.phase,
      day: r.day,
      revision: r.revision,
      registration: registrationStatus(
        r.capacity,
        r.seats,
        !!r.registrationOpen,
      ),
      seats: r.seats
        .map((s) => ({
          id: s.id,
          number: s.number,
          nickname: s.nickname,
          alive: st ? s.alive : r.publishedAlive[s.id],
          deadVoteAvailable: s.deadVoteAvailable,
        }))
        .sort((a, b) => a.number - b.number),
      viewer,
      actions,
      evilEnabled: evil,
      messages: waiting
        ? []
        : r.messages.filter((m) =>
            m.to.startsWith("group:")
              ? groups.some((g) => g.id === m.to && m.sequence > g.members[me])
              : m.to === "evil"
                ? evil
                : m.from === me || m.to === me,
          ),
    };
    if (st)
      view.storyteller = {
        canStartNextRound: r.phase === "ENDED",
        endReview: endReview(r),
        recapPreview: Object.keys(r.assignments).length
          ? buildRecap(r, true)
          : undefined,
        ...(this.debugEnabled
          ? { debug: { seatIds: r.debugSeatIds ?? [] } }
          : {}),
        notices: ruleNotices(r),
        staleConditions: r.staleConditions,
        evilInfoSent: r.evilInfoSent,
        setup: r.setup,
        assignments: r.assignments,
        events: r.events.filter((e) => !privateToolCommands.has(e.type)),
        evilReleased: r.evilReleased,
        phaseVersion: r.phaseVersion,
        publishedAlive: r.publishedAlive,
        nightPlan: r.nightPlan,
        planVersion: r.planVersion,
        contextVersion: r.contextVersion,
        conditions: r.conditions,
        redHerring: r.redHerring,
        executions: r.executions,
        dayTimer: r.dayTimer,
      };
    else {
      view.self = {
        canChangeNumber:
          r.roundSetup?.mode !== "host" &&
          (r.gameNo === 1 ||
            r.seats.find((s) => s.id === me)?.joinedGameNo === r.gameNo),
        perceivedRoleId: waiting
          ? undefined
          : r.assignments[me]?.perceivedRoleId,
        note: waiting ? "" : (r.notes[me] ?? ""),
      };
      if (evil) {
        view.evilMembers = r.seats
          .filter((s) => isEvil(r.assignments[s.id]?.actualRoleId))
          .map((s) => s.id);
        if (r.assignments[me]?.actualRoleId === "imp")
          view.self.bluffs = r.setup.bluffs;
      }
    }
    if (view.storyteller)
      view.storyteller.workbench = storytellerWorkbench(view);
    else if (!waiting) view.playerWorkspace = playerWorkspace(view);
    return view;
  }
  execute(
    code: string,
    bearer: string,
    commandId: string,
    input: Command,
    expectedGame?: number,
  ) {
    const command = commandSchema.parse(input);
    const r = this.room(code);
    const identity = this.authenticate(r, bearer);
    const actor = identity.seatId ?? "storyteller";
    const st = identity.kind === "storyteller";
    const receipt = `${hash(bearer)}:${commandId}`;
    if (r.applied.includes(receipt)) return this.view(code, bearer);
    requireThat(
      expectedGame === undefined || expectedGame === r.gameNo,
      "已进入新一局，请刷新后操作",
    );
    requireThat(
      !["LOBBY", "SETUP"].includes(r.phase) ||
        !privateToolCommands.has(command.type),
      "尚未发放身份，私聊和笔记将在开局后开放",
    );
    const hostCommands = [
      "save_setup",
      "open_registration",
      "close_registration",
      "remove_player",
      "next_phase",
      "end",
      "finish_game",
      "edit_recap",
      "set_alive",
      "evil_channel",
      "request_action",
      "review_action",
      "deliver_action",
    ];
    if (hostCommands.includes(command.type))
      requireThat(st, "此操作仅限说书人");
    if (command.type === "debug_fill") {
      requireThat(this.debugEnabled, "调试模式未开启");
      requireThat(st, "此操作仅限说书人");
    }
    requireThat(
      r.phase !== "ENDED" ||
        [
          "save_note",
          "save_notebook",
          "add_note",
          "edit_notebook",
          "new_round",
          "request_seat",
          "cancel_seat_request",
          "resolve_seat_request",
          "record_vote",
          "edit_recap",
        ].includes(command.type),
      "游戏已结束",
    );
    const recapBefore = recapSnapshot(r);
    let detail =
      automationCommand(r, st, command) ??
      planCommand(r, st, command) ??
      storytellerCommand(r, st, command) ??
      nightCommand(r, st, command) ??
      voteCommand(r, actor, st, command) ??
      featureCommand(r, actor, st, command);
    if (detail === undefined)
      switch (command.type) {
        case "finish_game":
          finishGame(r, command);
          detail = "说书人确认本局结果";
          break;
        case "edit_recap":
          editRecap(r, command);
          detail = "说书人修订复盘说明";
          break;
        case "debug_fill": {
          requireThat(["LOBBY", "SETUP"].includes(r.phase), "身份已经发放");
          requireThat(
            !registrationStatus(r.capacity, r.seats, r.registrationOpen)
              .duplicateNumbers.length,
            "请先处理重复号码",
          );
          requireThat(
            !r.seatRequests.some((q) => q.status === "pending"),
            "请先处理换座申请",
          );
          if (command.start) this.validateForDeal(r);
          r.debugSeatIds ??= [];
          const occupied = new Set(r.seats.map((s) => s.number));
          let added = 0;
          for (let number = 1; number <= r.capacity; number++) {
            if (occupied.has(number)) continue;
            const seat = this.addSeat(r, number);
            r.debugSeatIds.push(seat.id);
            added++;
          }
          r.registrationOpen = command.start;
          detail = `单人调试：补齐 ${added} 个测试玩家${command.start ? "并确认开局" : "，入场保持暂停"}`;
          break;
        }
        case "save_setup": {
          requireThat(
            ["LOBBY", "SETUP"].includes(r.phase),
            "开始后不能重新配板",
          );
          requireThat(!r.registrationOpen, "请先暂停入场再修改配板");
          requireThat(
            command.setup.roleIds.every((id) => roleById(id)),
            "包含未知角色",
          );
          r.setup = command.setup;
          r.phase = "SETUP";
          detail = `保存配板${command.setup.overrideReason ? `；房规说明：${command.setup.overrideReason}` : ""}`;
          break;
        }
        case "open_registration": {
          requireThat(["LOBBY", "SETUP"].includes(r.phase), "身份已经发放");
          this.validateForDeal(r);
          requireThat(
            !r.seatRequests.some((q) => q.status === "pending"),
            "请先处理换座申请",
          );
          r.registrationOpen = true;
          detail = "确认配板并开放入场；满员且号码唯一后自动发放身份";
          break;
        }
        case "close_registration": {
          requireThat(["LOBBY", "SETUP"].includes(r.phase), "身份已经发放");
          r.registrationOpen = false;
          detail = "暂停入场，可修改配板";
          break;
        }
        case "remove_player": {
          requireThat(
            ["LOBBY", "SETUP"].includes(r.phase),
            "身份发放后不能移除登记",
          );
          const seat = r.seats.find((s) => s.id === command.seatId);
          requireThat(seat, "登记不存在");
          r.seats = r.seats.filter((s) => s.id !== command.seatId);
          if (r.roundSetup?.mode === "host") {
            r.roundSetup.seatingConfirmed = false;
            r.registrationOpen = false;
            r.contextVersion++;
          }
          r.debugSeatIds = r.debugSeatIds?.filter(
            (id) => id !== command.seatId,
          );
          for (const [key, session] of Object.entries(r.sessions))
            if (session.seatId === command.seatId) delete r.sessions[key];
          delete r.notes[command.seatId];
          delete r.notebooks[command.seatId];
          r.seatRequests
            .filter(
              (q) => q.seatId === command.seatId && q.status === "pending",
            )
            .forEach((q) => (q.status = "cancelled"));
          r.groups.forEach((g) => {
            delete g.members[command.seatId];
          });
          r.groups = r.groups.filter((g) => Object.keys(g.members).length);
          r.invitations
            .filter(
              (i) =>
                i.status === "pending" &&
                (i.to === command.seatId ||
                  !r.groups.some((g) => g.id === i.groupId)),
            )
            .forEach((i) => (i.status = "cancelled"));
          r.messages = r.messages.filter(
            (m) => m.from !== command.seatId && m.to !== command.seatId,
          );
          detail = `移除 ${seat.number} 号的一条登记`;
          break;
        }
        case "next_phase": {
          requireThat(
            command.expectedReviewKey === undefined ||
              command.expectedReviewKey ===
                phaseReview(
                  this.view(code, bearer),
                  command.publishLifeOnDawn !== false,
                ).key,
            "确认内容已变化，请重新打开阶段确认框核对",
          );
          requireThat(
            command.expectedPhaseVersion === r.phaseVersion,
            "阶段已变化或页面已过期，请核对当前天数后再操作",
          );
          requireThat(
            ["FIRST_NIGHT", "OTHER_NIGHT", "DAY"].includes(r.phase),
            "请先分配身份",
          );
          requireThat(
            !r.actions.some((a) => a.night === r.day && !completedAction(a)),
            "请先处理完本夜待办",
          );
          requireThat(!voteActive(r), "请先结束或取消当前投票");
          r.contextVersion++;
          r.phaseVersion++;
          r.dayTimer = undefined;
          if (r.phase === "DAY") {
            const mayor = endReview(r).suggestions.find(
              (s) => s.status === "end_day",
            );
            if (mayor)
              r.dayEndVictory = {
                day: r.day,
                seatId: mayor.id.slice("mayor:".length),
              };
            r.staleConditions = r.seats.flatMap((s) =>
              (["poisoned", "protected"] as const)
                .filter((condition) => r.conditions[s.id]?.[condition])
                .map((condition) => ({ seatId: s.id, condition })),
            );
            r.day++;
            r.phase = "OTHER_NIGHT";
          } else {
            r.staleConditions = r.seats
              .filter((s) => r.conditions[s.id]?.protected)
              .map((s) => ({ seatId: s.id, condition: "protected" as const }));
            r.phase = "DAY";
            if (command.publishLifeOnDawn !== false) publishLife(r);
          }
          detail = `进入第 ${r.day} ${r.phase === "DAY" ? "天" : "夜"}`;
          publicRecord(r, { type: "phase", text: detail });
          break;
        }
        case "end":
          // Legacy clients end without an explicit winner: never invent one or
          // disclose the grimoire. The new finish_game command confirms normal endings.
          if (["FIRST_NIGHT", "OTHER_NIGHT", "DAY"].includes(r.phase)) {
            finishGame(r, {
              type: "finish_game",
              mode: "early",
              winner: "none",
              reason: "说书人提前结束",
              endDay: false,
              confirmed: true,
              expectedReviewKey: endReview(r).key,
            });
            detail = "说书人提前结束本局";
            break;
          }
          if (voteActive(r)) r.liveVote!.status = "CANCELLED";
          r.phaseVersion++;
          r.phase = "ENDED";
          r.dayTimer = undefined;
          r.evilReleased = false;
          detail = "说书人结束本局";
          break;
        case "set_alive": {
          requireThat(!voteActive(r), "请先结束或取消当前投票再更正生死状态");
          requireThat(!["LOBBY", "SETUP"].includes(r.phase), "尚未开始");
          const seat = r.seats.find((s) => s.id === command.seatId);
          requireThat(seat, "玩家不存在");
          setLife(r, seat.id, command.alive);
          r.contextVersion++;
          detail = `手动登记 ${seat.number} 号${seat.alive ? "存活" : "死亡"}`;
          break;
        }
        case "evil_channel": {
          requireThat(!["LOBBY", "SETUP"].includes(r.phase), "请先分配身份");
          requireThat(
            !command.enabled || command.confirm,
            "请确认已完成首夜恶魔与爪牙信息发放",
          );
          r.evilReleased = command.enabled;
          detail = command.enabled
            ? "确认首夜队友信息已发放，开放邪恶频道"
            : "撤销邪恶频道权限";
          break;
        }
        case "send_message": {
          const evil = command.to === "evil";
          const group = command.to.startsWith("group:");
          requireThat(command.to !== actor, "不能给自己发私信");
          requireThat(
            group
              ? !st &&
                  r.groups.some(
                    (g) => g.id === command.to && actor in g.members,
                  )
              : evil
                ? !st &&
                  r.evilReleased &&
                  isEvil(r.assignments[actor]?.actualRoleId)
                : command.to === "storyteller" ||
                  r.seats.some((s) => s.id === command.to),
            "无法访问此频道",
          );
          r.messages.push({
            id: randomUUID(),
            sequence: ++r.messageSequence,
            from: actor,
            to: command.to,
            content: command.content,
            createdAt: new Date().toISOString(),
          });
          detail = "发送一条私密消息（正文不进入公共日志）";
          break;
        }
        case "save_note":
          requireThat(!st, "个人笔记仅限玩家");
          r.notes[actor] = command.note;
          detail = "保存个人笔记";
          break;
        case "move_seat": {
          requireThat(
            r.roundSetup?.mode !== "host",
            "本局由说书人统一修改座位",
          );
          requireThat(
            !st && ["LOBBY", "SETUP"].includes(r.phase),
            "只能在开局前更换自己的座位",
          );
          requireThat(command.number <= r.capacity, "号码超出范围");
          const seat = r.seats.find((s) => s.id === actor)!;
          requireThat(
            r.gameNo === 1 || seat.joinedGameNo === r.gameNo,
            "续局保留原号码，请提交换座申请",
          );
          seat.number = command.number;
          seat.nickname = `${command.number} 号`;
          r.contextVersion++;
          detail = `修改登记为 ${command.number} 号`;
          break;
        }
        case "request_action": {
          requireThat(
            command.expectedPhaseVersion === r.phaseVersion,
            "夜晚已变化，请核对后重新创建待办",
          );
          requireThat(night(r), "只能在夜间请求行动");
          requireThat(
            r.seats.some((s) => s.id === command.seatId),
            "玩家不存在",
          );
          requireThat(
            !command.referenceRoleId || roleById(command.referenceRoleId),
            "未知参考身份",
          );
          r.actions.push({
            choiceKind:
              command.choiceKind ??
              choiceKindForRole(
                r.assignments[command.seatId]?.perceivedRoleId ?? "",
              ),
            referenceRoleId:
              command.referenceRoleId ??
              r.assignments[command.seatId]?.perceivedRoleId,
            id: randomUUID(),
            night: r.day,
            seatId: command.seatId,
            prompt: command.prompt,
            targetCount: command.targetCount,
            targets: [],
            status: command.targetCount === 0 ? "ST_REVIEW" : "REQUESTED",
          });
          detail = "新建手动夜间待办";
          break;
        }
        case "submit_action": {
          const action = r.actions.find((a) => a.id === command.actionId);
          requireThat(
            night(r) &&
              action &&
              action.night === r.day &&
              action.seatId === actor &&
              ["REQUESTED", "SUBMITTED"].includes(action.status),
            "无法提交此行动",
          );
          requireThat(
            command.targets.length === action.targetCount &&
              new Set(command.targets).size === action.targetCount &&
              command.targets.every((id) => r.seats.some((s) => s.id === id)),
            "请选择正确数量的不重复目标",
          );
          requireThat(
            (action.selectionVersion ?? 0) === (command.expectedVersion ?? 0),
            "目标已被修改，请查看最新状态",
          );
          action.selectionVersion = (action.selectionVersion ?? 0) + 1;
          action.targets = command.targets;
          action.status = "SUBMITTED";
          detail = "玩家提交夜间目标";
          break;
        }
        case "review_action": {
          const action = r.actions.find((a) => a.id === command.actionId);
          requireThat(
            night(r) &&
              action &&
              action.night === r.day &&
              ["SUBMITTED", "ST_REVIEW", "APPROVED"].includes(action.status),
            "行动尚未提交或已送达",
          );
          action.reference = informationReference(r, action);
          action.response = command.response;
          action.status = "APPROVED";
          detail = "说书人审核反馈（尚未发送）";
          break;
        }
        case "deliver_action": {
          const action = r.actions.find((a) => a.id === command.actionId);
          requireThat(
            night(r) &&
              action &&
              action.night === r.day &&
              action.status === "APPROVED",
            "请先审核反馈",
          );
          requireThat(
            !action.reference ||
              action.reference.contextVersion === r.contextVersion,
            "游戏状态已变化，请重新核对后审核反馈",
          );
          action.status = "DELIVERED";
          action.responseVersion = 1;
          action.responseHistory = [
            {
              version: 1,
              response: action.response!,
              sentAt: new Date().toISOString(),
            },
          ];
          detail = "私密发送审核后的反馈";
          break;
        }
      }
    captureRecap(r, recapBefore, command);
    if (privateToolCommands.has(command.type) || command.type === "raise_hand")
      r.revision++;
    else record(r, actor, command.type, detail ?? command.type);
    r.applied.push(receipt);
    this.dealIfReady(r);
    this.store.save(r);
    return this.view(code, bearer);
  }
}
