import { commandWithContext } from "../shared/command-context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store";
import { GameService } from "../server/game";
import { emptyConditions, informationReference } from "../server/information";
import { abstentionSummary, ballotStatus } from "../shared/vote-display";
import type { Command } from "../shared/commands";
import type { Session } from "../shared/types";

const stores: Store[] = [];
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  vi.restoreAllMocks();
});
function setup() {
  const store = new Store(":memory:");
  stores.push(store);
  const game = new GameService(store),
    host = game.create(10, "Workbench");
  const view = (s = host) => game.view(s.code, s.token);
  const act = (c: Command, s: Session = host, receipt = randomUUID()) =>
    game.execute(
      s.code,
      s.token,
      receipt,
      commandWithContext(c, view(s)),
      view(s).gameNo,
    );
  act({ type: "open_registration" });
  const players = Array.from({ length: 10 }, (_, i) =>
    game.join(host.code, i + 1),
  );
  const ids = players.map((p) => view(p).viewer.seatId!);
  const r = store.get(host.code)!;
  const roles = [
    "empath",
    "soldier",
    "poisoner",
    "chef",
    "fortuneteller",
    "undertaker",
    "ravenkeeper",
    "washerwoman",
    "recluse",
    "imp",
  ];
  ids.forEach(
    (id, i) =>
      (r.assignments[id] = {
        actualRoleId: roles[i],
        perceivedRoleId: roles[i],
      }),
  );
  r.redHerring ??= ids[0];
  store.save(r);
  const current = () => store.get(host.code)!;
  const change = (
    i: number,
    changes: Partial<Extract<Command, { type: "update_player" }>> = {},
  ) =>
    act({
      type: "update_player",
      seatId: ids[i],
      ...view().storyteller!.assignments[ids[i]],
      alive: view().seats[i].alive,
      conditions: emptyConditions(),
      reason: "private ruling",
      expectedContextVersion: view().storyteller!.contextVersion,
      ...changes,
    });
  const reference = (
    role: string,
    seat = 0,
    targets: string[] = [],
    night = 1,
  ) =>
    informationReference(current(), {
      id: "test",
      seatId: ids[seat],
      referenceRoleId: role,
      targets,
      targetCount: targets.length,
      night,
      prompt: "test",
      status: "ST_REVIEW",
    });
  const request = (i: number, role: string, targetCount = 0) => {
    act({
      type: "request_action",
      seatId: ids[i],
      referenceRoleId: role,
      prompt: "Please check",
      targetCount,
    });
    return view().actions.at(-1)!;
  };
  return {
    store,
    game,
    host,
    players,
    ids,
    view,
    act,
    current,
    change,
    reference,
    request,
  };
}

