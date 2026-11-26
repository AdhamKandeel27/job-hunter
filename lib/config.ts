// Next.js loads .env itself; the agent script needs it loaded by hand.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: rely on the real environment and the defaults below.
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${raw}"`);
  return n;
}

export const config = {
  databaseUrl:
    process.env.DATABASE_URL || "postgres://jobhunter:jobhunter@localhost:5433/jobhunter",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  modelScreen: process.env.OPENAI_MODEL_SCREEN || "gpt-6-luna",
  modelJudge: process.env.OPENAI_MODEL_JUDGE || "gpt-6-luna",
  // Model calls per minute. Paces a run; it does not cap what a run costs.
  openaiRpm: num("OPENAI_RPM", 20),
  scoreCutoff: num("SCORE_CUTOFF", 70),
  maxPostingsPerRun: num("MAX_POSTINGS_PER_RUN", 40),
  resendApiKey: process.env.RESEND_API_KEY || "",
  digestTo: process.env.DIGEST_TO || "",
  digestFrom: process.env.DIGEST_FROM || "Job agent <onboarding@resend.dev>",
  appUrl: (process.env.APP_URL || "http://localhost:2000").replace(/\/$/, ""),
};
