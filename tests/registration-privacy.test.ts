import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store";
import { GameService } from "../server/game";
import type { Command } from "../shared/commands";
import type { Session } from "../shared/types";
import { commandWithContext } from "../shared/command-context";
import PlayerApp from "../src/player/PlayerApp";

// Render the real UI; only its browser-only external store hook needs an SSR snapshot.
vi.mock("react", async (load) => {
  const React = await load<typeof import("react")>();
  return {
    ...React,
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) =>
      snapshot(),
  };
});
const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
function fixture() {
  const store = new Store(":memory:");
  stores.push(store);
  const game = new GameService(store);
  const host = game.create(12, "Registration privacy");
  const view = (s: Session) => game.view(s.code, s.token);
  const send = (s: Session, c: Command) =>
    game.execute(s.code, s.token, randomUUID(), commandWithContext(c, view(s)));
  send(host, { type: "open_registration" });
  const player = game.join(host.code, 5);
  const id = view(player).viewer.seatId!;
  const old = () => {
    // Reproduce the save created by older versions: a pre-deal label for seat 5.
    const r = store.get(host.code)!;
    r.notebooks[id] = [
      {
        id: "old-label",
        kind: "claim",
        target: id,
        revisions: [
          {
            version: 1,
            day: 1,
            period: "NIGHT",
            roleId: "empath",
            source: "suspected",
            body: "previous registration test",
            info: {},
            seatNumbers: { [id]: 5 },
            savedAt: new Date().toISOString(),
          },
        ],
      },
    ];
    r.notes[id] = "old registration text";
    r.messages.push({
      id: "old-chat",
      from: "storyteller",
      to: id,
      content: "old registration chat",
      sequence: 1,
      createdAt: new Date().toISOString(),
    });
    store.save(r);
  };
  return { store, game, host, player, id, view, send, old };
}

describe("registration is separate from private game tools", () => {
  it.each(["LOBBY", "SETUP"] as const)(
    "renders only registration controls in %s, even with stale private payloads",
    (phase) => {
      const f = fixture();
      const room = f.view(f.player);
      room.phase = phase;
      room.self!.perceivedRoleId = "empath";
      room.self!.note = "old secret note";
      const html = renderToStaticMarkup(
        createElement(PlayerApp, {
          room,
          send: async () => true,
          connected: true,
          error: "",
          setError: () => {},
          onLeave: () => {},
        }),
      );
      expect(html).toContain("等待入座");
      expect(html).toContain("保存号码");
      for (const forbidden of [
        "私聊",
        "笔记",
        "记录",
        "共情者",
        "old secret note",
        "按住查看身份",
      ])
        expect(html).not.toContain(forbidden);
    },
  );

  it("does not send stale labels, messages or role assignments before dealing", () => {
    const f = fixture();
    f.old();
    f.send(f.player, { type: "move_seat", number: 12 });
    const old = f.store.get(f.host.code)!;
    old.assignments[f.id] = {
      actualRoleId: "empath",
      perceivedRoleId: "empath",
    };
    f.store.save(old);
    const view = f.view(f.player);
    expect(view.self?.perceivedRoleId).toBeUndefined();
    expect(view.self?.note).toBe("");
    expect(view.notebook).toEqual([]);
    expect(view.messages).toEqual([]);
    expect(view.actions).toEqual([]);
    expect(view.pastNotebooks).toEqual([]);
    expect(view.pastPublicRecords).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("empath");
  });

  it("rejects notes, private chat and group operations during registration, but permits number changes", () => {
    const f = fixture();
    const commands: Command[] = [
      { type: "save_note", note: "test" },
      {
        type: "save_notebook",
        kind: "claim",
        target: f.id,
        roleId: "empath",
        source: "suspected",
        body: "test",
        info: {},
        day: 1,
        period: "NIGHT",
        expectedVersion: 0,
      },
      { type: "send_message", to: "storyteller", content: "test" },
      { type: "create_group", name: "test", invitees: [f.id] },
      { type: "invite_group", groupId: "group:test", seatId: f.id },
      { type: "respond_invite", invitationId: "test", accept: true },
      { type: "leave_group", groupId: "group:test" },
    ];
    for (const command of commands)
      expect(() => f.send(f.player, command)).toThrow("尚未发放身份");
    f.send(f.player, { type: "move_seat", number: 12 });
    expect(f.view(f.player).seats[0].number).toBe(12);
  });

  it("clears legacy registration test data at deal and retains real game notes in archives on rematch", () => {
    const f = fixture();
    f.old();
    f.send(f.player, { type: "move_seat", number: 12 });
    for (let n = 1; n <= 11; n++) f.game.join(f.host.code, n);
    const first = f.view(f.player);
    expect(first.phase).toBe("FIRST_NIGHT");
    expect(first.playId).toBeTruthy();
    expect(first.self?.perceivedRoleId).toBeTruthy();
    expect(first.self?.note).toBe("");
    expect(first.notebook).toEqual([]);
    expect(first.messages).toEqual([]);
    f.send(f.player, {
      type: "save_notebook",
      kind: "text",
      target: "",
      roleId: "",
      source: "suspected",
      body: "real game note",
      info: {},
      day: 1,
      period: "NIGHT",
      expectedVersion: 0,
    });
    f.send(f.player, {
      type: "send_message",
      to: "storyteller",
      content: "in-game clarification",
    });
    f.send(f.host, { type: "end" });
    f.send(f.host, { type: "new_round" });
    expect(f.view(f.player).pastNotebooks).toEqual([]);
    f.send(f.host, { type: "open_registration" });
    const next = f.view(f.player);
    expect(next.playId).not.toBe(first.playId);
    expect(next.notebook).toEqual([]);
    expect(next.pastNotebooks).toEqual([]);
    expect(
      f.store.get(f.host.code)!.archives[0].notebooks[f.id][0].revisions[0]
        .body,
    ).toBe("real game note");
    expect(JSON.stringify(next)).not.toContain("previous registration test");
  });
});