describe("truth references remain distinct from storyteller rulings", () => {
  it("counts circular evil pairs and nearest living neighbours", () => {
    const f = setup();
    expect(f.reference("chef").suggestedResponse).toBe("0");
    f.change(0, { actualRoleId: "spy", perceivedRoleId: "spy" });
    expect(f.reference("chef", 3).suggestedResponse).toBe("1");
    expect(f.reference("chef", 3).warnings.join()).toContain("特殊登记");
    f.change(0, { actualRoleId: "empath", perceivedRoleId: "empath" });
    expect(f.reference("empath").suggestedResponse).toBe("1");
    f.change(1, { alive: false });
    expect(f.reference("empath").suggestedResponse).toBe("2");
    expect(f.reference("empath").evidence.join()).toContain("3 号");
  });
  it("keeps actual truth visible while leaving poisoned and Drunk feedback blank", () => {
    const f = setup();
    f.change(0, {
      conditions: {
        ...emptyConditions(),
        poisoned: true,
        note: "SECRET condition",
      },
    });
    const a = f.request(0, "empath");
    expect(a.reference!.actual).toContain("1");
    expect(a.reference!.suggestedResponse).toBeUndefined();
    expect(a.reference!.impaired).toBe(true);
    expect(JSON.stringify(f.view(f.players[0]))).not.toMatch(
      /SECRET|reference|conditions|contextVersion/,
    );
    f.act({
      type: "send_action_response",
      actionId: a.id,
      response: "2",
      expectedVersion: 0,
      expectedContextVersion: a.reference!.contextVersion,
    });
    expect(f.view(f.players[0]).actions[0].response).toBe("2");
    expect(f.view(f.players[1]).actions).toEqual([]);
    const snapshot = f.view().actions[0].reference;
    f.change(0, { actualRoleId: "drunk", perceivedRoleId: "empath" });
    expect(f.view(f.players[0]).self!.perceivedRoleId).toBe("empath");
    expect(f.reference("empath").suggestedResponse).toBeUndefined();
    expect(f.view().actions[0].reference).toEqual(snapshot);
  });
  it("allows changing or clearing the recommended red herring and accounts for dead demons", () => {
    const f = setup();
    expect(f.view().storyteller!.redHerring).toBeTruthy();
    f.act({
      type: "set_red_herring",
      seatId: "",
      expectedContextVersion: f.view().storyteller!.contextVersion,
    });
    expect(
      f.reference("fortuneteller", 4, [f.ids[1], f.ids[2]]).suggestedResponse,
    ).toBeUndefined();
    f.act({
      type: "set_red_herring",
      seatId: f.ids[1],
      expectedContextVersion: f.view().storyteller!.contextVersion,
    });
    expect(
      f.reference("fortuneteller", 4, [f.ids[1], f.ids[2]]).suggestedResponse,
    ).toBe("是");
    expect(
      f.reference("fortuneteller", 4, [f.ids[3], f.ids[4]]).suggestedResponse,
    ).toBe("否");
    f.change(9, { alive: false });
    expect(
      f.reference("fortuneteller", 4, [f.ids[3], f.ids[9]]).suggestedResponse,
    ).toBe("是");
    expect(
      f.reference("fortuneteller", 4, [f.ids[8], f.ids[4]]).warnings.join(),
    ).toContain("特殊登记");
    expect(f.view(f.players[4])).not.toHaveProperty("redHerring");
  });
  it("rejects feedback based on stale state and stale target choices", () => {
    const f = setup();
    const a = f.request(4, "fortuneteller", 2);
    f.act(
      {
        type: "submit_action",
        actionId: a.id,
        targets: [f.ids[0], f.ids[1]],
        expectedVersion: 0,
      },
      f.players[4],
    );
    const oldVersion = f.view().storyteller!.contextVersion;
    f.change(4, { conditions: { ...emptyConditions(), poisoned: true } });
    expect(() =>
      f.act({
        type: "send_action_response",
        actionId: a.id,
        response: "否",
        expectedVersion: 1,
        expectedContextVersion: oldVersion,
      }),
    ).toThrow("状态已变化");
    f.act(
      {
        type: "submit_action",
        actionId: a.id,
        targets: [f.ids[2], f.ids[3]],
        expectedVersion: 1,
      },
      f.players[4],
    );
    expect(() =>
      f.act({
        type: "send_action_response",
        actionId: a.id,
        response: "否",
        expectedVersion: 1,
        expectedContextVersion: f.view().storyteller!.contextVersion,
      }),
    ).toThrow("修改目标");
    expect(f.view(f.players[4]).actions[0].response).toBeUndefined();
  });
  it("snapshots execution identity for the next night's Undertaker", () => {
    const f = setup();
    f.change(1, { actualRoleId: "drunk", perceivedRoleId: "soldier" });
    f.act({ type: "next_phase" });
    f.act({
      type: "execute_player",
      seatId: f.ids[1],
      reason: "公开裁定",
      confirmed: true,
      expectedContextVersion: f.view().storyteller!.contextVersion,
    });
    f.change(1, { actualRoleId: "saint", perceivedRoleId: "saint" });
    f.act({ type: "next_phase" });
    expect(f.reference("undertaker", 5, [], 2).suggestedResponse).toBe("酒鬼");
    expect(
      f.reference("undertaker", 5, [], 1).suggestedResponse,
    ).toBeUndefined();
    expect(JSON.stringify(f.view(f.players[5]).publicRecords)).not.toContain(
      "酒鬼",
    );
  });
  it("shows first-night actual candidates and Ravenkeeper actual role without fixing special registration", () => {
    const f = setup();
    const ref = f.reference("librarian");
    expect(ref.evidence.join()).toContain("隐士");
    expect(ref.suggestedResponse).toBeUndefined();
    f.change(6, { alive: false });
    expect(f.reference("ravenkeeper", 6, [f.ids[8]]).suggestedResponse).toBe(
      "隐士",
    );
    expect(f.reference("ravenkeeper", 6, [f.ids[8]]).warnings.join()).toContain(
      "特殊登记",
    );
  });
});

