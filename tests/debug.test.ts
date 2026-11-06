import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store";
import { GameService } from "../server/game";
import { createApp } from "../server/app";
import { commandWithContext } from "../shared/command-context";
import type { Command } from "../shared/commands";
import type { Session } from "../shared/types";
const stores: Store[] = [];
const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  stores.splice(0).forEach((s) => s.close());
  for (const app of apps.splice(0)) await app.close();
});
function fixture(debug = true, capacity = 12) {
  const store = new Store(":memory:");
  stores.push(store);
  const game = new GameService(store, debug);
  const host = game.create(capacity, "Solo test");
  const view = (s = host) => game.view(s.code, s.token);
  const send = (c: Command, s = host, receipt = randomUUID()) =>
    game.execute(
      s.code,
      s.token,
      receipt,
      commandWithContext(c, view(s)),
      view(s).gameNo,
    );
  const player = (index: number) =>
    game.debugPlayerSession(host.code, host.token, view().seats[index].id);
  return { store, game, host, view, send, player };
}

describe("explicit solo debug mode", () => {
  it.each([false, true])("identifies the running mode in HTTP health (debug=%s)", async (debug) => {
    const app = createApp(":memory:", { debug });
    apps.push(app);
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const port = (app.server.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ ok: true, service: "clocktower-tb", debug });
  });

  it("is unavailable in normal mode even to the host", () => {
    const f = fixture(false);
    expect(f.view().storyteller?.debug).toBeUndefined();
    expect(() => f.send({ type: "debug_fill", start: true })).toThrow(
      "调试模式未开启",
    );
    expect(() =>
      f.game.debugPlayerSession(f.host.code, f.host.token, "seat"),
    ).toThrow("调试模式未开启");
    expect(f.view().seats).toEqual([]);
  });

  it.each([10, 11, 12, 13])(
    "fills a %i-player game once and deals through the real registration workflow",
    (capacity) => {
      const f = fixture(true, capacity),
        receipt = randomUUID();
      f.send({ type: "debug_fill", start: true }, f.host, receipt);
      f.send({ type: "debug_fill", start: true }, f.host, receipt);
      expect(f.view().phase).toBe("FIRST_NIGHT");
      expect(f.view().registration.ready).toBe(true);
      expect(f.view().seats).toHaveLength(capacity);
      expect(f.view().storyteller!.debug!.seatIds).toHaveLength(capacity);
      for (let i = 0; i < capacity; i++) {
        const p = f.player(i),
          v = f.view(p);
        expect(v.self?.perceivedRoleId).toBeTruthy();
        expect(v.storyteller).toBeUndefined();
        expect(v.seats.some((s) => "actualRoleId" in s)).toBe(false);
        expect(f.player(i)).toEqual(p);
      }
      expect(() => f.send({ type: "debug_fill", start: true })).toThrow(
        "已经发放",
      );
    },
  );

  it("can fill while paused for registration tests, then start without adding duplicate players", () => {
    const f = fixture();
    f.send({ type: "debug_fill", start: false });
    const before = f.view().seats;
    expect(f.view().registration.open).toBe(false);
    expect(f.view(f.player(0)).self?.perceivedRoleId).toBeUndefined();
    f.send({ type: "debug_fill", start: false });
    expect(f.view().seats).toEqual(before);
    f.send({ type: "debug_fill", start: true });
    expect(f.view().phase).toBe("FIRST_NIGHT");
    expect(f.view().seats.map((s) => s.id)).toEqual(before.map((s) => s.id));
  });

  it("keeps manually registered players and does not grant access to their identities", () => {
    const f = fixture();
    f.send({ type: "open_registration" });
    const real = f.game.join(f.host.code, 7),
      realId = f.view(real).viewer.seatId!;
    f.send({ type: "debug_fill", start: true });
    expect(f.view().storyteller!.debug!.seatIds).toHaveLength(11);
    expect(f.view(real).seats.find((s) => s.id === realId)?.number).toBe(7);
    expect(() =>
      f.game.debugPlayerSession(f.host.code, f.host.token, realId),
    ).toThrow("只能打开测试玩家");
    const id = f.view().storyteller!.debug!.seatIds[0];
    expect(() =>
      f.game.debugPlayerSession(f.host.code, real.token, id),
    ).toThrow("仅限说书人");
    expect(() => f.send({ type: "debug_fill", start: true }, real)).toThrow(
      "仅限说书人",
    );
  });

  it("does not silently fix duplicate numbers or skip invalid setup validation", () => {
    const f = fixture();
    f.send({ type: "open_registration" });
    f.game.join(f.host.code, 1);
    f.game.join(f.host.code, 1);
    const before = f.view();
    expect(() => f.send({ type: "debug_fill", start: true })).toThrow(
      "重复号码",
    );
    expect(f.view()).toEqual(before);
    const bad = fixture();
    const setup = structuredClone(bad.view().storyteller!.setup);
    setup.roleIds[1] = setup.roleIds[0];
    bad.send({ type: "save_setup", setup });
    expect(() => bad.send({ type: "debug_fill", start: true })).toThrow();
    expect(bad.view().seats).toEqual([]);
  });

  it("uses real player permissions for actions, private chat, notes, voting and a rematch", () => {
    const f = fixture();
    f.send({ type: "debug_fill", start: true });
    const a = f.player(0),
      b = f.player(1);
    const aid = f.view(a).viewer.seatId!,
      bid = f.view(b).viewer.seatId!;
    expect(() => f.send({ type: "end" }, a)).toThrow("仅限说书人");
    f.send({
      type: "request_action",
      seatId: aid,
      prompt: "请选择一名玩家",
      targetCount: 1,
    });
    const action = f.view(a).actions[0];
    f.send(
      {
        type: "submit_action",
        actionId: action.id,
        targets: [bid],
        expectedVersion: 0,
      },
      a,
    );
    expect(f.view().actions[0].targets).toEqual([bid]);
    expect(f.view(b).actions).toEqual([]);
    f.send({
      type: "send_action_response",
      actionId: action.id,
      response: "测试裁定",
      expectedVersion: 1,
      expectedContextVersion: f.view().storyteller!.contextVersion,
    });
    expect(f.view(a).actions[0].response).toBe("测试裁定");
    f.send({ type: "send_message", to: bid, content: "only B can read" }, a);
    expect(f.view(b).messages[0].content).toBe("only B can read");
    expect(f.view().messages).toEqual([]);
    f.send({ type: "save_note", note: "only A's note" }, a);
    expect(f.view(b).self?.note).toBe("");
    f.send({ type: "next_phase" });
    f.send({ type: "open_vote", nominator: aid, nominee: bid });
    const vote = f.view().liveVote!;
    f.send({ type: "raise_hand", voteId: vote.id, raised: true }, a);
    expect(f.view().liveVote!.hands[aid]).toBe(true);
    f.send({ type: "lock_vote", voteId: vote.id });
    f.send({ type: "finish_vote", voteId: vote.id, voters: [aid] });
    expect(
      f.view().publicRecords.find((r) => r.type === "vote")?.voters,
    ).toEqual([aid]);
    f.send({ type: "end" });
    f.send({ type: "new_round" });
    f.send({ type: "debug_fill", start: true });
    expect(f.view().gameNo).toBe(2);
    expect(f.player(0)).toEqual(a);
    expect(f.view(a).self?.note).toBe("");
    expect(
      f.store.get(f.host.code)!.archives[0].notebooks[aid][0].revisions[0].body,
    ).toBe("only A's note");
    const reopened = new GameService(f.store, true);
    expect(reopened.debugPlayerSession(f.host.code, f.host.token, aid)).toEqual(
      a,
    );
  });

  it("revokes removed test-player sessions and cannot reopen their old URLs", () => {
    const f = fixture();
    f.send({ type: "debug_fill", start: false });
    const a = f.player(0),
      id = f.view(a).viewer.seatId!;
    f.send({ type: "remove_player", seatId: id });
    expect(() => f.view(a)).toThrow("会话无效");
    expect(() =>
      f.game.debugPlayerSession(f.host.code, f.host.token, id),
    ).toThrow("只能打开测试玩家");
    f.send({ type: "debug_fill", start: true });
    expect(f.view().storyteller!.debug!.seatIds).toHaveLength(12);
    expect(f.player(0).token).not.toBe(a.token);
  });

  it.each([false, true])(
    "protects the HTTP debug endpoint (enabled=%s)",
    async (enabled) => {
      const app = createApp(":memory:", { debug: enabled });
      apps.push(app);
      await new Promise<void>((resolve) =>
        app.server.listen(0, "127.0.0.1", resolve),
      );
      const host = app.game.create(12, "Endpoint");
      const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
      const request = (auth: Session, seatId: string) =>
        fetch(`${url}/api/rooms/${host.code}/debug/player`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({ seatId }),
        });
      if (!enabled) {
        expect((await request(host, "fake")).status).toBe(404);
        return;
      }
      app.game.execute(host.code, host.token, randomUUID(), {
        type: "debug_fill",
        start: true,
      });
      const id = app.game.view(host.code, host.token).seats[0].id;
      const response = await request(host, id);
      expect(response.ok).toBe(true);
      const player = (await response.json()) as Session;
      expect(app.game.view(player.code, player.token).viewer).toEqual({
        kind: "player",
        seatId: id,
      });
      expect((await request(player, id)).ok).toBe(false);
      expect(
        (await request({ code: host.code, token: "x".repeat(43) }, id)).ok,
      ).toBe(false);
    },
  );
});
