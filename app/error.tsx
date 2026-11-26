"use client";

// Shown if a page fails to load for any reason.
export default function PageError({ reset }: { error: Error; reset: () => void }) {
  return (
    <>
      <h1>Job agent</h1>
      <div className="notice error">
        <b>This page could not be loaded.</b>
        <span>
          The usual cause is the database not running: start Docker Desktop and run “npm run db:up” in the project folder.
        </span>
      </div>
      <div className="actions">
        <button onClick={reset}>Try again</button>
      </div>
    </>
  );
}
