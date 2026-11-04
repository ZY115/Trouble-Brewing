import { useState } from "react";
import { hostSessions } from "../session";
import { useRoom } from "../useRoom";
import { PHASE_NAMES, type RoomView } from "../../shared/types";
import { roleName } from "../../shared/roles";
import { debugPlayers, debugPlayerStatus, nextWaitingPlayer } from "./players";
import "./workbench.css";

function PlayerFrames({ room }: { room: RoomView }) {
  const players = debugPlayers(room);
  const [selected, setSelected] = useState(players[0]?.id ?? "");
  const [visited, setVisited] = useState<string[]>(players[0] ? [players[0].id] : []);
  const active = players.some(p => p.id === selected) ? selected : players[0]?.id ?? "";
  const waiting = nextWaitingPlayer(room, active);
  const show = (id: string) => {
    setSelected(id);
    setVisited(old => old.includes(id) ? old : [...old, id]);
  };
  const cycle = (step: number) => {
    const index = players.findIndex(p => p.id === active);
    if (players.length) show(players[(index + step + players.length) % players.length].id);
  };
  return <>
    <nav className="debug-seats" aria-label="切换测试玩家">
      {players.map(seat => <button key={seat.id} type="button" aria-pressed={active === seat.id} onClick={() => show(seat.id)}>
        <b>{seat.number} 号</b>
        <span>{room.storyteller?.assignments[seat.id] ? roleName(room.storyteller.assignments[seat.id].actualRoleId) : "未发身份"}</span>
        <small>{debugPlayerStatus(room, seat.id)}</small>
      </button>)}
      {!players.length && <span>先在左侧补齐测试玩家，或使用上方的开局按钮。</span>}
    </nav>
    <div className="debug-screens">
      <section className="debug-host">
        <div className="debug-screen-title">说书人</div>
        <iframe title="同屏调试：说书人" src={`/host?room=${room.code}&debugEmbed=1`} />
      </section>
      <section className="debug-phone">
        <div className="debug-screen-title">
          <button disabled={!players.length} aria-label="上一个测试玩家" onClick={() => cycle(-1)}>←</button>
          <b>{players.find(p => p.id === active)?.number ?? "—"} 号玩家</b>
          <button disabled={!players.length} aria-label="下一个测试玩家" onClick={() => cycle(1)}>→</button>
          <button disabled={!waiting} onClick={() => waiting && show(waiting)}>下一个待操作</button>
        </div>
        <div className="debug-player-pages">
          {[...new Set([...visited, active])].filter(id => players.some(p => p.id === id)).map(id => <iframe
            key={id} title={`同屏调试：${players.find(p => p.id === id)!.number} 号玩家`}
            hidden={id !== active}
            src={`/join/${room.code}?debugSeat=${encodeURIComponent(id)}&debugEmbed=1`}
          />)}
          {!active && <p className="debug-placeholder">测试玩家页面会显示在这里。</p>}
        </div>
      </section>
    </div>
  </>;
}

export default function DebugWorkbench() {
  const [session] = useState(() => {
    const code = new URLSearchParams(location.search).get("room")?.toUpperCase();
    return hostSessions().find(host => host.code === code) ?? null;
  });
  const { room, send, error, connected } = useRoom(session);
  const [busy, setBusy] = useState(false);
  if (!session) return <main className="debug-workbench"><p>请从说书人页面的“调试玩家”进入同屏调试台。</p><a href="/host">打开说书人入口</a></main>;
  if (!room) return <main className="debug-workbench"><p>{error || "正在连接调试房间…"}</p><a href={`/host?room=${session.code}`}>返回说书人</a></main>;
  if (!room.storyteller?.debug) return <main className="debug-workbench"><p>同屏调试仅在 npm run debug 启动的服务中开放。</p><a href={`/host?room=${session.code}`}>返回说书人</a></main>;
  const waiting = ["LOBBY", "SETUP"].includes(room.phase);
  async function fill(start: boolean) {
    setBusy(true);
    try { await send({ type: "debug_fill", start }); } finally { setBusy(false); }
  }
  return <main className="debug-workbench">
    <header className="debug-toolbar">
      <b>同屏调试</b><span>{room.code} · 第 {room.gameNo} 局 · {PHASE_NAMES[room.phase]}</span>
      {waiting && <>
        <button disabled={busy || !connected} onClick={() => void fill(false)}>补齐空位</button>
        <button className="primary" disabled={busy || !connected} onClick={() => void fill(true)}>补齐并开局</button>
      </>}
      <a href={`/host?room=${room.code}`}>返回普通说书人界面</a>
    </header>
    {error && <p role="alert" className="error">{error}</p>}
    <PlayerFrames key={`${room.code}:${room.gameNo}`} room={room} />
  </main>;
}
