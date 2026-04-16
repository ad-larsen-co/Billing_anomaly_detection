import type { FeedbackListItem } from "../api";

function actionTone(
  action: string
): "emerald" | "slate" {
  return action === "approve" ? "emerald" : "slate";
}

export default function FeedbackFeed({
  items,
  loading,
}: {
  items: FeedbackListItem[];
  loading?: boolean;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Feedback activity</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Approvals and dismissals stored for review and model learning signals.
          </p>
        </div>
        {loading && (
          <span className="text-xs text-slate-400">Updating…</span>
        )}
      </div>
      {items.length === 0 && !loading && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          No feedback yet. Approve or dismiss an anomaly to record it here.
        </div>
      )}
      {items.length > 0 && (
        <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-100">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Order</th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((f) => {
                const tone = actionTone(f.action);
                return (
                  <tr key={f.id} className="bg-white hover:bg-slate-50/80">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {new Date(f.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 font-medium ring-1 ${
                          tone === "emerald"
                            ? "bg-emerald-50 text-emerald-800 ring-emerald-100"
                            : "bg-slate-100 text-slate-700 ring-slate-200"
                        }`}
                      >
                        {f.action}
                      </span>
                    </td>
                    <td className="max-w-[8rem] truncate px-3 py-2 font-mono text-slate-700">
                      {f.order_id ?? "—"}
                    </td>
                    <td className="max-w-xs truncate px-3 py-2 text-slate-600">
                      {f.notes?.trim() || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
