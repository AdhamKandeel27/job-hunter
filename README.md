# Job agent

Finds remote and Gulf jobs open to someone in Egypt and prepares application
materials for you to review. Design: `Remote job agent system design.md`.

## Set up once

1. Copy `.env.example` to `.env` and add `OPENAI_API_KEY`
   (and optionally `OPENAI_MODEL_SCREEN`, `OPENAI_MODEL_JUDGE`, `OPENAI_RPM`). For email, also add
   `RESEND_API_KEY` and `DIGEST_TO`; without them the digest is written to `out/`.
2. Put your résumé at `profile/resume.md` (Markdown or plain text).
3. Copy `profile/answers.example.json` to `profile/answers.json` and fill in
   your address, expected salary and notice period.
4. Start Docker Desktop, then:

   ```
   npm install
   npm run db:up
   npm run db:migrate
   ```

## Use

| Command | What it does |
| --- | --- |
| `npm run agent:dry` | Scans the sources and lists what it found. No model calls, no database. |
| `npm run agent` | One full run: scan, judge, save strong fits, send the digest. |
| `npm run dev` | Review page at http://localhost:2000 |
| `.\scripts\register-daily-task.ps1 -At 09:00` | Schedules the daily run on this machine. |

## Settings

- `.env`: models, calls per minute, score cut-off, postings judged per run
  (`MAX_POSTINGS_PER_RUN`, the default for scheduled and terminal runs).
- The number next to **Find new jobs** on the review page sets how many postings
  that run checks. From a terminal: `npm run agent -- --max=20`.
- `profile/search.json`: what gets scanned and what is skipped for free.
  - `careers`: company career pages (Greenhouse, Lever, Ashby). To add one,
    open the company's careers page and copy the name from its address, e.g.
    `job-boards.greenhouse.io/gitlab` gives `{ "ats": "greenhouse", "board": "gitlab" }`.
  - `titleFilter`: words a job title must contain (`mustInclude`) or must not
    contain (`exclude`). Checked before any model call, so it costs nothing.
  - Himalayas and Jobgether searches, Wuzzuf pages.
- `profile/prices.json`: paid API prices per model (Gemini, OpenAI, Anthropic)
  and the model pairs compared in the **Model cost** panel. Update it when
  prices or models change.

## Layout

- `agent/`: the scheduled script. `run.ts` is the pipeline, `steps.ts` holds the
  five model steps, `sources/` has one file per job board.
- `app/`: the Next.js review page. It only reads and updates Postgres.
- `lib/`: config, database pool and types shared by both.
- `db/schema.sql`: the tables.
