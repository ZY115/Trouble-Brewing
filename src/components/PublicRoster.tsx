import type { RoomView } from "../../shared/types";
import { ballotStatus, latestVoteRecord } from "../../shared/vote-display";

export default function PublicRoster({ room }: { room: RoomView }) {
  const active =
    room.liveVote && ["OPEN", "COUNTING"].includes(room.liveVote.status);
  const latest = latestVoteRecord(room.publicRecords);
  return (
    <section className="panel table-scroll">
      <table className="state-table public-roster">
        <caption>
          公开座位状态
          {active
            ? ` · 第 ${room.liveVote!.day} 天正在投票`
            : latest
              ? ` · 第 ${latest.day} 天最近已记录投票`
              : ""}
        </caption>
        <thead>
          <tr>
            <th>号码</th>
            <th>当前生死</th>
            <th>剩余死者票</th>
            <th>本次投票</th>
          </tr>
        </thead>
        <tbody>
          {room.seats.map((s) => (
            <tr key={s.id}>
              <th scope="row">{s.number} 号</th>
              <td>{s.alive ? "存活" : "死亡"}</td>
              <td>{s.alive ? "—" : s.deadVoteAvailable ? "1 票" : "已用完"}</td>
              <td>{ballotStatus(room.liveVote, room.publicRecords, s.id)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
