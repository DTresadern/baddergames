// Orchestrator claims, lanes and tasks.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  currentThreadId, fail, fillTemplate, gh, ghJson, git, now, nsInfo, nsShort, readJson, t3, threadInfo, threadState,
  writeJson, writeLedger, writeText,
} from "./core.mjs";
import { LANE_STATES, recordEvent } from "./devlog.mjs";

const LANE_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const OPEN = (l) => !["merged", "closed"].includes(l.state);


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

// A lane records its own thread as its first step, so the ledger has it even if the orchestrator did not.
export function laneAttach(ctx, ledger, name, threadId = currentThreadId()) {
  const lane = ledger.lanes[name] || fail(`no lane "${name}"`);
  if (!threadId) fail("no thread id: run inside T3 or pass --thread-id");
  if (lane.threadId && lane.threadId !== threadId) fail(`lane "${name}" is attached to thread ${lane.threadId}, not ${threadId}`);
  lane.threadId = threadId;
  return lane;
}

const REPORT = /^\s*(WORKING|HELD|WAITING|BLOCKED|SCOPE|REQUEST-LANE|CLOSED):\s*(.*)/;
const REPORT_STATE = { WORKING: "running", HELD: "held", WAITING: "waiting", BLOCKED: "blocked", SCOPE: "blocked", "REQUEST-LANE": "waiting", CLOSED: "closed" };
const BUSY = new Set(["preparing", "queued", "starting", "running"]);
const STOPPED = new Set(["interrupted", "failed", "cancelled", "rolled_back"]);
const PR_URL = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/;
const SYNC_BUDGET_MS = 20000;
// A lane can end a turn while its own background work runs (reviews, browser checks) and wake again when it finishes;
// T3 shows no sign of that work. A turn without a status line is flagged only if no new run starts within this time.
const quietMinutes = (ctx) => ctx.config.laneQuietMinutes ?? 15;

// Read every open lane's thread and record what it reports, so the ledger does not depend on the orchestrator
// remembering. A thread is read again only when its latest run, its status or its pending questions change.
// Only the latest run's own final message counts as its report. An unreachable T3 changes nothing.
// Changes wait in ledger.pendingChanges until `mm status` reports them.
export function syncLanes(ctx, ledger) {
  const notes = [];
  const deadline = Date.now() + SYNC_BUDGET_MS;
  for (const lane of laneList(ledger, { open: true })) {
    if (!lane.threadId) continue;
    if (Date.now() > deadline) { notes.push("lane sync stopped early because T3 is slow; the other lanes are read on the next run"); break; }
    const r = t3(["thread", "show", lane.threadId, "--json", "--messages", "5"], undefined, 10000);
    if (r.code) continue;
    const { thread, messages = [] } = JSON.parse(r.out);
    const pending = thread.pendingRequestCount > 0 || thread.status === "waiting";
    const busy = !pending && (Boolean(thread.activeRunId) || BUSY.has(thread.status));
    const marker = `${thread.latestRunId}|${pending}|${busy}|${thread.status}`;
    const quietFor = lane.quietSince ? (now() - new Date(lane.quietSince)) / 60000 : 0;
    if (marker === lane.syncMarker && !(lane.quietSince && quietFor >= quietMinutes(ctx))) continue;
    if (marker !== lane.syncMarker) delete lane.quietSince;
    lane.syncMarker = marker;
    const set = (state, note, extra = {}) => {
      if (state === lane.state && (!extra.pr || extra.pr === lane.pr) && (state === "running" || note === lane.history.at(-1)?.note)) return;
      if (["started", "running"].includes(lane.state) && state === "running") { lane.state = "running"; lane.history.push({ at: now().toISOString(), state, note }); return; }
      laneUpdate(ctx, ledger, lane.name, state, { note, ...extra });
      notes.push(`${lane.name}: ${state}${note ? ` (${note})` : ""}`);
    };
    if (pending) { set("waiting", "the lane asked a question"); continue; }
    if (busy) { set("running", "the lane is working again"); continue; }
    if (STOPPED.has(thread.status)) { set("blocked", `the lane's run ended as ${thread.status}; read its thread`); continue; }
    const last = [...messages].reverse().find((m) => m.role !== "user" && m.runId === thread.latestRunId)?.text || "";
    const m = last.match(REPORT);
    if (!m) {
      if (!lane.quietSince) {
        lane.quietSince = now().toISOString();
        set("running", `turn ended without a status line; treated as working for ${quietMinutes(ctx)} minutes`);
      } else if ((now() - new Date(lane.quietSince)) / 60000 >= quietMinutes(ctx)) {
        delete lane.quietSince;
        if (lane.state === "running") set("waiting", `the lane ended its turn without a status line and has been quiet for ${quietMinutes(ctx)} minutes; read its thread`);
      }
      continue;
    }
    const [, word, rest] = m;
    const detail = rest.trim().slice(0, 300);
    const pr = Number(rest.match(PR_URL)?.[1]) || undefined;
    if (word === "REQUEST-LANE") { laneUpdate(ctx, ledger, lane.name, "request-lane", { note: detail }); notes.push(`${lane.name}: requests another lane: ${detail}`); }
    if (word === "CLOSED") { laneUpdate(ctx, ledger, lane.name, "closed", { note: `closed: ${detail}` }); notes.push(`${lane.name}: closed: ${detail}`); continue; }
    set(REPORT_STATE[word], `${word}: ${detail}`, pr ? { pr } : {});
  }
  ledger.pendingChanges = [...(ledger.pendingChanges || []), ...notes.map((note) => ({ at: now().toISOString(), note }))];
  return notes;
}

