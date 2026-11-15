// The shared devlog: events (one JSONL file per local day), day closing (rollover), HTML pages,
// and the one-thread-per-day Daily Update session.
import fs from "node:fs";
import path from "node:path";
import {
  addDays, clock, dayKey, fail, fillTemplate, gh, git, longDate, now, nsShort, readJson,
  t3, t3Available, threadState, weekday, writeJson, writeText,
} from "./core.mjs";

export const LANE_STATES = ["started", "running", "held", "waiting", "blocked", "merged", "closed"];
// Kinds an orchestrator records directly. Lane states are recorded only through `mm lane`.
export const NOTE_KINDS = ["decision", "finding", "show", "note"];
const COMPLETE = new Set(["merged", "closed"]);
const SWEEP_KINDS = new Set(["pr-merged", "commit"]);
const STATE_LABEL = {
  started: "running", running: "running", held: "waiting for your approval",
  waiting: "waiting for your answer", blocked: "blocked", merged: "merged", closed: "closed without merging",
};

const dataDir = (ctx) => path.join(ctx.devlogDir, "data");
const eventsFile = (ctx, day) => path.join(dataDir(ctx), `${day}.jsonl`);
const metaFile = (ctx, day) => path.join(dataDir(ctx), `${day}.json`);
const rolloverFile = (ctx) => path.join(dataDir(ctx), "rollover.json");
const tzOf = (ctx) => ctx.config.timezone;
const today = (ctx) => dayKey(now(), tzOf(ctx));

export function days(ctx) {
  if (!fs.existsSync(dataDir(ctx))) return [];
  return fs.readdirSync(dataDir(ctx)).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).map((f) => f.slice(0, 10)).sort();
}
export function readEvents(ctx, day) {
  const p = eventsFile(ctx, day);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .sort((a, b) => a.at.localeCompare(b.at));
}
export const readMeta = (ctx, day) => readJson(metaFile(ctx, day), { final: false });
const writeMeta = (ctx, day, meta) => writeJson(metaFile(ctx, day), meta);

// Returns the event's day and whether this created the day's file.
function appendEvent(ctx, ev) {
  const day = dayKey(ev.at, tzOf(ctx));
  const created = !fs.existsSync(eventsFile(ctx, day));
  fs.mkdirSync(dataDir(ctx), { recursive: true });
  fs.appendFileSync(eventsFile(ctx, day), JSON.stringify(ev) + "\n");
  return { day, created };
}

// All events read once: the day list, events per day, and every lane's start, end and state history.
function snapshot(ctx) {
  const all = days(ctx);
  const events = Object.fromEntries(all.map((d) => [d, readEvents(ctx, d)]));
  const lanes = new Map();
  for (const d of all) {
    for (const ev of events[d]) {
      if (!ev.lane || !LANE_STATES.includes(ev.kind)) continue;
      const lane = lanes.get(ev.lane) || { name: ev.lane, ns: ev.ns, title: ev.lane, links: [], history: [] };
      if (ev.kind === "started" && !lane.start) Object.assign(lane, { start: ev.at, title: ev.what, links: ev.links || [], ns: ev.ns });
      if (COMPLETE.has(ev.kind) && !lane.end) Object.assign(lane, { end: ev.at, endKind: ev.kind });
      lane.history.push(ev);
      lanes.set(ev.lane, lane);
    }
  }
  for (const lane of lanes.values()) lane.history.sort((a, b) => a.at.localeCompare(b.at));
  return { days: all, events, lanes: [...lanes.values()].filter((l) => l.start) };
}

function renderAll(ctx, which) {
  const snap = snapshot(ctx);
  for (const d of snap.days.filter(which)) renderDay(ctx, d, snap);
  renderIndex(ctx, snap);
}

function dailyTitle(ctx, day) { return `${ctx.config.project} · daily update · ${day}`; }

