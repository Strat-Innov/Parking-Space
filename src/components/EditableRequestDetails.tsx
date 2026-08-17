"use client";

import { useState } from "react";
import RequestDetailsForm, { type RequestDetailsFormInitial } from "@/components/RequestDetailsForm";

// Prepared By's view of Request Details while Status = "In Preparation":
// read-only by default (same as every other role sees), with an Edit button
// that swaps in the actual form. Keeps the default view visually identical
// to everyone else's instead of always showing an open edit form.
export default function EditableRequestDetails({
  requestId,
  initial,
  readOnlyView,
}: {
  requestId: string;
  initial: RequestDetailsFormInitial;
  readOnlyView: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Request Details</h2>
          <button type="button" onClick={() => setEditing(true)} className="btn-secondary py-1.5">
            Edit
          </button>
        </div>
        {readOnlyView}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Request Details</h2>
        <button type="button" onClick={() => setEditing(false)} className="text-sm text-slate-500 underline hover:text-slate-900">
          Cancel
        </button>
      </div>
      <RequestDetailsForm mode="edit" requestId={requestId} initial={initial} />
    </div>
  );
}
