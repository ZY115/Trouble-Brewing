import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store";
import { GameService } from "../server/game";
import { commandWithContext } from "../shared/command-context";
import type { NightAction, PublicRecord, RoomView } from "../shared/types";
import InformationHistory, {
  informationItems,
  MyInfo,
} from "../src/player/InformationHistory";
import PlayerRecords from "../src/player/PlayerRecords";

const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
function fixture() {
  const store = new Store(":memory:");
  stores.push(store);
  const game = new GameService(store);
  const host = game.create(12, "History regression");
  game.execute(host.code, host.token, randomUUID(), {
    type: "open_registration",
  });
  const players = Array.from({ length: 12 }, (_, i) =>
    game.join(host.code, i + 1),
  );
  return {
    game,
    host,
    players,
    room: game.view(players[0].code, players[0].token),
  };
}
function responses(room: RoomView) {
  room.phase = "DAY";
  room.actions = Array.from(
    { length: 7 },
    (_, i): NightAction => ({
      id: `a${i + 1}`,
      night: 1,
      seatId: room.viewer.seatId!,
      prompt: "信息",
      targetCount: 0,
      targets: [],
      status: "DELIVERED",
      response: `裁定-${i + 1}`,
      responseVersion: 1,
      responseHistory: [
        {
          version: 1,
          response: `裁定-${i + 1}`,
          sentAt: `2026-11-01T20:0${i}:00Z`,
        },
      ],
    }),
  );
  return room;
}
const record = (
  id: string,
  text: string,
  supersedes?: string,
): PublicRecord => ({
  id,
  text,
  supersedes,
  type: "status",
  day: 1,
  period: "DAY",
  createdAt: "2026-11-01T20:00:00Z",
});

describe("redesigned player history regressions", () => {
  it("previews the newest six and retains all seven in complete history", () => {
    const room = responses(fixture().room);
    const preview = renderToStaticMarkup(createElement(MyInfo, { room }));
    expect(preview).toContain("裁定-7");
    expect(preview).not.toContain("裁定-1");
    expect(preview.indexOf("裁定-7")).toBeLessThan(preview.indexOf("裁定-6"));
    const full = renderToStaticMarkup(
      createElement(InformationHistory, { room }),
    );
    for (let i = 1; i <= 7; i++) expect(full).toContain(`裁定-${i}`);
  });
  it("sorts corrections by delivery time and retains the previous wording", () => {
    const room = responses(fixture().room);
    const a = room.actions[0];
    a.response = "更正后的裁定";
    a.responseVersion = 2;
    a.responseHistory!.push({
      version: 2,
      response: a.response,
      reason: "重新核对",
      sentAt: "2026-11-01T20:20:00Z",
    });
    expect(informationItems(room)[0].body).toBe(a.response);
    const full = renderToStaticMarkup(
      createElement(InformationHistory, { room }),
    );
    expect(full).toContain("裁定-1");
    expect(full).toContain("更正后的裁定");
    expect(full).toContain("重新核对");
  });
  it("sorts legacy responses without timestamps newest first", () => {
    const room = responses(fixture().room);
    room.actions.forEach((a) => {
      delete a.responseHistory;
    });
    expect(informationItems(room).map((i) => i.body)).toEqual(
      [7, 6, 5, 4, 3, 2, 1].map((n) => `裁定-${n}`),
    );
  });
  it("keeps current-night rulings private in both preview and complete history", () => {
    const room = responses(fixture().room);
    room.phase = "FIRST_NIGHT";
    expect(informationItems(room)).toEqual([]);
    expect(
      renderToStaticMarkup(createElement(InformationHistory, { room })),
    ).not.toContain("裁定-7");
  });
  it("renders archived rounds even when the current round is empty, with corrections applied per round", () => {
    const room = fixture().room;
    room.gameNo = 3;
    room.publicRecords = [];
    room.pastPublicRecords = [
      {
        gameNo: 1,
        records: [
          record("old", "旧版投票"),
          record("fixed", "7 号提名自己", "old"),
        ],
      },
      { gameNo: 2, records: [record("two", "上一局公开记录")] },
    ];
    const html = renderToStaticMarkup(createElement(PlayerRecords, { room }));
    expect(html).toContain("当前局");
    expect(html).toContain("7 号提名自己");
    expect(html).not.toContain("旧版投票");
    expect(html.indexOf("上一局公开记录")).toBeLessThan(
      html.indexOf("7 号提名自己"),
    );
  });
  it("supports self-nomination through the server command used by the day screen", () => {
    const { game, host, players } = fixture();
    const execute = (command: Parameters<typeof commandWithContext>[0]) =>
      game.execute(
        host.code,
        host.token,
        randomUUID(),
        commandWithContext(command, game.view(host.code, host.token)),
      );
    execute({ type: "next_phase" });
    const seatId = game.view(players[6].code, players[6].token).viewer.seatId!;
    execute({ type: "open_vote", nominator: seatId, nominee: seatId });
    expect(game.view(host.code, host.token).liveVote).toMatchObject({
      nominator: seatId,
      nominee: seatId,
      status: "OPEN",
    });
  });
});
