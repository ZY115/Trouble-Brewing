import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { createApp } from "../server/app";
import { phaseReview } from "../shared/phase-review";
import type { Command } from "../shared/commands";
import type { RoomView, Session } from "../shared/types";

it("keeps ten consecutive 12-player games isolated, durable and bounded in live payload/latency", async () => {
  const folder = mkdtempSync(join(tmpdir(), "clocktower-ten-rounds-"));
  const database = join(folder, "room.sqlite");
  let app = createApp(database);
  let sockets: Socket[] = [];
  const samples: { game: number; liveBytes: number; playerBytes: number; hotBytes: number; databaseBytes: number; receipts: number; p50Ms: number; p95Ms: number; maxMs: number }[] = [];
  const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
  try {
    await new Promise<void>(resolve => app.server.listen(0, "127.0.0.1", resolve));
    let url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    const host = app.game.create(12, "Ten rounds");
    const view = (session = host) => app.game.view(host.code, session.token, false);
    let gameNo = 1;
    const send = (command: Command, session = host, id = randomUUID()) => app.game.execute(host.code, session.token, id, command, gameNo);
    send({ type: "open_registration" });
    let players = Array.from({ length: 12 }, (_, n) => app.game.join(host.code, n + 1));
    let ids = players.map(s => view(s).viewer.seatId!);
    const idsByGame: string[][] = [];
    const latest: RoomView[] = [];
    const connect = async (session: Session, index: number) => {
      const socket = io(url, { autoConnect: false, transports: ["websocket"], auth: session });
      const first = new Promise<void>((resolve, reject) => { socket.once("state", () => resolve()); socket.once("connect_error", reject); });
      socket.on("state", (r: RoomView) => { latest[index] = r; socket.emit("state_ack", { gameNo: r.gameNo, revision: r.revision }); });
      socket.connect(); await first;
      return socket;
    };
    const connectAll = async () => {
      sockets.forEach(s => s.disconnect());
      sockets = await Promise.all([host, ...players].map(connect));
    };
    const socketCommand = (index: number, command: Command, expectedGame = gameNo, commandId = randomUUID()) =>
      sockets[index].timeout(5000).emitWithAck("command", { commandId, gameNo: expectedGame, command });
    const sendSocket = async (index: number, command: Command, expectedGame = gameNo, commandId = randomUUID()) => {
      const ack = await socketCommand(index, command, expectedGame, commandId);
      expect(ack, `${command.type}: ${ack.error ?? ""}`).toMatchObject({ ok: true });
    };
    await connectAll();
    const firstStartReceipt = randomUUID();
    for (gameNo = 1; gameNo <= 10; gameNo++) {
      if (gameNo > 1) {
        const start = view();
        expect(start.phase).toBe("SETUP");
        expect(start.storyteller!.archiveGames).toHaveLength(gameNo - 1);
        if (start.roundSetup!.mode === "rescan") {
          for (const p of players) expect(() => view(p)).toThrow("会话无效");
          expect(start.seats).toEqual([]);
          await sendSocket(0, { type: "open_registration" });
          players = await Promise.all(Array.from({ length: 12 }, async (_, n) => {
            const res = await fetch(`${url}/api/rooms/${host.code}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ number: n + 1, gameNo }) });
            expect(res.status).toBe(201);
            return res.json() as Promise<Session>;
          }));
          const oldIds = ids;
          ids = players.map(p => view(p).viewer.seatId!);
          expect(ids.every(id => !oldIds.includes(id))).toBe(true);
        }
        await connectAll();
        for (const [index, p] of players.entries()) {
          const clean = latest[index + 1];
          expect(clean.gameNo).toBe(gameNo);
          expect(clean.viewer.seatId).toBe(view(p).viewer.seatId);
          expect(clean.messages).toEqual([]); expect(clean.notebook).toEqual([]); expect(clean.actions).toEqual([]);
          expect(clean.pastRecaps).toEqual([]); expect(clean.pastPublicRecords).toEqual([]); expect(clean.pastNotebooks).toEqual([]);
          expect(clean.groups).toEqual([]); expect(clean.invitations).toEqual([]); expect(clean.recap).toBeUndefined(); expect(clean.liveVote).toBeUndefined();
          if (start.roundSetup!.mode !== "rescan") expect(clean.self?.perceivedRoleId).toBeUndefined();
        }
        expect(await socketCommand(1, { type: "send_message", to: "storyteller", content: "STALE_ROUND_COMMAND" }, gameNo - 1))
          .toMatchObject({ ok: false, error: "已进入新一局，请刷新后操作" });
        if (start.roundSetup!.mode === "host") {
          const seats = start.seats.map(s => ({ seatId: s.id, number: s.number === 1 ? 2 : s.number === 2 ? 1 : s.number }));
          await sendSocket(0, { type: "set_seating", expectedContextVersion: start.storyteller!.contextVersion, seats });
          expect(view(players[0]).viewer.seatId).toBe(ids[0]);
          expect(view().seats.map(s => [s.id, s.number])).toEqual([...seats].sort((a, b) => a.number - b.number).map(s => [s.seatId, s.number]));
        }
        if (start.roundSetup!.mode !== "rescan") await sendSocket(0, { type: "open_registration" });
      }
      idsByGame.push([...ids]);
      expect(view().phase).toBe("FIRST_NIGHT");
      const duplicateId = randomUUID();
      for (let n = 0; n < 20; n++) {
        await Promise.all(players.map((_, index) => sendSocket(index + 1, { type: "send_message", to: "storyteller", content: `ROUND_${gameNo}: ${index}/${n} ${"聊天内容".repeat(40)}` }, gameNo, n === 0 && index === 0 ? duplicateId : randomUUID())));
      }
      for (let n = 0; n < 10; n++) await Promise.all(players.map((_, i) => sendSocket(i + 1, { type: "add_note", body: `ROUND_${gameNo}: ${n} ${"个人笔记".repeat(60)}` })));
      await Promise.all(ids.map(seatId => sendSocket(0, { type: "request_action", seatId, prompt: "请选择一名玩家", targetCount: 1, expectedPhaseVersion: view().storyteller!.phaseVersion })));
      const actions = players.map(player => view(player).actions.at(-1)!);
      await Promise.all(actions.map((action, index) => sendSocket(index + 1, { type: "submit_action", actionId: action.id, targets: [ids[(index + 1) % 12]], expectedVersion: 0 })));
      if (gameNo === 4 || gameNo === 7) {
        const before = players.map(p => view(p));
        sockets.forEach(s => s.disconnect());
        await app.close(); app = createApp(database);
        await new Promise<void>(resolve => app.server.listen(0, "127.0.0.1", resolve));
        url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
        await connectAll();
        players.forEach((_, i) => expect(latest[i + 1]).toMatchObject({ gameNo, playId: before[i].playId, self: before[i].self,
          messages: before[i].messages, notebook: before[i].notebook, actions: before[i].actions }));
      }
      expect(await sockets[1].timeout(5000).emitWithAck("command_status", { commandId: duplicateId })).toEqual({ ok: true, applied: true });
      const priorRevision = view().revision;
      await sendSocket(1, { type: "send_message", to: "storyteller", content: "DUPLICATE_MUST_NOT_APPEAR" }, gameNo, duplicateId);
      expect(view().revision).toBe(priorRevision);
      expect(view().messages).toHaveLength(240);
      await Promise.all(actions.map(action => sendSocket(0, { type: "send_action_response", actionId: action.id, response: "已收到", expectedVersion: 1, expectedContextVersion: view().storyteller!.contextVersion })));
      await sendSocket(0, { type: "next_phase", expectedPhaseVersion: view().storyteller!.phaseVersion, expectedReviewKey: phaseReview(view(), true).key, publishLifeOnDawn: true });
      await sendSocket(0, { type: "open_vote", nominator: ids[0], nominee: ids[1] });
      let vote = view().liveVote!;
      await Promise.all(players.map((_, i) => sendSocket(i + 1, { type: "raise_hand", voteId: vote.id, raised: i % 2 === 0 })));
      await sendSocket(0, { type: "lock_vote", voteId: vote.id });
      vote = view().liveVote!;
      expect(vote.order.filter(id => vote.counted[id])).toHaveLength(6);
      await sendSocket(0, { type: "finish_vote", voteId: vote.id, voters: vote.order.filter((id) => vote.counted[id]) });
      expect(view().liveVote!.status).toBe("FINISHED");
      await sendSocket(0, { type: "next_phase", expectedPhaseVersion: view().storyteller!.phaseVersion, expectedReviewKey: phaseReview(view(), true).key });
      expect(view().phase).toBe("OTHER_NIGHT");
      const latencies: number[] = [];
      for (let sample = 0; sample < 60; sample++) {
        const index = sample % 12, socket = sockets[index + 1], t = performance.now();
        const ack = await socket.timeout(5000).emitWithAck("command", { commandId: randomUUID(), gameNo,
          command: { type: "send_message", to: "storyteller", content: `ROUND_${gameNo}: latency sample ${sample}` } });
        expect(ack.ok).toBe(true);
        latencies.push(performance.now() - t);
      }
      await expect.poll(() => latest[0]?.revision).toBe(view().revision);
      const hot = (app.store.db.prepare("SELECT body FROM rooms WHERE code = ?").get(host.code) as { body: string }).body;
      expect(JSON.parse(hot).archives).toEqual([]); expect(JSON.parse(hot).applied).toEqual([]);
      expect(latest[0].pastRecaps).toEqual([]); expect(latest[0].pastPublicRecords).toEqual([]);
      const privateView = latest[1];
      expect(privateView.storyteller).toBeUndefined();
      if (gameNo > 1) expect(JSON.stringify(privateView)).not.toContain(`ROUND_${gameNo - 1}:`);
      players.forEach(p => {
        expect(view(p).messages).toHaveLength(25);
        expect(view(p).notebook).toHaveLength(10);
        expect(view(p).actions.at(-1)).toMatchObject({ status: "DELIVERED", response: "已收到" });
      });
      app.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      samples.push({ game: gameNo, liveBytes: Buffer.byteLength(JSON.stringify(latest[0])),
        playerBytes: Buffer.byteLength(JSON.stringify(privateView)), hotBytes: Buffer.byteLength(hot),
        databaseBytes: statSync(database).size,
        receipts: (app.store.db.prepare("SELECT COUNT(*) AS n FROM receipts").get() as { n: number }).n,
        p50Ms: percentile(latencies, .5), p95Ms: percentile(latencies, .95), maxMs: Math.max(...latencies) });
      await sendSocket(0, { type: "finish_game", mode: "normal", winner: "good", endDay: false, reason: "连续对局功能测试", confirmed: true, expectedReviewKey: view().storyteller!.endReview!.key });
      if (gameNo < 10) {
        const id = gameNo === 1 ? firstStartReceipt : randomUUID();
        sockets[1].disconnect();
        const seatMode = (["keep", "host", "rescan"] as const)[(gameNo - 1) % 3];
        await sendSocket(0, { type: "new_round", seatMode }, gameNo, id);
      }
    }
    const revision = view().revision;
    app.game.execute(host.code, host.token, firstStartReceipt, { type: "new_round", seatMode: "keep" }, 1);
    expect(view().revision).toBe(revision);
    expect(view().gameNo).toBe(10);
    expect(app.store.archiveGames(host.code)).toHaveLength(9);
    for (let n = 1; n <= 9; n++) {
      const archive = app.store.archive(host.code, n)!;
      expect(archive.notebooks[idsByGame[n - 1][0]][0].revisions[0].body).toContain(`ROUND_${n}:`);
      expect(() => app.game.history(host.code, players[0].token, n)).toThrow("仅限说书人");
      expect(app.game.history(host.code, host.token, n).recap?.gameNo).toBe(n);
    }
    expect(samples[9].liveBytes).toBeLessThan(samples[0].liveBytes * 1.15);
    expect(samples[9].hotBytes).toBeLessThan(samples[0].hotBytes * 1.15);
    expect(Math.max(...samples.map(s => s.p95Ms))).toBeLessThan(1000);
    app.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const report = { generatedAt: new Date().toISOString(), node: process.version, platform: process.platform,
      scenario: "12 players + 1 host, 10 rounds; per round: 300 chats, 120 notes, 12 submitted/delivered actions and 12-voter count via live sockets; keep/host/rescan repeated; offline cross-round return; restarts during rounds 4 and 7; 60 socket latency samples", databaseBytes: statSync(database).size, samples };
    console.log("TEN_ROUND_REPORT", JSON.stringify(report));
    if (process.env.CLOCKTOWER_QA_REPORT) { mkdirSync(dirname(process.env.CLOCKTOWER_QA_REPORT), { recursive: true }); writeFileSync(process.env.CLOCKTOWER_QA_REPORT, JSON.stringify(report, null, 2)); }
  } finally {
    sockets.forEach(s => s.disconnect()); await app.close(); rmSync(folder, { recursive: true, force: true });
  }
}, 120000);
