import { costOf, latestPrice, priced, priceOn, usd, type PriceTable, type Setup } from "../lib/prices";
import type { RunRow, Usage } from "../lib/types";
import { Collapsible } from "./collapsible";

// Tally entries that cost no model calls.
const FREE = new Set(["not checked", "duplicate", "off-title"]);

/** Postings a run actually judged with the model. */
export const checkedIn = (run: RunRow) =>
  Object.entries(run.tally).reduce((sum, [k, n]) => (FREE.has(k) ? sum : sum + n), 0);

const hasUsage = (run: RunRow) => Object.keys(run.usage ?? {}).length > 0;

/** Average paid-tier cost of checking one posting across recorded runs, at today's prices. */
export function costPerPosting(runs: RunRow[], prices: PriceTable): number | null {
  let cost = 0;
  let checked = 0;
  for (const r of runs.filter(hasUsage)) {
    cost += costOf(r.usage!, prices, new Date()).usd;
    checked += checkedIn(r);
  }
  return checked > 0 && cost > 0 ? cost / checked : null;
}

interface Tokens {
  input: number;
  output: number;
}

/** Split a run's tokens into the cheap screening step and the judging steps. */
function byRole(usage: Usage, screenModel: string): { screen: Tokens; judge: Tokens } {
  const out = { screen: { input: 0, output: 0 }, judge: { input: 0, output: 0 } };
  for (const [model, u] of Object.entries(usage)) {
    if (u.screenInput != null && u.screenOutput != null) {
      // Recorded per step, so the split holds even when one model does both.
      out.screen.input += u.screenInput;
      out.screen.output += u.screenOutput;
      out.judge.input += u.input - u.screenInput;
      out.judge.output += u.output - u.screenOutput;
      continue;
    }
    // Older runs: tell the steps apart by model name.
    const role = model === screenModel ? out.screen : out.judge;
    role.input += u.input;
    role.output += u.output;
  }
  return out;
}

const count = (n: number) => n.toLocaleString("en-US");

interface Props {
  runs: RunRow[];
  prices: PriceTable;
  setups: Setup[];
  /** Postings per run used for the monthly figure. */
  perRun: number;
  /** The model the first pass runs on; every other model counts as judging. */
  screenModel: string;
}