const CHECK_PASSED = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);
const checkResult = (c) => c.conclusion || c.state || c.status;

// The only way a lane's pull request is merged. It must be the lane's own branch into the default branch, open,
// CLEAN, with at least one check passed and none failed or pending, and at the commit the lane's worktree is at.
export function laneMerge(ctx, ledger, name) {
  const lane = ledger.lanes[name] || fail(`no lane "${name}"`);
  if (lane.state !== "held") fail(`lane "${name}" is ${lane.state}, not held for approval`);
  if (!lane.pr) fail(`lane "${name}" has no pull request recorded`);
  const base = ctx.config.defaultBranch || "main";
  const pr = ghJson(ctx, ["pr", "view", String(lane.pr), "--json", "state,mergeStateStatus,statusCheckRollup,headRefName,headRefOid,baseRefName,url"]);
  const checks = pr.statusCheckRollup || [];
  const bad = checks.filter((c) => !CHECK_PASSED.has(checkResult(c))).map((c) => `${c.name || c.context}: ${checkResult(c)}`);
  const info = lane.threadId ? threadInfo(lane.threadId) : { state: "gone", thread: null };
  const wt = info.thread?.worktreePath && fs.existsSync(info.thread.worktreePath) ? info.thread.worktreePath : null;
  const wtHead = wt ? git(["rev-parse", "HEAD"], wt).out : null;
  const problems = [
    pr.headRefName !== lane.branch && `pull request #${lane.pr} is from branch ${pr.headRefName}, not the lane's branch ${lane.branch}`,
    pr.baseRefName !== base && `it targets ${pr.baseRefName}, not ${base}`,
    pr.state !== "OPEN" && `it is ${pr.state}`,
    pr.mergeStateStatus !== "CLEAN" && `GitHub reports it as ${pr.mergeStateStatus}, not CLEAN`,
    !checks.some((c) => checkResult(c) === "SUCCESS") && "no check ran and passed on it",
    bad.length && `checks not passed: ${bad.join(", ")}`,
    wtHead && wtHead !== pr.headRefOid && `the lane's worktree is at ${wtHead.slice(0, 7)} but the pull request is at ${pr.headRefOid?.slice(0, 7)}: the lane has commits that are not in the pull request`,
    wt && git(["status", "--porcelain"], wt).out && "the lane's worktree has uncommitted changes",
  ].filter(Boolean);
  if (problems.length) fail(`not merged: ${problems.join("; ")}`);
  const merged = gh(ctx, ["pr", "merge", String(lane.pr), "--merge", "--match-head-commit", pr.headRefOid]);
  if (merged.code) fail(`gh pr merge failed: ${merged.err || merged.out}`);
  laneUpdate(ctx, ledger, name, "merged", { note: `${lane.title} (PR #${lane.pr} merged)` });
  writeLedger(ctx, ledger);
  return { lane: name, merged: pr.url, cleanup: cleanupLane(ctx, pr.headRefName, info, wt) };
}

