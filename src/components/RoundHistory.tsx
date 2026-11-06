import { useRef, useState } from "react";
import type { RoomView, Session } from "../../shared/types";
import type { GameRecap } from "../../shared/endgame";
import Picker from "../ui/Picker";
import { RecapFacts, RecapTimeline, ResultBanner } from "./Recap";

type History = { gameNo: number; recap?: GameRecap; publicRecords: RoomView["publicRecords"]; seats: RoomView["seats"] };

export default function RoundHistory({ room, session }: { room: RoomView; session: Session }) {
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const wanted = useRef("");
  const games = room.storyteller?.archiveGames ?? [];
  async function load(gameNo: string) {
    wanted.current = gameNo;
    setSelected(gameNo);
    setHistory(null);
    setError("");
    if (!gameNo) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/rooms/${room.code}/history/${gameNo}`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      const value = await res.json();
      if (!res.ok) throw Error(value.error);
      if (wanted.current === gameNo) setHistory(value);
    } catch (e) {
      if (wanted.current === gameNo) setError((e as Error).message);
    } finally {
      if (wanted.current === gameNo) setBusy(false);
    }
  }
  if (!games.length) return null;
  return (
    <section className="panel round-history" aria-label="历史对局">
      <h3>历史对局</h3>
      <Picker
        label="查看哪一局"
        value={selected}
        options={[...games].sort((a, b) => b - a).map((n) => ({ value: String(n), label: `第 ${n} 局` }))}
        onChange={(v) => void load(v)}
        clearable={false}
      />
      {busy && <p className="muted">正在读取…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {history && (
        <>
          {history.recap ? (
            <>
              <ResultBanner result={history.recap.result} />
              <RecapFacts recap={history.recap} />
              <RecapTimeline recap={history.recap} room={{ ...room, seats: history.seats }} />
            </>
          ) : (
            <p className="muted">这一局提前结束，没有复盘。</p>
          )}
          {!!history.publicRecords.length && (
            <details>
              <summary>公开记录</summary>
              <ul className="round-records">
                {history.publicRecords.map((r) => (
                  <li key={r.id}>
                    <span className="muted">
                      第 {r.day} {r.period === "NIGHT" ? "夜" : "天"}
                    </span>
                    {r.text}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
