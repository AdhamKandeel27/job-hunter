-- Every posting the agent has finished judging, kept or discarded.
-- Only source and link are stored, so a discarded posting leaves no content behind.
create table if not exists fingerprints (
  source  text not null,
  url     text not null,
  seen_at timestamptz not null default now(),
  primary key (source, url)
);

-- Only strong fits are stored. Earlier lifecycle steps (saved, scored) happen
-- in memory during a run; anything that fails them is discarded.
create table if not exists postings (
  id          serial primary key,
  source      text not null,
  url         text not null unique,
  title       text not null,
  company     text not null,
  location    text,
  pay         text,
  currency    text not null default 'not stated',
  seniority   text not null,
  date_seen   timestamptz not null default now(),

  state       text not null default 'strong_fit'
              check (state in ('strong_fit', 'emailed', 'applied', 'skipped')),

  eligibility_verdict    text not null check (eligibility_verdict in ('eligible', 'unclear')),
  eligibility_confidence text not null check (eligibility_confidence in ('high', 'medium', 'low')),
  eligibility_reason     text not null,
  eligibility_evidence   jsonb not null default '[]',

  vetting_reasons jsonb not null default '[]',

  score        int not null,
  score_reason text not null,

  emailed_at  timestamptz,
  applied_at  timestamptz,
  outcome     text check (outcome in ('interview', 'rejected', 'no_reply')),
  outcome_at  timestamptz
);

create table if not exists packages (
  posting_id     int primary key references postings (id) on delete cascade,
  resume_md      text not null,
  cover_note     text not null,
  recruiter_note text not null,
  form_answers   jsonb not null default '[]',
  unanswered     jsonb not null default '[]',
  created_at     timestamptz not null default now()
);

-- One row: the résumé and stored answers, synced from profile/ on each run.
create table if not exists profile (
  id         int primary key default 1 check (id = 1),
  resume     text not null,
  answers    jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- One row per agent run, so the review page can show what happened.
create table if not exists runs (
  id          serial primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'finished', 'failed')),
  tally       jsonb not null default '{}',
  notices     jsonb not null default '[]'
);

-- A hash of company + title, so the same job found on a second board is not
-- judged again. Still no posting content is kept for discarded jobs.
alter table fingerprints add column if not exists job_key text;
create index if not exists fingerprints_job_key on fingerprints (job_key);

-- Set when a later run finds the posting has been taken down.
alter table postings add column if not exists closed_at timestamptz;

-- Whether the form answers follow the job's real application form or are general.
alter table packages add column if not exists form_source text not null default 'general';
alter table packages add column if not exists form_note text;

-- The "Ask about this job" section: the overview you pasted and the questions with drafted answers.
alter table packages add column if not exists job_overview text not null default '';
alter table packages add column if not exists qa jsonb not null default '[]';

-- Tokens used per model in the run: { "<model>": { calls, input, output } }.
alter table runs add column if not exists usage jsonb not null default '{}';