// Finish the cleanup of a merged or closed lane, for example after a merge that was stopped partway. Safe to repeat.
export function laneCleanup(ctx, ledger, name) {
  const lane = ledger.lanes[name] || fail(`no lane "${name}"`);
  if (!["merged", "closed"].includes(lane.state)) fail(`lane "${name}" is ${lane.state}; only merged or closed lanes are cleaned up`);
  const info = lane.threadId ? threadInfo(lane.threadId) : { state: "gone", thread: null };
  const wt = info.thread?.worktreePath && fs.existsSync(info.thread.worktreePath) ? info.thread.worktreePath : null;
  return { lane: name, state: lane.state, cleanup: cleanupLane(ctx, lane.branch, info, wt) };
}

const laneWorktreeRoot = (ctx) => path.resolve((ctx.config.laneWorktreeRoot || "~/.t3/worktrees").replace(/^~(?=\/|$)/, os.homedir()));

// Only a linked git worktree inside T3's worktree folder is a lane worktree. The main checkout never is.
function laneWorktreeProblem(ctx, wt) {
  const real = fs.realpathSync(wt);
  const root = laneWorktreeRoot(ctx);
  if (real === fs.realpathSync(ctx.main)) return "it is the main checkout";
  if (!real.startsWith(root + path.sep)) return `it is not inside the lane worktree folder ${root}`;
  const gitDir = git(["rev-parse", "--path-format=absolute", "--git-dir"], wt).out;
  const commonDir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], wt).out;
  if (!gitDir || gitDir === commonDir) return "it is not a linked git worktree";
  return null;
}

