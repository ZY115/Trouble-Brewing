import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { GameService } from "../server/game";
import { Store } from "../server/store";
import { commandWithContext } from "../shared/command-context";
import type { Command } from "../shared/commands";
import type { PublicRecord } from "../shared/types";
import { canRecordVote } from "../shared/vote-display";
import { VerdictTask } from "../src/storyteller/TaskViews";
import { dayTasks, executedToday } from "../src/storyteller/tasks";

const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));

function fixture() {
  const store = new Store(":memory:");
  stores.push(store);
  const game = new GameService(store);
  const host = game.create(12, "Vote correction regression");
  const view = () => game.view(host.code, host.token);
  const act = (command: Command) =>
    game.execute(host.code, host.token, randomUUID(), commandWithContext(command, view()), view().gameNo);
  act({ type: "open_registration" });
  const players = Array.from({ length: 12 }, (_, i) => game.join(host.code, i + 1));
  const ids = players.map((p) => game.view(p.code, p.token).viewer.seatId!);
  act({ type: "next_phase" });
  const seat = (id: string) => view().seats.find((s) => s.id === id)!;
  const vote = (voters: string[], prior?: PublicRecord) => {
    act({
      type: "record_vote",
      nominator: ids[0],
      nominee: ids[3],
      voters,
      supersedes: prior?.id,
      reason: prior ? "更正现场记录" : "",
    });
    return view().publicRecords.at(-1)!;
  };
  return { act, view, ids, seat, vote };
}

describe("vote corrections use the ballot's original eligibility", () => {
  it("can remove and restore a consumed ghost vote without losing eligibility", () => {
    const f = fixture();
    const ghost = f.ids[1];
    f.act({ type: "set_alive", seatId: ghost, alive: false });
    const original = f.vote([ghost]);
    expect(f.seat(ghost).deadVoteAvailable).toBe(false);
    expect(canRecordVote(f.seat(ghost))).toBe(false);

    let draft = [...original.voters!];
    draft = draft.filter((id) => id !== ghost);
    expect(canRecordVote(f.seat(ghost), original)).toBe(true);
    draft.push(ghost);
    const retained = f.vote(draft, original);
    expect(retained.deadVoters).toEqual([ghost]);
    expect(f.seat(ghost).deadVoteAvailable).toBe(false);

    const removed = f.vote([], retained);
    expect(f.seat(ghost).deadVoteAvailable).toBe(true);
    expect(canRecordVote(f.seat(ghost), removed)).toBe(true);
    const restored = f.vote([ghost], removed);
    expect(restored.deadVoters).toEqual([ghost]);
    expect(f.seat(ghost).deadVoteAvailable).toBe(false);
  });

  it("can add a vote cast while alive after that player's ghost vote is spent", () => {
    const f = fixture();
    const id = f.ids[1];
    const livingBallot = f.vote([]);
    f.act({ type: "set_alive", seatId: id, alive: false });
    f.vote([id]);
    expect(f.seat(id).deadVoteAvailable).toBe(false);
    expect(canRecordVote(f.seat(id), livingBallot)).toBe(true);

    const corrected = f.vote([id], livingBallot);
    expect(corrected.deadVoters).toEqual([]);
    expect(f.seat(id).deadVoteAvailable).toBe(false);
  });

  it("does not grant historical eligibility from a later revival and preserves unknown legacy records", () => {
    const f = fixture();
    const id = f.ids[1];
    f.act({ type: "set_alive", seatId: id, alive: false });
    f.vote([id]);
    const unavailableBallot = f.vote([]);
    f.act({ type: "set_alive", seatId: id, alive: true });
    expect(canRecordVote(f.seat(id))).toBe(true);
    expect(canRecordVote(f.seat(id), unavailableBallot)).toBe(false);
    expect(canRecordVote(f.seat(id), { ...unavailableBallot, eligibleAtVote: undefined })).toBe(true);
    expect(canRecordVote(f.seat(id), { ...unavailableBallot, voters: [id] })).toBe(true);
  });
});

describe("execution corrections agree across tasks and verdicts", () => {
  it("restores the normal verdict after revocation and still recognizes a new execution", () => {
    const f = fixture();
    const nominee = f.ids[3];
    const record = f.vote(f.ids.slice(0, 6));
    const execute = () => f.act({
      type: "execute_player",
      seatId: nominee,
      reason: "六票处决",
      confirmed: true,
      expectedContextVersion: f.view().storyteller!.contextVersion,
    });
    const render = () => renderToStaticMarkup(createElement(VerdictTask, {
      room: f.view(),
      recordId: record.id,
      send: async () => true,
      onDismiss: () => {},
    }));

    execute();
    const execution = f.view().storyteller!.executions.at(-1)!;
    expect(render()).toContain("今天已经处决过");
    f.act({
      type: "correct_execution",
      executionId: execution.id,
      died: false,
      voided: true,
      alive: true,
      reason: "撤销误处决",
      expectedContextVersion: f.view().storyteller!.contextVersion,
    });
    expect(executedToday(f.view())).toBeUndefined();
    expect(dayTasks(f.view())).toContainEqual({ id: `verdict:${record.id}`, kind: "verdict", recordId: record.id });
    expect(render()).not.toContain("今天已经处决过");
    expect(render()).toMatch(/class="primary"[^>]*>处决 /);

    execute();
    expect(executedToday(f.view())).toBeDefined();
    expect(render()).toContain("今天已经处决过");
  });
});