describe("storyteller controls preserve explicit authority", () => {
  it("rejects player controls and stale editors and resets private state for new rounds", () => {
    const f = setup(),
      contextVersion = f.view().storyteller!.contextVersion;
    expect(() =>
      f.act(
        {
          type: "set_red_herring",
          seatId: f.ids[0],
          expectedContextVersion: contextVersion,
        },
        f.players[0],
      ),
    ).toThrow("说书人");
    f.change(0, { conditions: { ...emptyConditions(), poisoned: true } });
    expect(() =>
      f.change(1, { expectedContextVersion: contextVersion }),
    ).toThrow("状态已变化");
    f.act({ type: "end" });
    f.act({ type: "new_round" });
    expect(f.view().storyteller!.conditions).toEqual({});
    expect(f.view().storyteller!.executions).toEqual([]);
    expect(f.view().seats.map((s) => s.id)).toEqual(f.ids);
  });
  it("forces counting separately from execution and cancels provisional votes on execution", () => {
    const f = setup();
    f.act({ type: "next_phase" });
    f.act({ type: "open_vote", nominator: f.ids[0], nominee: f.ids[1] });
    const voteId = f.view().liveVote!.id;
    expect(() =>
      f.act(
        { type: "force_nomination", voteId, reason: "force" },
        f.players[0],
      ),
    ).toThrow("说书人");
    f.act({ type: "force_nomination", voteId, reason: "开始计票" });
    expect(f.view().liveVote!.status).toBe("COUNTING");
    expect(f.view().seats.every((s) => s.alive)).toBe(true);
    expect(() =>
      f.act({ type: "force_nomination", voteId, reason: "repeat" }),
    ).toThrow();
    const command = {
      type: "execute_player",
      seatId: f.ids[1],
      reason: "特殊能力裁定",
      confirmed: true,
      expectedContextVersion: f.view().storyteller!.contextVersion,
    } as const;
    const receipt = randomUUID();
    f.act(command, f.host, receipt);
    f.act(command, f.host, receipt);
    expect(f.view().liveVote!.status).toBe("CANCELLED");
    expect(f.view().seats[1].alive).toBe(false);
    expect(f.view().storyteller!.executions).toHaveLength(1);
    expect(
      f.view().publicRecords.filter((r) => r.type === "vote"),
    ).toHaveLength(0);
  });
  it("retains reminder deadlines across service reloads without advancing or ending votes", () => {
    const f = setup();
    f.act({ type: "next_phase" });
    f.act({ type: "open_vote", nominator: f.ids[0], nominee: f.ids[1] });
    const now = vi.spyOn(Date, "now").mockReturnValue(100000);
    f.act({ type: "day_timer", operation: "start", seconds: 30 });
    const records = f.view().publicRecords;
    expect(f.view().storyteller!.dayTimer!.endsAt).toBe(130000);
    now.mockReturnValue(110000);
    f.act({ type: "day_timer", operation: "pause" });
    expect(f.view().storyteller!.dayTimer!.remainingMs).toBe(20000);
    now.mockReturnValue(120000);
    f.act({ type: "day_timer", operation: "resume" });
    now.mockReturnValue(150000);
    const reloaded = new GameService(f.store).view(f.host.code, f.host.token);
    expect(reloaded.storyteller!.dayTimer!.endsAt).toBe(140000);
    expect(reloaded.phase).toBe("DAY");
    expect(reloaded.liveVote!.status).toBe("OPEN");
    expect(reloaded.publicRecords).toEqual(records);
    expect(JSON.stringify(f.view(f.players[0]))).not.toContain("dayTimer");
    expect(() =>
      f.act({ type: "day_timer", operation: "clear" }, f.players[0]),
    ).toThrow("说书人");
    f.act({
      type: "cancel_vote",
      voteId: reloaded.liveVote!.id,
      reason: "done",
    });
    f.act({ type: "next_phase" });
    expect(f.view().storyteller!.dayTimer).toBeUndefined();
    expect(() =>
      f.act({ type: "day_timer", operation: "start", seconds: 30 }),
    ).toThrow("白天");
  });
});

describe("public voting separates abstention from spent dead votes", () => {
  it("preserves ballot eligibility, follows corrections and keeps original history", () => {
    const f = setup();
    f.change(2, { alive: false });
    f.change(3, { alive: false });
    f.act({
      type: "set_dead_vote",
      seatId: f.ids[3],
      available: false,
      reason: "已用",
    });
    f.act({ type: "next_phase" });
    f.act({ type: "open_vote", nominator: f.ids[0], nominee: f.ids[1] });
    const id = f.view().liveVote!.id;
    f.act({ type: "raise_hand", voteId: id, raised: true }, f.players[2]);
    expect(ballotStatus(f.view().liveVote, [], f.ids[0])).toBe("未举手");
    f.act({ type: "lock_vote", voteId: id });
    f.act({ type: "finish_vote", voteId: id, voters: [f.ids[2]] });
    const old = f.view().publicRecords.at(-1)!;
    expect(
      ballotStatus(f.view().liveVote, f.view().publicRecords, f.ids[2]),
    ).toBe("已投 1 票");
    expect(
      ballotStatus(f.view().liveVote, f.view().publicRecords, f.ids[3]),
    ).toBe("无可用死者票");
    expect(
      ballotStatus(f.view().liveVote, f.view().publicRecords, f.ids[4]),
    ).toBe("未投 / 弃票");
    expect(abstentionSummary(old)).toContain("无可用死者票：4 号");
    f.act({
      type: "record_vote",
      nominator: f.ids[0],
      nominee: f.ids[1],
      voters: [],
      supersedes: old.id,
      reason: "更正误计",
    });
    expect(
      ballotStatus(f.view().liveVote, f.view().publicRecords, f.ids[2]),
    ).toBe("未投 / 弃票");
    expect(f.view().seats[2].deadVoteAvailable).toBe(true);
    expect(f.view().publicRecords.find((r) => r.id === old.id)!.voters).toEqual(
      [f.ids[2]],
    );
  });
});
