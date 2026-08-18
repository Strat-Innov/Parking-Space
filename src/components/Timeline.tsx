type Event = {
  id: string;
  workflow: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  createdAt: Date;
  actor: { name: string; role: string } | null;
};

// Substitutes for Microsoft Lists' native per-item version history (Section
// 8) — this is an explicit, append-only log of every workflow transition,
// since outside SharePoint that history isn't automatic.
export default function Timeline({ events }: { events: Event[] }) {
  return (
    <div className="card">
      <h2 className="mb-4 text-lg font-semibold tracking-tight">History</h2>
      <ol className="space-y-3 border-l border-slate-200 pl-4 dark:border-slate-800">
        {events.map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-slate-400 dark:bg-slate-600" />
            <div className="text-sm">
              {e.fromStatus && e.toStatus ? (
                <span>
                  <span className="text-slate-500 dark:text-slate-400">{e.fromStatus}</span> {"->"}{" "}
                  <span className="font-medium">{e.toStatus}</span>
                </span>
              ) : (
                e.note && <span className="font-medium">{e.note}</span>
              )}
            </div>
            <div className="text-xs text-slate-400 dark:text-slate-500">
              {new Date(e.createdAt).toLocaleString()}
              {e.actor && ` · ${e.actor.name} (${e.actor.role})`}
              {e.fromStatus && e.toStatus && e.note ? ` · ${e.note}` : ""}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
