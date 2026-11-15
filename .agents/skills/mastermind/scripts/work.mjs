// Orchestrator claims, lanes and tasks.
import fs from "node:fs";
import path from "node:path";
import {
  currentThreadId, fail, fillTemplate, gh, ghJson, git, now, nsInfo, nsShort, threadState, writeText,
} from "./core.mjs";
import { LANE_STATES, recordEvent } from "./devlog.mjs";

const LANE_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const OPEN = (l) => !["merged", "closed"].includes(l.state);

// ---------- claims ----------

export function claim(ctx, ledger, ns, { threadId = currentThreadId(), force = false } = {}) {
  nsInfo(ctx, ns);
  if (!threadId) fail("no thread id: run inside T3 or pass --thread-id");
  const held = ledger.claims[ns];
  if (held && held.threadId !== threadId && !force) {
    const state = threadState(held.threadId);
    if (state === "live") fail(`${ns} is claimed by thread ${held.threadId} (live). Settle that thread, or pass --force if it is not an orchestrator any more.`);
    if (state === "unknown") fail(`${ns} is claimed by thread ${held.threadId}, and T3 is not reachable to check it. Pass --force to replace the claim.`);
  }
  ledger.claims[ns] = { threadId, claimedAt: now().toISOString(), replaced: held && held.threadId !== threadId ? held.threadId : undefined };
  return ledger.claims[ns];
}

export function release(ctx, ledger, ns, threadId = currentThreadId()) {
  const held = ledger.claims[ns];
  if (!held) return false;
  if (held.threadId !== threadId) fail(`${ns} is claimed by another thread (${held.threadId})`);
  delete ledger.claims[ns];
  return true;
}

// The nearest namespace at or above `ns` with a live orchestrator.
export function owner(ctx, ledger, ns) {
  const parts = ns.split(".");
  for (let i = parts.length; i >= 2; i--) {
    const name = parts.slice(0, i).join(".");
    const held = ledger.claims[name];
    if (held && threadState(held.threadId) === "live") return { ns: name, threadId: held.threadId };
  }
  return null;
}

// ---------- git preconditions for a new lane ----------

export function gitPreflight(ctx) {
  const branch = ctx.config.defaultBranch || "main";
  const problems = [];
  const head = git(["rev-parse", "--abbrev-ref", "HEAD"], ctx.main).out;
  if (head !== branch) problems.push(`the main checkout is on "${head}", not "${branch}"`);
  const fetched = git(["fetch", "-q", "origin", branch], ctx.main);
  if (fetched.code) problems.push(`git fetch failed: ${fetched.err}`);
  const local = git(["rev-parse", branch], ctx.main).out;
  const remote = git(["rev-parse", `origin/${branch}`], ctx.main).out;
  if (local && remote && local !== remote) {
    const [behind, ahead] = git(["rev-list", "--left-right", "--count", `origin/${branch}...${branch}`], ctx.main).out.split(/\s+/);
    problems.push(`local ${branch} differs from origin/${branch} (${behind} behind, ${ahead} ahead): run git pull --ff-only first`);
  }
  const dirty = git(["status", "--porcelain", "--untracked-files=no"], ctx.main).out;
  if (dirty) problems.push(`the main checkout has uncommitted changes to tracked files:\n${dirty}`);
  return problems;
}

// ---------- lanes ----------

function providerFor(ctx, needs, requested) {
  const providers = ctx.config.models.lane;
  for (const cap of needs) if (!ctx.config.capabilities[cap]) fail(`unknown capability "${cap}". Known: ${Object.keys(ctx.config.capabilities).join(", ")}`);
  const allowed = Object.keys(providers).filter((p) => needs.every((cap) => ctx.config.capabilities[cap].includes(p)));
  if (requested) {
    if (!providers[requested]) fail(`unknown provider "${requested}". Known: ${Object.keys(providers).join(", ")}`);
    if (!allowed.includes(requested)) fail(`provider "${requested}" cannot do: ${needs.filter((c) => !ctx.config.capabilities[c].includes(requested)).join(", ")}. Use ${allowed.join(" or ") || "no provider has all of these"}.`);
    return requested;
  }
  if (!allowed.length) fail(`no provider has all of: ${needs.join(", ")}`);
  return allowed.includes(ctx.config.defaultProvider) ? ctx.config.defaultProvider : allowed[0];
}

function targetOptions(m) {
  return Object.fromEntries(Object.entries(m).filter(([k]) => !["provider", "model"].includes(k)));
}

