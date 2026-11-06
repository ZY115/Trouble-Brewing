import { useState } from "react";
import type { RoomView } from "../../shared/types";
import { ROLES, roleName } from "../../shared/roles";
import { Checks } from "./TaskCard";
import type { Send } from "../useRoom";
import Picker, { roleOptions } from "../ui/Picker";

export function bluffCandidates(room: RoomView) {
  const st = room.storyteller!;
  const taken = new Set(
    Object.values(st.assignments).flatMap((a) => [a.actualRoleId, a.actualRoleId === "drunk" ? a.perceivedRoleId : ""]),
  );
  return ROLES.filter((r) => ["townsfolk", "outsider"].includes(r.team) && r.id !== "drunk" && !taken.has(r.id));
}

export function BluffPickers({ room, send }: { room: RoomView; send: Send }) {
  const st = room.storyteller!;
  const [busy, setBusy] = useState(false);
  const bluffs = st.setup.bluffs;
  const allowed = bluffCandidates(room);
  const candidates = roleOptions(allowed);
  const clash = bluffs.filter((id) => !allowed.some((r) => r.id === id));
  return (
    <>
    {clash.length > 0 && (
      <Checks items={clash.map((id) => ({ ok: false, text: `${roleName(id)}现在在场，不能当假身份，请换掉` }))} />
    )}
    <div className="bluff-selects">
      {[0, 1, 2].map((i) => (
        <Picker
          key={i}
          label={`假身份 ${i + 1}`}
          value={bluffs[i] ?? ""}
          options={candidates.map((o) => ({ ...o, disabled: bluffs.includes(o.value) && bluffs[i] !== o.value }))}
          disabled={busy}
          onChange={async (v) => {
            const next = [...bluffs];
            next[i] = v;
            setBusy(true);
            await send({ type: "set_bluffs", bluffs: next });
            setBusy(false);
          }}
          clearable={false}
        />
      ))}
    </div>
    </>
  );
}

export function bluffSummary(room: RoomView, roleName: (id: string) => string) {
  const st = room.storyteller!;
  return st.setup.bluffs
    .map((id) => {
      const holder = Object.entries(st.bluffClaims).find(([, r]) => r === id)?.[0];
      const n = room.seats.find((s) => s.id === holder)?.number;
      return `${roleName(id)}${n ? `（${n} 号认领）` : ""}`;
    })
    .join("、");
}
