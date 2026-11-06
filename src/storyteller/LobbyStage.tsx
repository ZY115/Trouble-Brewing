import { useState } from "react";
import type { RoomView } from "../../shared/types";
import { ROLES, roleName, type Team } from "../../shared/roles";
import { validateSetup } from "../../shared/setup";
import type { Send } from "../useRoom";
import Grimoire, { roleGlyph, type GrimoireSeat } from "../ui/Grimoire";
import Invitation from "../components/Invitation";
import Registration from "../components/Registration";
import DebugPanel from "./DebugPanel";
import { SeatingEditor } from "./NextRound";

const TEAMS: [Team, string, string][] = [
  ["townsfolk", "镇民", "var(--town)"],
  ["outsider", "外来者", "var(--out)"],
  ["minion", "爪牙", "var(--minion)"],
  ["demon", "恶魔", "var(--demon)"],
];

export default function LobbyStage({
  room,
  send,
  openSetup,
  onScan,
}: {
  room: RoomView;
  send: Send;
  openSetup: () => void;
  onScan: () => void;
}) {
  const st = room.storyteller!;
  const [busy, setBusy] = useState(false);
  const status = room.registration;
  const seats: GrimoireSeat[] = Array.from({ length: room.capacity }, (_, i) => {
    const n = i + 1;
    const count = room.seats.filter((s) => s.number === n).length;
    return {
      key: `n${n}`,
      number: n,
      glyph: String(n),
      label: count > 1 ? `${count} 人重号` : undefined,
      tone: count > 1 ? "conflict" : count ? "neutral" : "empty",
      ariaLabel: `${n} 号，${count > 1 ? `${count} 人重号` : count ? "已登记" : "未登记"}`,
    };
  });
  const issues = validateSetup(room.capacity, st.setup);
  const mode = room.roundSetup?.mode;
  const seatingPending = mode === "host" && !room.roundSetup!.seatingConfirmed;
  const setupPanel = (
    <section className="panel" aria-label="配板">
      <div className="panel-heading">
        <h3>配板</h3>
        <span className="muted" style={{ fontSize: 12 }}>
          {status.open ? "入场开放中 · 已锁定" : `${room.capacity} 人局`}
        </span>
      </div>
      {TEAMS.map(([team, name, color]) => {
        const roles = st.setup.roleIds.filter(
          (id) => ROLES.find((r) => r.id === id)?.team === team,
        );
        if (!roles.length) return null;
        return (
          <div className="setup-chips" key={team}>
            <span className="muted" style={{ width: 56, fontSize: 12 }}>
              {name} {roles.length}
            </span>
            {roles.map((id) => (
              <span key={id} className="role-chip" style={{ color }} title={roleName(id)}>
                {roleGlyph(id)}
              </span>
            ))}
          </div>
        );
      })}
      <span className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
        {st.setup.roleIds.includes("drunk") ? `酒鬼以为自己是${roleName(st.setup.drunkAs)} · ` : ""}
        假身份：{st.setup.bluffs.map(roleName).join("、") || "未设置"}
      </span>
      {issues.some((i) => i.level === "error") && (
        <p className="reference-warning">
          {issues.filter((i) => i.level === "error").map((i) => i.message).join("；")}
        </p>
      )}
      <button disabled={status.open} onClick={openSetup}>
        {status.open ? "暂停入场后可修改配板" : "打开配板工坊"}
      </button>
    </section>
  );
  async function act(command: Parameters<Send>[0]) {
    setBusy(true);
    await send(command);
    setBusy(false);
  }
  return (
    <main className="lobby-grid" style={{ gridColumn: "1 / 3" }}>
      <div className="stage-circle" style={{ margin: "0 auto" }}>
        <Grimoire
          label="入座情况"
          capacity={room.capacity}
          seats={seats}
          center={
            <>
              <span className="eyebrow">{status.open ? "玩家正在扫码" : "尚未开放入场"}</span>
              <span className="tally" style={{ color: "var(--text)" }}>
                {status.joined}
                <span className="muted" style={{ fontSize: 22 }}> / {room.capacity}</span>
              </span>
              {!!status.duplicateNumbers.length && (
                <span style={{ color: "var(--danger)", fontSize: 14 }}>
                  {status.duplicateNumbers.join("、")} 号重复
                </span>
              )}
              {!!status.missingNumbers.length && status.missingNumbers.length <= 4 && (
                <span className="muted" style={{ fontSize: 14 }}>
                  还差 {status.missingNumbers.join("、")} 号
                </span>
              )}
              <span className="muted" style={{ fontSize: 12 }}>
                号码齐全且不重复时自动发身份
              </span>
            </>
          }
        />
      </div>
      <div className="lobby-side">
        <DebugPanel room={room} send={send} />
        {mode === "host" && room.seats.length > 0 && <SeatingEditor room={room} send={send} />}
        {mode === "rescan" && !room.seats.length && (
          <p className="lobby-callout">这一局所有玩家都要重新扫码登记。</p>
        )}
        {status.open ? (
          <>
            <Invitation room={room} onFullscreen={onScan} />
            <button disabled={busy} onClick={() => void act({ type: "close_registration" })}>
              暂停入场 · 修改配板
            </button>
            {setupPanel}
          </>
        ) : (
          <>
            {setupPanel}
            <button
              className="primary"
              disabled={busy || seatingPending}
              onClick={() => void act({ type: "open_registration" })}
            >
              {seatingPending ? "先确认座位表" : "确认配板并开放入场"}
            </button>
          </>
        )}
        <details className="panel">
          <summary>登记明细与异常处理</summary>
          <Registration room={room} send={send} />
        </details>
      </div>
    </main>
  );
}