function eventMessage(ctx, ev, day, closed) {
  const lines = [
    `[devlog event · ${day} ${clock(ev.at, tzOf(ctx))}] ${nsShort(ctx, ev.ns)} · ${ev.kind}${ev.lane ? ` · lane ${ev.lane}` : ""}`,
    `What: ${ev.what}`,
  ];
  if (ev.why) lines.push(`Why it matters: ${ev.why}`);
  if (ev.links?.length) lines.push(`Links: ${ev.links.join(" · ")}`);
  lines.push("", closed
    ? `${day} is already closed; this event was recorded late. Correct the final summary for ${day} if it changes the story.`
    : `The event is already saved. Update the summary for ${day} if this changes the story of the day (see your brief).`);
  return lines.join("\n");
}

// Returns { id, created, state }. Creates the day's thread only when none exists or the old one is archived or gone.
function ensureDailyThread(ctx, ledger, day, firstMessage) {
  const existing = ledger.dailyThreads[day];
  if (existing) {
    const state = threadState(existing);
    if (state === "live" || state === "settled" || state === "unknown") return { id: existing, created: false, state };
  }
  if (!t3Available()) return { id: null, created: false, state: "no-t3" };
  const m = ctx.config.models.dailyUpdate;
  const brief = fillTemplate("daily-update-brief.md", {
    day, longDate: longDate(day), project: ctx.config.project, mm: ctx.mmPath, devlog: ctx.devlogDir,
    timezone: tzOf(ctx), firstEvent: firstMessage,
  });
  const r = t3(["thread", "start", ctx.main, "-", "--title", dailyTitle(ctx, day), "--provider", m.provider, "--model", m.model, "--json"], brief);
  if (r.code) return { id: null, created: false, state: "start-failed", error: r.err || r.out };
  const id = JSON.parse(r.out).threadId;
  ledger.dailyThreads[day] = id;
  return { id, created: true, state: "live" };
}

function sendToThread(id, text) { return t3(["thread", "send", id, "-"], text).code === 0; }

// Save one event, rebuild the affected pages, and pass it to its day's Daily Update thread.
// Today's events create today's thread if needed. A late event for a closed day goes to that day's thread, if it still exists.
export function recordEvent(ctx, ledger, ev, { notify = true } = {}) {
  if (!ev.at) ev.at = now().toISOString();
  const { day, created } = appendEvent(ctx, ev);
  const isToday = day === today(ctx);
  const late = day < today(ctx);
  const meta = readMeta(ctx, day);
  if (late && meta.final) writeMeta(ctx, day, { ...meta, amendedAt: now().toISOString() });
  // A late event can change "carried over" lines on later pages; a new day file changes its neighbours' links.
  const all = days(ctx);
  const i = all.indexOf(day);
  renderAll(ctx, (d) => (late && d >= day) || d === day || (created && (d === all[i - 1] || d === all[i + 1])));
  let thread = null;
  if (notify && !SWEEP_KINDS.has(ev.kind)) {
    const message = eventMessage(ctx, ev, day, late && meta.final);
    if (isToday) {
      thread = ensureDailyThread(ctx, ledger, day, message);
      if (thread.id && !thread.created) thread.sent = sendToThread(thread.id, message);
    } else if (ledger.dailyThreads[day] && ["live", "settled"].includes(threadState(ledger.dailyThreads[day]))) {
      thread = { id: ledger.dailyThreads[day], created: false, sent: sendToThread(ledger.dailyThreads[day], message) };
    }
  }
  return { day, thread };
}

