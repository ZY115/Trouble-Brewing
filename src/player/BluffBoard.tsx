import { useState } from "react";
import type { RoomView } from "../../shared/types";
import { roleName } from "../../shared/roles";
import type { Send } from "../useRoom";

export default function BluffBoard({ room, send }: { room: RoomView; send: Send }) {
  const [busy, setBusy] = useState(false);
  const board = room.evilBluffs;
  if (!board) return null;
  const me = room.viewer.seatId!;
  const demon = !!room.self?.bluffs;
  const num = (id: string) => room.seats.find((s) => s.id === id)?.number;
  async function act(command: Parameters<Send>[0]) {
    setBusy(true);
    await send(command);
    setBusy(false);
  }
  if (!board.roles.length)
    return (
      <section className="bluff-board" aria-label="假身份">
        <span className="pl-small">恶魔还没有分享假身份。</span>
      </section>
    );
  return (
    <section className="bluff-board" aria-label="假身份">
      <span className="pl-small">不在场的善良角色 · 点一个认领，再点一次放弃</span>
      <div className="bluff-chips">
        {board.roles.map((id) => {
          const holder = Object.entries(board.claims).find(([, r]) => r === id)?.[0];
          const mine = holder === me;
          return (
            <button
              key={id}
              className={mine ? "mine" : holder ? "taken" : ""}
              aria-pressed={mine}
              disabled={busy || (!!holder && !mine)}
              onClick={() => void act({ type: "claim_bluff", roleId: mine ? null : id })}
            >
              <b>{roleName(id)}</b>
              <small>{mine ? "我认领了" : holder ? `${num(holder)} 号认领` : "没人认领"}</small>
            </button>
          );
        })}
      </div>
      {demon &&
        (board.shared ? (
          <span className="pl-small">爪牙已经能看到这三个角色。</span>
        ) : (
          <button className="bluff-share" disabled={busy} onClick={() => void act({ type: "share_bluffs" })}>
            分享给爪牙
          </button>
        ))}
    </section>
  );
}