// Each step reports what actually happened. Nothing in the main checkout is ever deleted: it is only fast-forwarded.
// A branch is deleted only when origin's default branch contains it; the default branch itself and the branch the
// main checkout is on are never deleted. A lane worktree is removed only when it is a lane worktree, the default
// branch contains its commit, and it has no uncommitted changes or new files; its ignored files go with it and are listed.
function cleanupLane(ctx, headRef, info, wt) {
  const base = ctx.config.defaultBranch || "main";
  const steps = {};
  const fetched = git(["fetch", "-q", "origin", base], ctx.main);
  steps.fetch = fetched.code ? `failed: ${fetched.err}` : "done";
  const onBase = git(["rev-parse", "--abbrev-ref", "HEAD"], ctx.main).out === base;
  const dirty = git(["status", "--porcelain", "--untracked-files=no"], ctx.main).out;
  if (!onBase || dirty) steps.mainCheckout = `not updated: ${!onBase ? `not on ${base}` : "it has uncommitted changes"}`;
  else { const pulled = git(["merge", "-q", "--ff-only", `origin/${base}`], ctx.main); steps.mainCheckout = pulled.code ? `not updated: ${pulled.err}` : "updated"; }
  const remoteRef = `refs/heads/${headRef}`;
  const remoteSha = git(["ls-remote", "origin", remoteRef], ctx.main).out.split("\n").map((l) => l.split("\t")).find(([, ref]) => ref === remoteRef)?.[0];
  if (remoteSha) git(["fetch", "-q", "origin", headRef], ctx.main);
  if (!remoteSha) steps.remoteBranch = `${headRef}: already gone`;
  else if (git(["merge-base", "--is-ancestor", remoteSha, `origin/${base}`], ctx.main).code) steps.remoteBranch = `${headRef}: kept, it has commits that are not in ${base}`;
  else { const remote = git(["push", "-q", `--force-with-lease=${remoteRef}:${remoteSha}`, "origin", "--delete", headRef], ctx.main); steps.remoteBranch = remote.code ? `not deleted: ${remote.err}` : `deleted ${headRef}`; }
  if (wt) {
    const notLane = laneWorktreeProblem(ctx, wt);
    const head = git(["rev-parse", "HEAD"], wt).out;
    const changes = git(["status", "--porcelain"], wt).out;
    const ignored = git(["status", "--porcelain", "--ignored"], wt).out.split("\n").filter((l) => l.startsWith("!! ")).map((l) => l.slice(3));
    if (notLane) steps.worktree = `kept ${wt}: ${notLane}`;
    else if (git(["merge-base", "--is-ancestor", head, `origin/${base}`], ctx.main).code) steps.worktree = `kept ${wt}: its commit ${head.slice(0, 7)} is not in ${base}`;
    else if (changes) steps.worktree = `kept ${wt}: it has uncommitted changes or new files (${changes.split("\n").map((l) => l.slice(3)).slice(0, 5).join(", ")})`;
    else {
      const removed = git(["worktree", "remove", "--force", wt], ctx.main);
      steps.worktree = removed.code ? `not removed: ${removed.err}`
        : `removed ${wt}${ignored.length ? `; its ignored files went with it: ${ignored.slice(0, 10).join(", ")}${ignored.length > 10 ? ` and ${ignored.length - 10} more` : ""}` : ""}`;
    }
  } else {
    steps.worktree = info.state === "unknown" ? "not removed: T3 not reachable, so its path is not known" : "none found";
  }
  const current = git(["rev-parse", "--abbrev-ref", "HEAD"], ctx.main).out;
  const branches = [...new Set([headRef, info.thread?.branch].filter(Boolean))];
  steps.localBranches = branches.map((b) => {
    if (b === base || b === current) return `${b}: kept, it is the default branch or the main checkout's branch`;
    if (git(["rev-parse", "--verify", "-q", `refs/heads/${b}`], ctx.main).code) return `${b}: not present`;
    if (git(["merge-base", "--is-ancestor", b, `origin/${base}`], ctx.main).code) return `${b}: kept, it has commits that are not in ${base}`;
    const d = git(["branch", "-D", b], ctx.main);
    return d.code ? `${b}: not deleted: ${d.err}` : `${b}: deleted`;
  });
  return steps;
}

const SEGMENT = /^[a-z][a-z0-9-]{0,31}$/;

// Register a sub-project folder as a namespace and give it its agent files. Run in a lane: it changes tracked files.
export function nsAdd(ctx, folder) {
  const segments = folder.replace(/\/+$/, "").split("/");
  if (!segments.every((x) => SEGMENT.test(x))) fail("each folder name must match [a-z][a-z0-9-]{0,31}");
  const name = `${ctx.config.project}.${segments.join(".")}`;
  const configPath = path.join(ctx.checkout, ".mastermind", "config.json");
  const config = readJson(configPath);
  if (config.namespaces[name]) fail(`${name} already exists`);
  config.namespaces[name] = segments.join("/");
  writeJson(configPath, config);
  const root = path.join(ctx.checkout, ...segments);
  const up = "../".repeat(segments.length);
  const created = [];
  for (const [file, text] of [
    ["AGENTS.md", fillTemplate("subproject-agents.md", { name: segments.at(-1), namespace: name, project: ctx.config.project, root: segments.join("/"), up })],
    ["CLAUDE.md", "@AGENTS.md\n"],
  ]) {
    const p = path.join(root, file);
    if (fs.existsSync(p) && fs.readFileSync(p, "utf8").trim()) continue;
    writeText(p, text);
    created.push(path.relative(ctx.checkout, p));
  }
  return { namespace: name, root: segments.join("/"), created, config: path.relative(ctx.checkout, configPath) };
}


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

