import { runStatus, startRun } from "../../../lib/runner";

export const dynamic = "force-dynamic";

const MAX_PER_RUN = 500;

export function GET() {
  return Response.json(runStatus());
}

/** Body (optional): { max: number }, how many new postings this run checks. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const n = Number(body?.max);
  startRun(Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_PER_RUN) : undefined);
  return Response.json(runStatus());
}
