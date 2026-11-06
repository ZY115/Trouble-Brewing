import type { NotebookEntry, PublicSeat, RoomView } from "../../shared/types";
import Grimoire, { type GrimoireSeat } from "../ui/Grimoire";
import {
  claimSummary,
  latestNotes,
  roleLabel,
  seatNotes,
  type Verdict,
} from "./notes";

export function NoteCircle({
  room,
  verdicts,
  picked,
  picking,
  noSelf = false,
  onSeat,
}: {
  room: RoomView;
  verdicts: Record<string, Verdict>;
  picked: string[];
  picking: boolean;
  noSelf?: boolean;
  onSeat: (seatId: string) => void;
}) {
  const me = room.viewer.seatId;
  const notes = seatNotes(room);
  const vote =
    room.liveVote && ["OPEN", "COUNTING"].includes(room.liveVote.status)
      ? room.liveVote
      : undefined;
  const seats: GrimoireSeat[] = room.seats.map((s) => {
    const n = notes[s.id];
    const role = roleLabel(n?.claim?.rev);
    const v = s.id === me ? undefined : verdicts[s.id];
    const written = !!(
      n?.text?.rev.body ||
      n?.claim?.rev.body ||
      (n?.claim && claimSummary(n.claim.rev, room.seats))
    );
    return {
      key: s.id,
      number: s.number,
      glyph: String(s.number),
      tone: v === "good" ? "town" : v === "evil" ? "demon" : "neutral",
      dead: !s.alive,
      selected: picking && picked.includes(s.id),
      disabled: picking && noSelf && s.id === me,
      rings: [
        ...(s.id === me ? (["self"] as const) : []),
        ...(vote?.nominee === s.id ? (["target"] as const) : []),
      ],
      label: s.id === me ? "我" : role || undefined,
      marks: s.alive
        ? undefined
        : [{ text: s.deadVoteAvailable ? "亡·票" : "亡", kind: "dead" }],
      badge: written ? "·" : undefined,
      ariaLabel: [
        `${s.number} 号${s.id === me ? "（你）" : ""}`,
        s.alive
          ? "存活"
          : s.deadVoteAvailable
            ? "死亡，死者票未用"
            : "死亡，死者票已用",
        role && `记为${role}`,
        v && (v === "good" ? "偏善良" : "偏邪恶"),
        picking
          ? picked.includes(s.id)
            ? "已选，点击取消"
            : "点击选择"
          : "点击打开笔记",
      ]
        .filter(Boolean)
        .join("，"),
    };
  });
  const living = room.seats.filter((s) => s.alive).length;
  const number = (id: string) =>
    room.seats.find((s) => s.id === id)?.number ?? 0;
  return (
    <div className={`pl-circle ${picking ? "picking" : ""}`}>
      <Grimoire
        label={picking ? "选择目标" : "座位与笔记"}
        capacity={room.capacity}
        seats={seats}
        onSeat={(s) => onSeat(s.key)}
        lines={
          vote
            ? [{ from: number(vote.nominator), to: number(vote.nominee) }]
            : []
        }
        center={
          <>
            <span className="pl-count">{living}</span>
            <span className="pl-small">
              人存活 · 处决至少 {Math.ceil(living / 2)} 票
            </span>
          </>
        }
      />
    </div>
  );
}

function Rows({
  seats,
  entries,
  verdicts,
  onOpen,
  me,
}: {
  seats: PublicSeat[];
  entries: NotebookEntry[];
  verdicts?: Record<string, Verdict>;
  onOpen?: (seatId: string) => void;
  me?: string;
}) {
  const notes = latestNotes(entries);
  return (
    <ul className="notes-table">
      {[...seats]
        .sort((a, b) => a.number - b.number)
        .map((s) => {
          const n = notes[s.id];
          const v = verdicts?.[s.id];
          const summary = n?.claim ? claimSummary(n.claim.rev, seats) : "";
          const text = (n?.claim ?? n?.text)?.rev.body ?? "";
          const empty = !n && !v;
          const inner = (
            <>
              <span className={`notes-num ${v ?? ""} ${s.alive ? "" : "dead"}`}>
                {s.number}
              </span>
              <span className="notes-body">
                <span className="notes-line">
                  <b>
                    {s.id === me
                      ? "我"
                      : roleLabel(n?.claim?.rev) ||
                        (empty ? "还没记" : "角色未知")}
                  </b>
                  {summary && <span>{summary}</span>}
                </span>
                {text && <span className="notes-text">{text}</span>}
              </span>
            </>
          );
          return (
            <li key={s.id} className={empty ? "empty" : ""}>
              {onOpen ? (
                <button onClick={() => onOpen(s.id)}>{inner}</button>
              ) : (
                <div>{inner}</div>
              )}
            </li>
          );
        })}
    </ul>
  );
}

export function NotesTable({
  room,
  verdicts,
  onOpen,
}: {
  room: RoomView;
  verdicts: Record<string, Verdict>;
  onOpen: (seatId: string) => void;
}) {
  return (
    <>
      <section className="pl-card">
        <span className="pl-small">
          点一行修改。
        </span>
        <Rows
          seats={room.seats}
          entries={room.notebook}
          verdicts={verdicts}
          onOpen={onOpen}
          me={room.viewer.seatId}
        />
      </section>
    </>
  );
}
