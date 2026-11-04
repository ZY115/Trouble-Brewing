import { refreshDeadVotes, voteActive } from "./voting";
import { randomUUID } from "node:crypto";
import type { Command } from "../shared/commands";
import { notebookCommand } from "./notebook";
import { publicRecord } from "./public-records";
import type { Room } from "./game";
function check(value: unknown, error: string): asserts value {
  if (!value) throw new Error(error);
}
export function featureCommand(
  r: Room,
  actor: string,
  st: boolean,
  c: Command,
): string | undefined {
  const player = () => check(!st, "此操作仅限玩家");
  const host = () => check(st, "此操作仅限说书人");
  const seat = (id: string) => {
    const s = r.seats.find((s) => s.id === id);
    check(s, "玩家不存在");
    return s;
  };
  const invite = (groupId: string, to: string) => {
    const g = r.groups.find((g) => g.id === groupId);
    check(g && actor in g.members, "你不是群成员");
    seat(to);
    check(!(to in g.members), "该玩家已在群内");
    if (
      r.invitations.some(
        (i) => i.groupId === groupId && i.to === to && i.status === "pending",
      )
    )
      return;
    r.invitations.push({
      id: randomUUID(),
      groupId,
      groupName: g.name,
      from: actor,
      to,
      status: "pending",
    });
  };
  switch (c.type) {
    case "create_group": {
      player();
      check(
        r.groups.filter((g) => actor in g.members).length < 20,
        "加入的群聊已达 20 个",
      );
      check(
        new Set(c.invitees).size === c.invitees.length &&
          !c.invitees.includes(actor),
        "请选择其他不重复的玩家",
      );
      c.invitees.forEach(seat);
      const groupId = `group:${randomUUID()}`;
      r.groups.push({
        id: groupId,
        name: c.name,
        members: { [actor]: r.messageSequence },
      });
      c.invitees.forEach((id) => invite(groupId, id));
      return "创建私密群聊";
    }
    case "invite_group":
      player();
      invite(c.groupId, c.seatId);
      return "发送群聊邀请";
    case "respond_invite": {
      player();
      const i = r.invitations.find((i) => i.id === c.invitationId);
      check(i && i.to === actor, "邀请不存在");
      const status = c.accept ? "accepted" : "declined";
      if (i.status === status) return "邀请已处理";
      check(i.status === "pending", "邀请已处理，请刷新后查看");
      const g = r.groups.find((g) => g.id === i.groupId);
      check(g && Object.keys(g.members).length, "群聊已关闭");
      if (c.accept) {
        check(
          r.groups.filter((g) => actor in g.members).length < 20,
          "加入的群聊已达 20 个",
        );
        g.members[actor] = r.messageSequence;
      }
      i.status = status;
      return c.accept ? "接受群聊邀请" : "拒绝群聊邀请";
    }
    case "leave_group": {
      player();
      const g = r.groups.find((g) => g.id === c.groupId);
      check(g && actor in g.members, "你不是群成员");
      delete g.members[actor];
      if (!Object.keys(g.members).length) {
        r.invitations
          .filter((i) => i.groupId === g.id && i.status === "pending")
          .forEach((i) => (i.status = "cancelled"));
        r.groups = r.groups.filter((item) => item.id !== g.id);
      }
      return "退出群聊";
    }
    case "save_notebook":
    case "add_note":
    case "edit_notebook":
      player();
      return notebookCommand(r, actor, c);
    case "request_seat": {
      player();
      const me = seat(actor);
      check(
        c.number <= r.capacity && c.number !== me.number,
        "请选择其他有效号码",
      );
      check(!r.registrationOpen, "入场期间请直接修改登记号码");
      r.seatRequests
        .filter((q) => q.seatId === actor && q.status === "pending")
        .forEach((q) => (q.status = "cancelled"));
      r.seatRequests.push({
        id: randomUUID(),
        seatId: actor,
        fromNumber: me.number,
        number: c.number,
        status: "pending",
      });
      return "申请下局换座";
    }
    case "cancel_seat_request": {
      player();
      const q = r.seatRequests.find(
        (q) => q.id === c.requestId && q.seatId === actor,
      );
      check(q && q.status === "pending", "申请已处理");
      q.status = "cancelled";
      return "取消换座申请";
    }
    case "resolve_seat_request": {
      host();
      check(
        ["ENDED", "SETUP", "LOBBY"].includes(r.phase) && !r.registrationOpen,
        "只能在两局之间处理换座",
      );
      const q = r.seatRequests.find((q) => q.id === c.requestId);
      check(q && q.status === "pending", "申请已处理");
      if (!c.accept) {
        q.status = "rejected";
        return "拒绝换座申请";
      }
      const me = seat(q.seatId);
      check(me.number === q.fromNumber, "座位已变化，请重新申请");
      const other = r.seats.find((s) => s.number === q.number);
      if (other) {
        other.number = me.number;
        other.nickname = `${other.number} 号`;
      }
      me.number = q.number;
      me.nickname = `${me.number} 号`;
      q.status = "accepted";
      r.contextVersion++;
      if (r.roundSetup?.mode === "host") r.roundSetup.seatingConfirmed = false;
      for (const pending of r.seatRequests.filter(
        (q) => q.status === "pending",
      )) {
        const actual = seat(pending.seatId).number;
        if (actual === pending.number) pending.status = "accepted";
        else if (actual !== pending.fromNumber) pending.status = "cancelled";
      }
      return "已交换号码，其他号码保持不变";
    }
    case "set_seating": {
      host();
      check(
        r.phase === "SETUP" &&
          !r.registrationOpen &&
          r.roundSetup?.mode === "host",
        "请在说书人换座模式下暂停入场后修改号码",
      );
      check(
        c.expectedContextVersion === r.contextVersion,
        "座位表已变化，请重新载入后修改",
      );
      check(
        c.seats.length === r.seats.length &&
          new Set(c.seats.map((s) => s.seatId)).size === r.seats.length &&
          c.seats.every((s) =>
            r.seats.some((existing) => existing.id === s.seatId),
          ),
        "请提交所有在座玩家，每人只能出现一次",
      );
      check(
        new Set(c.seats.map((s) => s.number)).size === c.seats.length &&
          c.seats.every((s) => s.number <= r.capacity),
        "号码不能重复或超出本局人数",
      );
      for (const change of c.seats) {
        const player = seat(change.seatId);
        player.number = change.number;
        player.nickname = `${change.number} 号`;
      }
      r.seatRequests
        .filter((q) => q.status === "pending")
        .forEach((q) => (q.status = "cancelled"));
      r.roundSetup!.seatingConfirmed = true;
      r.contextVersion++;
      return "说书人统一确认新一局座位表";
    }
    case "new_round": {
      host();
      check(r.phase === "ENDED", "请先结束本局");
      r.archives.push({
        recap: r.recap,
        gameNo: r.gameNo,
        notebooks: r.notebooks,
        publicRecords: r.publicRecords,
        seats: r.seats.map((s) => ({ ...s, alive: r.publishedAlive[s.id] })),
      });
      r.initialAssignments = undefined;
      r.recapLog = [];
      r.recapEdits = [];
      r.recapVersion = 0;
      r.result = undefined;
      r.recap = undefined;
      r.dayEndVictory = undefined;
      r.deathEvents = [];
      r.dismissedNotices = [];
      r.staleConditions = [];
      r.evilInfoSent = false;
      r.recoveryTickets = {};
      r.gameNo++;
      r.playId = undefined;
      r.phaseVersion++;
      r.nightPlan = [];
      r.planVersion++;
      r.publishedAlive = Object.fromEntries(r.seats.map((s) => [s.id, true]));
      r.contextVersion++;
      r.conditions = {};
      r.redHerring = undefined;
      r.executions = [];
      r.dayTimer = undefined;
      r.liveVote = undefined;
      r.deadVoteOverrides = {};
      r.day = 0;
      r.phase = "SETUP";
      r.registrationOpen = false;
      r.assignments = {};
      r.notes = {};
      r.notebooks = {};
      r.publicRecords = [];
      r.groups = [];
      r.invitations = [];
      r.messages = [];
      r.actions = [];
      r.evilReleased = false;
      r.events = [];
      r.seats.forEach((s) => {
        s.alive = true;
        s.deadVoteAvailable = true;
      });
      r.seatRequests = r.seatRequests.filter((q) => q.status === "pending");
      r.roundSetup = {
        mode: c.seatMode ?? "keep",
        seatingConfirmed: c.seatMode !== "host",
      };
      // An explicit choice supersedes earlier change requests. Legacy clients
      // keep their existing request/approval workflow when omitting seatMode.
      if (c.seatMode) r.seatRequests = [];
      if (c.seatMode === "rescan") {
        r.seats = [];
        r.publishedAlive = {};
        r.debugSeatIds = [];
        r.sessions = Object.fromEntries(
          Object.entries(r.sessions).filter(
            ([, identity]) => identity.kind === "storyteller",
          ),
        );
      }
      return c.seatMode === "rescan"
        ? "准备新一局，等待玩家重新扫码登记"
        : c.seatMode === "host"
          ? "准备新一局，等待说书人确认座位表"
          : "准备新一局，保留座位，等待确认配板";
    }
    case "record_vote": {
      host();
      check(!voteActive(r), "请先结束或取消手机投票，避免重复登记");
      const prior = c.supersedes
        ? r.publicRecords.find(
            (e) => e.id === c.supersedes && e.type === "vote",
          )
        : undefined;
      check(
        !c.supersedes ||
          (prior && !r.publicRecords.some((e) => e.supersedes === prior.id)),
        "记录已被修订，请编辑最新版本",
      );
      check(
        prior ? !!c.reason : r.phase === "DAY",
        prior ? "请填写更正原因" : "只能在白天登记投票",
      );
      const nominee = seat(c.nominee),
        nominator = seat(c.nominator);
      check(new Set(c.voters).size === c.voters.length, "投票者不能重复");
      const seatNumbers =
        prior?.seatNumbers ??
        Object.fromEntries(r.seats.map((s) => [s.id, s.number]));
      c.voters.forEach(seat);
      const names =
        c.voters.map((id) => `${seatNumbers[id]}号`).join("、") || "无人";
      const deadAtVote = prior
        ? (prior.deadAtVote ?? [])
        : r.seats.filter((s) => !s.alive).map((s) => s.id);
      const eligibleAtVote = prior
        ? prior.eligibleAtVote
        : r.seats
            .filter((s) => s.alive || s.deadVoteAvailable)
            .map((s) => s.id);
      const deadVoters = c.voters.filter((id) => deadAtVote.includes(id));
      deadVoters
        .filter((id) => !prior?.deadVoters?.includes(id))
        .forEach((id) => delete r.deadVoteOverrides[id]);
      publicRecord(r, {
        type: "vote",
        deadAtVote,
        eligibleAtVote,
        deadVoters,
        seatNumbers,
        nominator: c.nominator,
        nominee: c.nominee,
        voters: c.voters,
        supersedes: c.supersedes,
        text: `${seatNumbers[nominator.id]}号提名${seatNumbers[nominee.id]}号；投票：${names}（${c.voters.length}票）${prior ? `；更正：${c.reason}` : ""}`,
      });
      const created = r.publicRecords.at(-1)!;
      created.day = prior?.day ?? r.day;
      created.period = "DAY";
      refreshDeadVotes(r);
      return "登记公开投票记录";
    }
  }
}
