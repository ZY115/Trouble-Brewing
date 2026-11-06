import { useState } from "react";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
import Picker, { seatOptions } from "../ui/Picker";
import { Checks, TaskActions, TaskCard } from "./TaskCard";
import { slayerOutcome, slayerStatus } from "./rules";

export function SlayerForm({
  room,
  send,
  shooter: fixed,
  onDone,
}: {
  room: RoomView;
  send: Send;
  shooter?: string;
  onDone: () => void;
}) {
  const [shooter, setShooter] = useState(fixed ?? "");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const outcome = shooter && target ? slayerOutcome(room, shooter, target) : null;
  const tn = room.seats.find((s) => s.id === target)?.number;
  async function shoot(kill: boolean) {
    setBusy(true);
    const ok = await send({ type: "slayer_shot", shooter, target, kill });
    setBusy(false);
    if (ok) onDone();
  }
  return (
    <>
      {!fixed && <Checks items={slayerStatus(room).map((text) => ({ ok: text.startsWith("真正的猎手"), text }))} />}
      {!fixed && (
        <Picker
          label="谁宣布开枪"
          value={shooter}
          options={seatOptions(room.seats.filter((s) => s.alive))}
          onChange={(v) => {
            setShooter(v);
            if (v === target) setTarget("");
          }}
          clearable={false}
        />
      )}
      {shooter && (
        <Picker
          label="射向几号"
          value={target}
          options={seatOptions(room.seats.filter((s) => s.alive && s.id !== shooter))}
          onChange={setTarget}
          clearable={false}
        />
      )}
      {outcome && <Checks items={[{ ok: outcome.kill, text: outcome.text }]} />}
      <TaskActions>
        {outcome?.kill ? (
          <>
            <button className="primary" disabled={busy} onClick={() => void shoot(true)}>
              {tn} 号死亡
            </button>
            <button disabled={busy} onClick={() => void shoot(false)}>
              裁定无事发生
            </button>
          </>
        ) : outcome?.decide ? (
          <>
            <button className="primary" disabled={busy} onClick={() => void shoot(false)}>
              无事发生
            </button>
            <button disabled={busy} onClick={() => void shoot(true)}>
              {tn} 号死亡（隐士当作恶魔）
            </button>
          </>
        ) : (
          <button className="primary" disabled={busy || !outcome} onClick={() => void shoot(false)}>
            公布：没有发生任何事
          </button>
        )}
        <button disabled={busy} onClick={onDone}>
          取消
        </button>
      </TaskActions>
    </>
  );
}

export function SlayerTask({ room, send, onDone }: { room: RoomView; send: Send; onDone: () => void }) {
  return (
    <TaskCard eyebrow={`第 ${room.day} 天 · 猎手开枪`} title="谁向谁开枪？">
      <SlayerForm room={room} send={send} onDone={onDone} />
    </TaskCard>
  );
}
