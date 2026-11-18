// mm daycheck: run by the UserPromptSubmit hook on every message. In the hub orchestrator's thread, on the first
// message of a new day, it returns context telling the orchestrator to run `mm rollover` and settle finished threads.
// It takes no lock and writes nothing but daycheck.json. On the same day it reads only that file and the ledger.
import path from "node:path";
import { dayKey, locate, now, readJson, readLedger, writeJson } from "./core.mjs";
import { dailyThreadsToSettle, days, readMeta } from "./devlog.mjs";

// The hook's JSON output as a string, or null when there is nothing to say.
export function dayCheck() {
  const ctx = locate();
  const ids = [process.env.T3CODE_THREAD_ID, process.env.MM_THREAD_ID].filter(Boolean);
  const ledger = readLedger(ctx);
  const hub = ledger.claims[ctx.config.project]?.threadId;
  if (!hub || !ids.includes(hub)) return null;

  const file = path.join(ctx.stateDir, "daycheck.json");
  const today = dayKey(now(), ctx.config.timezone);
  let last = null;
  try { last = readJson(file, null)?.lastChecked || null; } catch { /* unreadable: treated as never checked */ }
  if (last === today) return null;

  const openDays = days(ctx).filter((d) => d < today && !readMeta(ctx, d).final);
  const { ready, later } = dailyThreadsToSettle(ctx, ledger);
  if (!openDays.length && !ready.length && !later.length) writeJson(file, { lastChecked: today, at: now().toISOString() });

  const text = [
    `The day has changed to ${today} (last checked ${last || "never"}).`,
    `Run \`${ctx.mmPath} rollover\`: it closes finished devlog days and starts today's Daily Update thread.`,
    "Then settle each thread it lists under settleThreads with t3_thread_organize (action settle).",
    "Threads under settleLater are still finishing and will be listed again on a later message.",
    ready.length ? `Ready to settle now: ${ready.map((t) => `${t.day} (${t.threadId})`).join(", ")}.` : "",
  ].filter(Boolean).join(" ");
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text } });
}