export function laneNew(ctx, ledger, o) {
  if (!LANE_NAME.test(o.name || "")) fail("lane name must match [a-z][a-z0-9-]{0,31}");
  if (ledger.lanes[o.name]) fail(`lane "${o.name}" already exists (state ${ledger.lanes[o.name].state}); lane names are never reused`);
  const ns = nsInfo(ctx, o.ns);
  if (!o.title) fail("--title is required");
  const cls = o.class || "standard";
  if (!["simple", "standard", "hard"].includes(cls)) fail("--class must be simple, standard or hard");
  const reviewer = o.reviewer || "gristle";
  if (!["gristle", "r9000", "both", "none"].includes(reviewer)) fail("--reviewer must be gristle, r9000, both or none");
  const needs = o.needs || [];
  const provider = providerFor(ctx, needs, o.provider);
  if (!o.skipGitCheck) {
    const problems = gitPreflight(ctx);
    if (problems.length) fail(`cannot start a lane:\n- ${problems.join("\n- ")}`);
  }
  const overlap = Object.values(ledger.lanes).filter((l) => OPEN(l) && l.ns === o.ns);
  const lane = ctx.config.models.lane[provider];
  const builder = provider === "codex" ? null : ctx.config.models.builder[cls === "hard" ? "hard" : "default"];
  const reviewerModel = ctx.config.models.reviewer[provider];
  const short = nsShort(ctx, o.ns);
  const title = `${o.ns} · ${o.name}${o.issue ? ` · #${o.issue}` : ""}`;
  const branch = `${short}/${o.issue ? `${o.issue}-` : ""}${o.name}`;
  const orchestrator = currentThreadId();
  const goal = o.goalFile ? fs.readFileSync(o.goalFile, "utf8").trim() : (o.issue ? `See issue #${o.issue}.` : fail("give --goal-file or --issue"));
  const brief = fillTemplate("lane-brief.md", {
    lane: o.name, title: o.title, namespace: o.ns, short, root: ns.root || ".", issue: o.issue ? `#${o.issue}` : "none yet",
    branch, provider, class: cls, classReason: o.classReason || "not given",
    builder: builder ? `${builder.model} (${builder.effort} effort)` : "none: do the work in this session",
    reviewer, reviewerModel: `${reviewerModel.model}`, needs: needs.length ? needs.join(", ") : "none",
    goal, mm: ctx.mmPath, project: ctx.config.project, orchestrator: orchestrator || "unknown",
  });
  const briefPath = path.join(ctx.stateDir, "briefs", `${o.name}.md`);
  writeText(briefPath, brief);
  const at = now().toISOString();
  ledger.lanes[o.name] = {
    name: o.name, ns: o.ns, title: o.title, threadTitle: title, issue: o.issue || null, branch, provider, class: cls,
    reviewer, needs, state: "started", startedAt: at, endedAt: null, pr: null, threadId: null, taskId: null,
    orchestrator, history: [{ at, state: "started" }],
  };
  recordEvent(ctx, ledger, {
    at, kind: "started", ns: o.ns, lane: o.name, what: o.title,
    links: o.issue ? [`#${o.issue}`] : [], why: o.why || undefined,
  });
  return {
    lane: o.name, briefPath, overlap: overlap.map((l) => `${l.name} (${l.state}): ${l.title}`),
    delegate_task: {
      title, task: `<contents of ${briefPath}>`, isolation: "worktree", mode: "async", role: "implementation",
      target: { providerInstanceId: lane.provider, model: lane.model, options: targetOptions(lane) },
    },
    next: `call delegate_task with these values and the brief as the task, then run: mm lane set ${o.name} --thread-id <childThreadId> --task-id <taskId>`,
  };
}

export function laneSet(ctx, ledger, name, o) {
  const lane = ledger.lanes[name] || fail(`no lane "${name}"`);
  for (const k of ["threadId", "taskId", "issue", "pr"]) if (o[k] != null) lane[k] = o[k];
  return lane;
}

export function laneUpdate(ctx, ledger, name, state, o = {}) {
  const lane = ledger.lanes[name] || fail(`no lane "${name}"`);
  const kinds = [...LANE_STATES.filter((s) => s !== "started"), "request-lane"];
  if (!kinds.includes(state)) fail(`state must be one of: ${kinds.join(", ")}`);
  if (!OPEN(lane)) fail(`lane "${name}" is already ${lane.state}`);
  const at = o.at || now().toISOString();
  if (o.pr != null) lane.pr = o.pr;
  if (state !== "request-lane") {
    lane.state = state;
    lane.history.push({ at, state, note: o.note });
    if (state === "merged" || state === "closed") lane.endedAt = at;
  }
  const what = state === "request-lane" ? `requests another lane: ${o.note || "(no detail)"}` : (o.note || lane.title);
  const links = [lane.issue && `#${lane.issue}`, lane.pr && `PR #${lane.pr}`].filter(Boolean);
  recordEvent(ctx, ledger, { at, kind: state, ns: lane.ns, lane: name, what, why: o.why, links });
  return lane;
}