// Merged pull requests and first-parent commits on the default branch, by local day, for [start, end].
// ok is false when either source could not be read, so the caller does not close those days.
function sweep(ctx, start, end) {
  const tz = tzOf(ctx);
  const byDay = {};
  const warnings = [];
  const add = (ev) => {
    const day = dayKey(ev.at, tz);
    if (day >= start && day <= end) (byDay[day] ||= []).push(ev);
  };
  const shortToNs = Object.fromEntries(Object.keys(ctx.config.namespaces).map((n) => [nsShort(ctx, n), n]));
  const prs = gh(ctx, ["pr", "list", "--state", "merged", "--search", `merged:>=${addDays(start, -1)}`,
    "--json", "number,title,url,mergedAt,headRefName", "--limit", "300"]);
  if (prs.code) warnings.push(`GitHub sweep failed: ${prs.err || prs.out}`);
  for (const pr of prs.code ? [] : JSON.parse(prs.out || "[]")) {
    add({
      at: pr.mergedAt, kind: "pr-merged", ns: shortToNs[(pr.headRefName || "").split("/")[0]] || ctx.config.project,
      what: `#${pr.number} ${pr.title}`, links: [pr.url], key: `pr:${pr.number}`, source: "sweep",
    });
  }
  const branch = ctx.config.defaultBranch || "main";
  const fetched = git(["fetch", "-q", "origin", branch], ctx.main);
  if (fetched.code) warnings.push(`git fetch failed: ${fetched.err}`);
  const log = fetched.code ? null
    : git(["log", "--first-parent", `--since=${addDays(start, -1)}T00:00:00Z`, "--format=%H%x1f%cI%x1f%s", `origin/${branch}`], ctx.main);
  if (log?.code) warnings.push(`git log failed: ${log.err}`);
  for (const line of log && !log.code ? log.out.split("\n").filter(Boolean) : []) {
    const [hash, at, subject] = line.split("\x1f");
    if (/^Merge pull request #\d+/.test(subject)) continue;
    add({ at: new Date(at).toISOString(), kind: "commit", ns: ctx.config.project, what: subject, links: [hash.slice(0, 7)], key: `commit:${hash}`, source: "sweep" });
  }
  return { byDay, warnings, ok: warnings.length === 0 };
}

// Close every past day that is not final. Safe to run any number of times.
export function rollover(ctx, ledger) {
  const day0 = today(ctx);
  const yesterday = addDays(day0, -1);
  const state = readJson(rolloverFile(ctx), {});
  const open = days(ctx).filter((d) => d < day0 && !readMeta(ctx, d).final);
  let start = state.lastDay ? addDays(state.lastDay, 1) : yesterday;
  if (open.length && open[0] < start) start = open[0];
  const result = { today: day0, closed: [], finaliseSent: [], warnings: [] };

  if (start <= yesterday) {
    const { byDay, warnings, ok } = sweep(ctx, start, yesterday);
    result.warnings.push(...warnings);
    if (!ok) {
      result.warnings.push(`devlog days from ${start} to ${yesterday} stay open until the sweep works; nothing was closed`);
      return result;
    }
    for (const [d, evs] of Object.entries(byDay)) {
      const known = new Set(readEvents(ctx, d).map((e) => e.key).filter(Boolean));
      for (const ev of evs) if (!known.has(ev.key)) { appendEvent(ctx, ev); known.add(ev.key); }
    }
  }
  for (const d of days(ctx).filter((x) => x < day0 && !readMeta(ctx, x).final)) {
    writeMeta(ctx, d, { ...readMeta(ctx, d), final: true, finalisedAt: now().toISOString() });
    result.closed.push(d);
  }
  // Ask each closed day's thread for its final summary, once. Retried on a later run if T3 was not reachable.
  for (const d of days(ctx).filter((x) => x < day0)) {
    const meta = readMeta(ctx, d);
    if (!meta.final || meta.summary || meta.finaliseSentAt || meta.summaryMissing) continue;
    const id = ledger.dailyThreads[d];
    const st = threadState(id);
    if (st === "unknown") { result.warnings.push(`T3 not reachable: finalise for ${d} will be sent later`); continue; }
    if ((st === "live" || st === "settled") && sendToThread(id, fillTemplate("finalise-message.md", { day: d, mm: ctx.mmPath }))) {
      meta.finaliseSentAt = now().toISOString();
      result.finaliseSent.push(d);
    } else {
      meta.summaryMissing = true;
    }
    writeMeta(ctx, d, meta);
  }
  if (start <= yesterday) writeJson(rolloverFile(ctx), { lastDay: yesterday, at: now().toISOString() });
  if (result.closed.length || result.finaliseSent.length) renderAll(ctx, () => true);
  return result;
}

export function setSummary(ctx, day, text) {
  if (!fs.existsSync(eventsFile(ctx, day))) fail(`no devlog events for ${day}`);
  const meta = readMeta(ctx, day);
  writeMeta(ctx, day, { ...meta, summary: text.trim(), summaryAt: now().toISOString(), summaryMissing: false });
  renderAll(ctx, (d) => d === day);
}

export function renderPages(ctx, day) { renderAll(ctx, (d) => !day || d === day); }

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}
function markdown(text) {
  return text.trim().split(/\n\s*\n/).map((block) => {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`;
    if (/^#{1,3} /.test(lines[0]) && lines.length === 1) return `<h3>${inline(lines[0].replace(/^#+ /, ""))}</h3>`;
    return `<p>${lines.map(inline).join("<br>")}</p>`;
  }).join("\n");
}
const linkHtml = (l) => (/^https?:\/\//.test(l) ? `<a href="${esc(l)}">${esc(l.replace(/^https?:\/\/github\.com\/[^/]+\/[^/]+\//, ""))}</a>` : `<code>${esc(l)}</code>`);

function laneLine(ctx, lane, day, final) {
  const tz = tzOf(ctx);
  const sDay = dayKey(lane.start, tz);
  const eDay = lane.end ? dayKey(lane.end, tz) : null;
  const last = [...lane.history].reverse().find((h) => dayKey(h.at, tz) <= day);
  const state = STATE_LABEL[last?.kind] || "running";
  const since = `${weekday(sDay)} ${sDay.slice(5)} ${clock(lane.start, tz)}`;
  if (sDay === day && eDay === day) return `${clock(lane.start, tz)}–${clock(lane.end, tz)} · completed (${STATE_LABEL[lane.endKind]})`;
  if (sDay === day) return `started ${clock(lane.start, tz)} → ${final ? "ongoing at end of day" : "ongoing"} (${state})`;
  if (eDay === day) return `ongoing since ${since} → completed ${clock(lane.end, tz)} (${STATE_LABEL[lane.endKind]})`;
  return `carried over · ongoing since ${since} (${state}${final ? " at end of day" : ""})`;
}

const STYLE = `
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#6b6a65;--line:#e4e1d8;--card:#fff;--accent:#2f6f4f;--warn:#9a5b00}
@media (prefers-color-scheme:dark){:root{--bg:#171715;--fg:#ecebe6;--muted:#a3a29b;--line:#34332f;--card:#1f1f1c;--accent:#7cc39c;--warn:#e0a54a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:46rem;margin:0 auto;padding:2rem 1rem 4rem}a{color:var(--accent)}h1{font-size:1.6rem;margin:.2rem 0}
h2{font-size:1.05rem;margin:2rem 0 .6rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.meta{color:var(--muted);font-size:.9rem}.badge{display:inline-block;padding:.05rem .5rem;border:1px solid var(--line);border-radius:1rem;font-size:.8rem;margin-left:.4rem}
.badge.final{border-color:var(--accent);color:var(--accent)}.badge.open{border-color:var(--warn);color:var(--warn)}
.card{background:var(--card);border:1px solid var(--line);border-radius:.6rem;padding:.8rem 1rem;margin:.6rem 0}
ul.plain{list-style:none;padding:0;margin:0}ul.plain li{padding:.45rem 0;border-bottom:1px solid var(--line)}ul.plain li:last-child{border:0}
.time{font-variant-numeric:tabular-nums;color:var(--muted);margin-right:.5rem}.ns{font-size:.8rem;color:var(--muted);margin-right:.4rem}
.kind{font-size:.8rem;font-weight:600;margin-right:.4rem}.why{color:var(--muted)}code{font-size:.85em}
.day h3{margin:.1rem 0}.day p{margin:.3rem 0}`;

function page(title, body) {
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(title)}</title><style>${STYLE}</style></head><body><main>\n${body}\n</main></body></html>\n`;
}

function statusBadge(meta) {
  if (!meta.final) return '<span class="badge open">in progress</span>';
  if (meta.summary) return '<span class="badge final">final</span>';
  return `<span class="badge final">final · ${meta.summaryMissing ? "summary missing" : "summary being written"}</span>`;
}

function renderDay(ctx, day, snap) {
  const tz = tzOf(ctx);
  const meta = readMeta(ctx, day);
  const evs = snap.events[day] || [];
  const work = snap.lanes
    .filter((l) => dayKey(l.start, tz) <= day && (!l.end || dayKey(l.end, tz) >= day))
    .map((lane) => ({ lane, text: laneLine(ctx, lane, day, meta.final) }));
  const timeline = evs.filter((e) => !SWEEP_KINDS.has(e.kind));
  const swept = evs.filter((e) => SWEEP_KINDS.has(e.kind));
  const i = snap.days.indexOf(day);
  const prev = snap.days[i - 1];
  const next = snap.days[i + 1];

  const parts = [
    `<p class="meta"><a href="index.html">Devlog</a>${prev ? ` · <a href="${prev}.html">← ${prev}</a>` : ""}${next ? ` · <a href="${next}.html">${next} →</a>` : ""}</p>`,
    `<h1>${esc(longDate(day))}${statusBadge(meta)}</h1>`,
    `<p class="meta">${esc(ctx.config.project)} · times in ${esc(tz)}${meta.amendedAt ? " · a late event was added after the day closed" : ""}</p>`,
    "<h2>Summary</h2>",
    meta.summary ? `<div class="card">${markdown(meta.summary)}</div>`
      : `<p class="meta">${meta.final && meta.summaryMissing ? "No summary was written for this day." : "The summary is written during the day and finished after midnight."}</p>`,
  ];
  if (work.length) {
    parts.push("<h2>Work</h2>", '<ul class="plain">', ...work.map(({ lane, text }) =>
      `<li><span class="ns">${esc(nsShort(ctx, lane.ns))}</span><strong>${esc(lane.title)}</strong> <span class="meta">(${esc(lane.name)})</span><br>${esc(text)}${lane.links.length ? ` · ${lane.links.map(linkHtml).join(" · ")}` : ""}</li>`), "</ul>");
  }
  if (timeline.length) {
    parts.push("<h2>Timeline</h2>", '<ul class="plain">', ...timeline.map((e) =>
      `<li><span class="time">${clock(e.at, tz)}</span><span class="ns">${esc(nsShort(ctx, e.ns))}</span><span class="kind">${esc(e.kind)}</span>${esc(e.what)}` +
      `${e.why ? `<br><span class="why">${esc(e.why)}</span>` : ""}${e.links?.length ? `<br>${e.links.map(linkHtml).join(" · ")}` : ""}</li>`), "</ul>");
  }
  if (swept.length) {
    parts.push("<h2>Merged pull requests and commits</h2>", '<ul class="plain">', ...swept.map((e) =>
      `<li><span class="time">${clock(e.at, tz)}</span><span class="kind">${e.kind === "pr-merged" ? "PR" : "commit"}</span>${esc(e.what)} ${e.links.map(linkHtml).join(" ")}</li>`), "</ul>");
  }
  writeText(path.join(ctx.devlogDir, `${day}.html`), page(`Devlog ${day}`, parts.join("\n")));
}

function renderIndex(ctx, snap) {
  const tz = tzOf(ctx);
  const items = [...snap.days].reverse().map((day) => {
    const meta = readMeta(ctx, day);
    const count = (snap.events[day] || []).length;
    const completed = snap.lanes.filter((l) => l.end && dayKey(l.end, tz) === day).length;
    const first = meta.summary ? markdown(meta.summary.split(/\n\s*\n/)[0]) : `<p class="meta">${meta.final && meta.summaryMissing ? "No summary." : "Summary not written yet."}</p>`;
    return `<div class="card day"><h3><a href="${day}.html">${esc(longDate(day))}</a>${statusBadge(meta)}</h3>${first}` +
      `<p class="meta">${count} event${count === 1 ? "" : "s"} · ${completed} completed</p></div>`;
  });
  const body = [`<h1>Devlog</h1>`, `<p class="meta">${esc(ctx.config.project)} · one page per day · times in ${esc(tz)}</p>`,
    items.length ? items.join("\n") : '<p class="meta">No days yet.</p>'];
  writeText(path.join(ctx.devlogDir, "index.html"), page("Devlog", body.join("\n")));
}

export function devlogSummaryLine(ctx, ledger) {
  const d = today(ctx);
  return { today: d, events: readEvents(ctx, d).length, thread: ledger.dailyThreads[d] || null, page: path.join(ctx.devlogDir, `${d}.html`) };
}
