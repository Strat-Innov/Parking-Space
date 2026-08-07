import { NextResponse } from "next/server";
import { AuthError } from "./auth";
import { WorkflowError } from "./workflows";

export function handleApiError(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof WorkflowError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