export function laneList(ledger, { open = false } = {}) {
  return Object.values(ledger.lanes).filter((l) => !open || OPEN(l)).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

// Compare open lanes with T3 and GitHub. Merged or closed pull requests close their lanes.
export function reconcile(ctx, ledger) {
  const notes = [];
  for (const lane of laneList(ledger, { open: true })) {
    if (lane.pr) {
      const r = gh(ctx, ["pr", "view", String(lane.pr), "--json", "state,mergedAt,closedAt"]);
      if (r.code === 0) {
        const pr = JSON.parse(r.out);
        if (pr.state === "MERGED") { laneUpdate(ctx, ledger, lane.name, "merged", { at: pr.mergedAt, note: `${lane.title} (PR #${lane.pr} merged)` }); notes.push(`${lane.name}: PR #${lane.pr} merged, lane closed`); continue; }
        if (pr.state === "CLOSED") { laneUpdate(ctx, ledger, lane.name, "closed", { at: pr.closedAt, note: `${lane.title} (PR #${lane.pr} closed without merging)` }); notes.push(`${lane.name}: PR #${lane.pr} closed, lane closed`); continue; }
      }
    }
    if (lane.threadId) {
      const st = threadState(lane.threadId);
      if (st === "gone" || st === "archived") notes.push(`${lane.name}: its thread is ${st} but the lane is still ${lane.state}`);
    } else {
      notes.push(`${lane.name}: no thread recorded (run mm lane set ${lane.name} --thread-id …)`);
    }
  }
  return notes;
}

// ---------- tasks ----------

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "task";

function parseTask(file) {
  const text = fs.readFileSync(file, "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) fail(`${file} has no front matter`);
  const fields = Object.fromEntries(m[1].split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf(":");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }));
  return { fields, body: m[2].trim(), file };
}
function writeTask(file, fields, body) {
  const head = Object.entries(fields).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}: ${v}`).join("\n");
  writeText(file, `---\n${head}\n---\n\n${body.trim()}\n`);
}

export function taskNew(ctx, ns, title, body = "") {
  nsInfo(ctx, ns);
  const dir = path.join(ctx.tasksDir, ns);
  let slug = slugify(title);
  for (let i = 2; fs.existsSync(path.join(dir, `${slug}.md`)); i++) slug = `${slugify(title)}-${i}`;
  const file = path.join(dir, `${slug}.md`);
  writeTask(file, { title, ns, status: "backlog", created: now().toISOString() }, body || "(no detail yet)");
  return { id: `${ns}/${slug}`, file };
}

export function taskList(ctx, ns) {
  if (!fs.existsSync(ctx.tasksDir)) return [];
  const spaces = ns ? [ns] : fs.readdirSync(ctx.tasksDir);
  return spaces.flatMap((space) => {
    const dir = path.join(ctx.tasksDir, space);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => {
      const t = parseTask(path.join(dir, f));
      return { id: `${space}/${f.slice(0, -3)}`, ...t.fields, file: t.file };
    });
  });
}

export function taskFind(ctx, words) {
  const terms = words.toLowerCase().split(/\s+/).filter(Boolean);
  const local = taskList(ctx).filter((t) => {
    const hay = (t.title + " " + parseTask(t.file).body).toLowerCase();
    return terms.every((w) => hay.includes(w));
  });
  const r = gh(ctx, ["issue", "list", "--state", "all", "--search", words, "--json", "number,title,state,labels,url", "--limit", "20"]);
  const issues = r.code === 0 ? JSON.parse(r.out) : [];
  return { tasks: local, issues, issueSearch: r.code === 0 ? "ok" : `failed: ${r.err}` };
}

export function issueNew(ctx, ns, title, body) {
  nsInfo(ctx, ns);
  const label = `ns:${nsShort(ctx, ns)}`;
  gh(ctx, ["label", "create", label, "--color", "5319e7", "--description", `Work in ${ns}`, "--force"]);
  const bodyFile = path.join(ctx.stateDir, `issue-body-${process.pid}.md`);
  writeText(bodyFile, body || "(no detail yet)");
  const r = gh(ctx, ["issue", "create", "--title", title, "--body-file", bodyFile, "--label", label]);
  fs.rmSync(bodyFile, { force: true });
  if (r.code) fail(`gh issue create failed: ${r.err || r.out}`);
  const url = r.out.split("\n").pop().trim();
  const number = Number(url.match(/\/issues\/(\d+)/)?.[1]);
  if (!number) fail(`could not read the issue number from: ${r.out}`);
  return { number, url, label };
}

// Pair a task with an issue. After this the issue is the only description; the file keeps a link.
export function taskStart(ctx, id, { issue } = {}) {
  const file = path.join(ctx.tasksDir, `${id}.md`);
  if (!fs.existsSync(file)) fail(`no task ${id} (${file})`);
  const t = parseTask(file);
  if (t.fields.issue) fail(`task ${id} is already paired with issue ${t.fields.issue}`);
  let pair;
  if (issue) {
    const info = ghJson(ctx, ["issue", "view", String(issue), "--json", "number,url"]);
    pair = { number: info.number, url: info.url };
  } else {
    pair = issueNew(ctx, t.fields.ns, t.fields.title, t.body);
  }
  writeTask(file, { ...t.fields, status: "active", issue: `#${pair.number}`, url: pair.url, started: now().toISOString() },
    `Moved to issue #${pair.number}: ${pair.url}\nThe issue is the description from now on; do not edit this file.`);
  return { id, issue: pair.number, url: pair.url };
}