/** What the model calls would cost on a paid key: last run, per posting, per month, per provider. */
export function CostPanel({ runs, prices, setups, perRun, screenModel }: Props) {
  const recorded = runs.filter((r) => r.status !== "running" && hasUsage(r));
  const last = recorded[0];

  if (!last) {
    return (
      <section className="cost">
        <Collapsible title="Model cost" hint="no usage recorded yet" storageKey="job-agent-cost-panel">
          <div className="small muted">
            No usage recorded yet. Tokens are counted from the next run on, and the paid-tier cost will show here.
          </div>
        </Collapsible>
      </section>
    );
  }

  const usage = last.usage!;
  const at = new Date(last.started_at);
  const { usd: lastCost, unpriced } = costOf(usage, prices, at);
  const checked = checkedIn(last);
  const fits = last.tally["strong fit"] ?? 0;
  const calls = Object.values(usage).reduce((s, u) => s + u.calls, 0);

  const average = costPerPosting(recorded, prices);
  const allTime = recorded.reduce((s, r) => s + costOf(r.usage!, prices, new Date(r.started_at)).usd, 0);
  const allChecked = recorded.reduce((s, r) => s + checkedIn(r), 0);

  // A price change that is listed but has not started yet (for example, 1 Jan 2027).
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = Object.keys(usage)
    .map((m) => ({ m, now: priceOn(prices, m, new Date()), next: latestPrice(prices, m) }))
    .filter((x) => x.next?.from && x.now && x.next !== x.now && x.next.from > today);
  const lastCostLater = Object.entries(usage).reduce((s, [m, u]) => {
    const p = latestPrice(prices, m);
    return p ? s + priced(u, p) : s;
  }, 0);

  // The same tokens priced on other providers' models.
  const lastRoles = byRole(usage, screenModel);
  // The model that screened in the last run, which may differ from today's setting.
  const models = Object.keys(usage);
  const usedScreen =
    models.find((m) => (usage[m].screenInput ?? 0) > 0) ??
    (models.includes(screenModel) ? screenModel : models.find((m) => /lite/.test(m)) ?? models[0]);
  const allRoles = recorded.reduce(
    (acc, r) => {
      const t = byRole(r.usage!, screenModel);
      for (const role of ["screen", "judge"] as const) {
        acc[role].input += t[role].input;
        acc[role].output += t[role].output;
      }
      return acc;
    },
    { screen: { input: 0, output: 0 }, judge: { input: 0, output: 0 } },
  );
  const on = (roles: { screen: Tokens; judge: Tokens }, s: Setup): number | null => {
    const ps = priceOn(prices, s.screen, new Date());
    const pj = priceOn(prices, s.judge, new Date());
    return ps && pj ? priced(roles.screen, ps) + priced(roles.judge, pj) : null;
  };
  const monthly = (cost: number | null) => (cost != null && allChecked > 0 ? (cost / allChecked) * perRun * 30 : null);
  const show = (n: number | null) => (n == null ? "–" : usd(n));

  return (
    <section className="cost">
      <Collapsible title="Model cost" hint={`last run ${usd(lastCost)}`} storageKey="job-agent-cost-panel">
      <div className="small muted">
        Model calls are billed to your OpenAI account. These figures price the tokens each run recorded at the rates
        in profile/prices.json; your OpenAI usage page has the exact charges. Runs made on Gemini&rsquo;s free tier
        cost nothing and are shown at paid rates.
      </div>

      <div className="stats">
        <div><b>{usd(lastCost)}</b><span className="small muted">last run ({checked} checked)</span></div>
        <div><b>{checked ? usd(lastCost / checked) : "–"}</b><span className="small muted">per posting checked</span></div>
        <div><b>{fits ? usd(lastCost / fits) : "–"}</b><span className="small muted">per strong fit</span></div>
        <div>
          <b>{average != null ? usd(average * perRun * 30) : "–"}</b>
          <span className="small muted">per month at {perRun} a day</span>
        </div>
      </div>

      {setups.length > 0 && (
        <>
          <h3>The same work on other models</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Provider</th><th>Screening model</th><th>Judging model</th><th>Last run</th><th>Per month at {perRun} a day</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Used in the last run</td>
                  <td>{usedScreen}</td>
                  <td>{Object.keys(usage).filter((m) => m !== usedScreen).join(", ") || usedScreen}</td>
                  <td>{usd(lastCost)}</td>
                  <td>{average != null ? usd(average * perRun * 30) : "–"}</td>
                </tr>
                {setups.map((s, i) => (
                  <tr key={i}>
                    <td>{s.provider}</td>
                    <td>{s.screen}</td>
                    <td>{s.judge}</td>
                    <td>{show(on(lastRoles, s))}</td>
                    <td>{show(monthly(on(allRoles, s)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="small muted">
            Estimates: they price the tokens the runs used at each provider&rsquo;s API rates. Another model counts
            tokens differently and may think more or less, so treat these as a rough guide, not a quote.
            A ChatGPT or Claude subscription does not include API usage; the API is billed separately, per token.
          </div>
        </>
      )}

      <details>
        <summary>
          Tokens by model in the last run ({calls} model {calls === 1 ? "call" : "calls"})
        </summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Model</th><th>Calls</th><th>Tokens in</th><th>Tokens out</th><th>Price per 1M (in / out)</th><th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(usage).map(([model, u]) => {
                const p = priceOn(prices, model, at);
                return (
                  <tr key={model}>
                    <td>{model}</td>
                    <td>{count(u.calls)}</td>
                    <td>{count(u.input)}</td>
                    <td>{count(u.output)}</td>
                    <td>{p ? `$${p.input} / $${p.output}` : "not in prices.json"}</td>
                    <td>{p ? usd(priced(u, p)) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="muted">
          All {recorded.length} recorded {recorded.length === 1 ? "run" : "runs"} together: {usd(allTime)}.
          Monthly figures use the average cost per posting across them. Tokens out include thinking tokens.
          Prices and the compared models are in profile/prices.json.
        </div>
      </details>

      {upcoming.length > 0 && (
        <div className="notice info">
          <b>
            {upcoming.map((x) => x.m).join(" and ")} {upcoming.length === 1 ? "gets" : "get"} dearer on {upcoming[0].next!.from}.
          </b>
          <span>At the new prices the last run would cost {usd(lastCostLater)} instead of {usd(lastCost)}.</span>
        </div>
      )}
      {unpriced.length > 0 && (
        <div className="notice warning">
          <b>No price listed for {unpriced.join(", ")}.</b>
          <span>Its tokens are counted as $0. Add the model to profile/prices.json to include it.</span>
        </div>
      )}
      </Collapsible>
    </section>
  );
}
