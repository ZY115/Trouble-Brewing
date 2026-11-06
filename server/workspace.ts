import { completedAction } from "../shared/assistance";
import { phaseReview } from "../shared/phase-review";
import type { NightAction, RoomView } from "../shared/types";
import type {
  NightWorkItem,
  NoteSummary,
  PlayerWorkspace,
  StorytellerWorkbench,
  WorkStatus,
} from "../shared/workspace";

export function playerWorkspace(view: RoomView): PlayerWorkspace {
  const notes: NoteSummary[] = view.notebook
    .flatMap((entry) => {
      const latest = entry.revisions.at(-1);
      return latest
        ? [
            {
              entryId: entry.id,
              kind: entry.kind,
              target: entry.target,
              latest,
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        (b.latest.sequence ?? 0) - (a.latest.sequence ?? 0) ||
        b.latest.savedAt.localeCompare(a.latest.savedAt) ||
        b.entryId.localeCompare(a.entryId),
    );
  const active = notes.filter((note) => !note.latest.archived);
  return {
    results: view.actions
      .filter(
        (action) =>
          action.status === "DELIVERED" && action.response !== undefined,
      )
      .map((action) => ({
        actionId: action.id,
        night: action.night,
        prompt: action.prompt,
        targets: action.targets,
        response: action.response!,
        version: action.responseVersion ?? 1,
        sentAt: action.responseHistory?.at(-1)?.sentAt,
        history: action.responseHistory ?? [],
      })),
    notebook: {
      defaultDate: {
        day: Math.max(1, view.day),
        period: ["DAY", "ENDED"].includes(view.phase) ? "DAY" : "NIGHT",
      },
      seats: view.seats.map((seat) => {
        const ownNotes = active.filter((note) => note.target === seat.id);
        return {
          seat,
          notes: ownNotes,
          claimed: ownNotes.find(
            (note) => note.kind === "claim" && note.latest.source === "claimed",
          ),
          suspected: ownNotes.find(
            (note) =>
              note.kind === "claim" && note.latest.source === "suspected",
          ),
        };
      }),
      general: active.filter((note) => !note.target),
      archived: notes.filter((note) => note.latest.archived),
    },
  };
}

function actionStatus(action: NightAction): WorkStatus {
  return completedAction(action)
    ? "completed"
    : action.status === "REQUESTED"
      ? "waiting"
      : "ruling";
}

export function storytellerWorkbench(view: RoomView): StorytellerWorkbench {
  const st = view.storyteller!;
  const night = ["FIRST_NIGHT", "OTHER_NIGHT"].includes(view.phase);
  const actions = view.actions.filter((action) => action.night === view.day);
  const actionById = new Map(actions.map((action) => [action.id, action]));
  const represented = new Set<string>();
  const nightQueue: NightWorkItem[] = [];
  if (night) {
    for (const item of st.nightPlan.filter((item) => item.night === view.day)) {
      const action = item.actionId ? actionById.get(item.actionId) : undefined;
      if (action && represented.has(action.id)) continue;
      if (action) represented.add(action.id);
      nightQueue.push({
        planItemId: item.id,
        actionId: action?.id,
        seatId: item.seatId || undefined,
        prompt: item.prompt,
        status: action
          ? actionStatus(action)
          : item.retiredReason || ["skipped", "offline"].includes(item.status)
            ? "completed"
            : !item.seatId
              ? "manual"
              : "unstarted",
      });
    }
    for (const action of actions.filter(
      (action) => !represented.has(action.id),
    ))
      nightQueue.push({
        actionId: action.id,
        seatId: action.seatId,
        prompt: action.prompt,
        status: actionStatus(action),
      });
  }
  const counts: StorytellerWorkbench["counts"] = {
    unstarted: 0,
    manual: 0,
    waiting: 0,
    ruling: 0,
    completed: 0,
  };
  nightQueue.forEach((item) => counts[item.status]++);
  return {
    nightQueue,
    counts,
    nextRulingActionId: nightQueue.find((item) => item.status === "ruling")
      ?.actionId,
    seats: view.seats.map((seat) => {
      const ownActions = actions.filter((action) => action.seatId === seat.id);
      return {
        seatId: seat.id,
        number: seat.number,
        actionIds: ownActions.map((action) => action.id),
        messageIds: view.messages
          .filter(
            (message) =>
              (message.from === seat.id && message.to === "storyteller") ||
              (message.from === "storyteller" && message.to === seat.id),
          )
          .map((message) => message.id),
        needsRuling: night
          ? ownActions.filter((action) => actionStatus(action) === "ruling")
              .length
          : 0,
        waiting: night
          ? ownActions.filter((action) => actionStatus(action) === "waiting")
              .length
          : 0,
      };
    }),
    attention: {
      noticeIds: st.notices.map((notice) => notice.id),
      evilInfoPending:
        view.phase === "FIRST_NIGHT" && !st.evilInfoSent && !st.evilReleased,
      staleConditions: st.staleConditions.length,
      unpublishedDeaths: view.seats
        .filter(
          (seat) => st.publishedAlive[seat.id] !== seat.alive && !seat.alive,
        )
        .map((seat) => seat.id),
      unpublishedRevivals: view.seats
        .filter(
          (seat) => st.publishedAlive[seat.id] !== seat.alive && seat.alive,
        )
        .map((seat) => seat.id),
      activeVoteId:
        view.liveVote && ["OPEN", "COUNTING"].includes(view.liveVote.status)
          ? view.liveVote.id
          : undefined,
    },
    phaseTransition:
      night || view.phase === "DAY"
        ? {
            expectedPhaseVersion: st.phaseVersion,
            publish: phaseReview(view, true),
            hold: phaseReview(view, false),
          }
        : undefined,
  };
}
