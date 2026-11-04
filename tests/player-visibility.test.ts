import { describe, expect, it } from "vitest";
import type { NightAction, RoomView } from "../shared/types";
import {
  nightMessages,
  revealedActions,
  visibleRoom,
} from "../src/player/visibility";

const action = (night: number, status: NightAction["status"]): NightAction => ({
  id: `a${night}${status}`,
  night,
  seatId: "me",
  prompt: "请选择今晚要查验的两位玩家。",
  targetCount: 2,
  targets: ["x", "y"],
  status,
  response: "是",
});

function room(phase: RoomView["phase"], day: number): RoomView {
  return {
    code: "ABCDEF",
    title: "",
    capacity: 10,
    phase,
    day,
    revision: 1,
    gameNo: 1,
    groups: [],
    invitations: [],
    notebook: [],
    pastNotebooks: [],
    publicRecords: [
      {
        id: "p1",
        day: 1,
        period: "DAY",
        type: "phase",
        text: "进入第 1 天",
        createdAt: "2026-11-01T20:00:00Z",
      },
      {
        id: "p2",
        day: 2,
        period: "NIGHT",
        type: "phase",
        text: "进入第 2 夜",
        createdAt: "2026-11-01T20:30:00Z",
      },
    ],
    pastPublicRecords: [],
    seatRequests: [],
    registration: {
      open: false,
      joined: 10,
      duplicateNumbers: [],
      missingNumbers: [],
      ready: true,
    },
    seats: [],
    viewer: { kind: "player", seatId: "me" },
    messages: [
      {
        id: "m1",
        from: "storyteller",
        to: "me",
        content: "首夜信息",
        createdAt: "2026-11-01T19:50:00Z",
        sequence: 1,
      },
      {
        id: "m2",
        from: "storyteller",
        to: "me",
        content: "白天私聊",
        createdAt: "2026-11-01T20:10:00Z",
        sequence: 2,
      },
      {
        id: "m3",
        from: "storyteller",
        to: "me",
        content: "第二夜私信",
        createdAt: "2026-11-01T20:40:00Z",
        sequence: 3,
      },
      {
        id: "m4",
        from: "me",
        to: "storyteller",
        content: "我发的",
        createdAt: "2026-11-01T20:41:00Z",
        sequence: 4,
      },
    ],
    evilEnabled: false,
    actions: [action(1, "DELIVERED"), action(2, "DELIVERED")],
  } as RoomView;
}

describe("rulings and private replies reach the player immediately", () => {
  it("shows tonight's delivered ruling while it is still night", () => {
    expect(revealedActions(room("OTHER_NIGHT", 2)).map((a) => a.night)).toEqual([1, 2]);
    expect(revealedActions(room("DAY", 2)).map((a) => a.night)).toEqual([1, 2]);
  });

  it("shows the first night's ruling during the first night", () => {
    const first = {
      ...room("FIRST_NIGHT", 1),
      actions: [action(1, "DELIVERED")],
    };
    expect(revealedActions(first)).toHaveLength(1);
  });

  it("never shows a ruling that has not been sent", () => {
    const pending = { ...room("OTHER_NIGHT", 2), actions: [action(2, "SUBMITTED")] };
    expect(revealedActions(pending)).toEqual([]);
  });

  it("shows private replies immediately during the night", () => {
    const night = visibleRoom(room("OTHER_NIGHT", 2)).messages.map((m) => m.id);
    expect(night).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("files storyteller messages under the night they arrived", () => {
    const list = nightMessages(room("DAY", 2));
    expect(list.find((m) => m.id === "m1")).toMatchObject({
      night: 1,
      atNight: true,
    });
    expect(list.find((m) => m.id === "m2")).toMatchObject({ atNight: false });
    expect(list.find((m) => m.id === "m3")).toMatchObject({
      night: 2,
      atNight: true,
    });
  });
});
