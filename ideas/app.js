'use strict';

const SIM = {
  baseRest: 240,        // rest length of an edge with 0 shared tags; actual = baseRest / (1 + weight)
  springBase: 0.02,     // spring stiffness = springBase + springPerShared * weight
  springPerShared: 0.02,
  repulsion: 9000,      // pairwise repulsion = repulsion / distance^2
  softening: 400,       // added to distance^2 so close pairs do not explode
  gravity: 0.012,       // weak pull towards the origin
  damping: 0.82,        // velocity multiplier per step
  maxSpeed: 30,         // per-step speed cap (px)
  collisionPad: 12,     // extra gap kept between node circles
  minIterations: 40,
  maxIterations: 900,
  energyStop: 0.01      // mean squared speed per node below which the layout is settled
};

/**
 * Turn parsed JSON into a clean idea list.
 * Throws an Error with a readable message if the top-level shape is wrong.
 */
function normaliseIdeas(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.ideas)) {
    throw new Error('Expected an object like { "ideas": [ ... ] }.');
  }
  const seen = new Set();
  const ideas = [];
  let skipped = 0;
  for (const raw of data.ideas) {
    if (!raw || typeof raw !== 'object') { skipped++; continue; }
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!id || !title || seen.has(id)) { skipped++; continue; }
    seen.add(id);
    const tags = [];
    if (Array.isArray(raw.tags)) {
      for (const t of raw.tags) {
        if (typeof t !== 'string') continue;
        const tag = t.trim().toLowerCase();
        if (tag && !tags.includes(tag)) tags.push(tag);
      }
    }
    const links = Array.isArray(raw.links)
      ? raw.links.filter((l) => typeof l === 'string').map((l) => l.trim()).filter(Boolean)
      : [];
    ideas.push({
      id,
      title,
      description: typeof raw.description === 'string' ? raw.description : '',
      tags,
      links
    });
  }
  return { ideas, skipped };
}

/**
 * Build nodes and edges from a normalised idea list.
 * Edge rule: shared tags >= 1, or either idea links to the other.
 * Edge weight = number of shared tags, at least 1 for an explicit link.
 * Initial positions are deterministic (circle, radius varies by index).
 */
function buildGraph(ideas) {
  const n = ideas.length;
  const indexById = new Map();
  ideas.forEach((idea, i) => indexById.set(idea.id, i));

  const nodes = ideas.map((idea, i) => {
    const angle = (2 * Math.PI * i) / Math.max(n, 1);
    const radius = 120 + (i % 3) * 50;
    return {
      index: i,
      idea,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      r: 14,
      degree: 0,
      edges: [],
      pinned: false
    };
  });

  const edges = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const tagsB = ideas[b].tags;
      const shared = ideas[a].tags.filter((t) => tagsB.includes(t));
      const linked = ideas[a].links.includes(ideas[b].id) || ideas[b].links.includes(ideas[a].id);
      if (shared.length === 0 && !linked) continue;
      const edge = {
        a,
        b,
        shared,
        linked,
        weight: Math.max(shared.length, 1)
      };
      edges.push(edge);
    }
  }

  edges.forEach((edge, ei) => {
    nodes[edge.a].edges.push(ei);
    nodes[edge.b].edges.push(ei);
  });
  for (const node of nodes) {
    node.degree = node.edges.length;
    node.r = 12 + Math.min(Math.sqrt(node.degree) * 3, 12);
  }

  return { nodes, edges };
}

/**
 * Advance the force simulation by one step. Mutates node x, y, vx, vy.
 * Returns the mean squared speed per node (0 when there are no nodes).
 * Pinned nodes do not move.
 */
function stepSimulation(graph, params) {
  const p = params || SIM;
  const nodes = graph.nodes;
  const n = nodes.length;
  if (n === 0) return 0;
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);

  // Repulsion (plus a push when circles overlap) between every pair.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dx = nodes[j].x - nodes[i].x;
      let dy = nodes[j].y - nodes[i].y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1e-6) {
        // Exactly coincident: separate along a deterministic direction.
        dx = -0.01;
        dy = 0.01;
        d2 = dx * dx + dy * dy;
      }
      const d = Math.sqrt(d2);
      let f = p.repulsion / (d2 + p.softening);
      const minDist = nodes[i].r + nodes[j].r + p.collisionPad;
      if (d < minDist) f += (minDist - d) * 0.2;
      const ux = dx / d;
      const uy = dy / d;
      fx[i] -= ux * f;
      fy[i] -= uy * f;
      fx[j] += ux * f;
      fy[j] += uy * f;
    }
  }

  // Springs along edges: more shared tags -> shorter rest length, stiffer spring.
  for (const edge of graph.edges) {
    const a = nodes[edge.a];
    const b = nodes[edge.b];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
    const rest = p.baseRest / (1 + edge.weight);
    const k = p.springBase + p.springPerShared * edge.weight;
    const f = k * (d - rest);
    const ux = dx / d;
    const uy = dy / d;
    fx[edge.a] += ux * f;
    fy[edge.a] += uy * f;
    fx[edge.b] -= ux * f;
    fy[edge.b] -= uy * f;
  }

  // Integrate, with weak gravity to the origin and damping.
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const node = nodes[i];
    if (node.pinned) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    node.vx = (node.vx + fx[i] - node.x * p.gravity) * p.damping;
    node.vy = (node.vy + fy[i] - node.y * p.gravity) * p.damping;
    const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
    if (speed > p.maxSpeed) {
      node.vx *= p.maxSpeed / speed;
      node.vy *= p.maxSpeed / speed;
    }
    node.x += node.vx;
    node.y += node.vy;
    energy += node.vx * node.vx + node.vy * node.vy;
  }
  return energy / n;
}

/** Run the simulation until settled or the iteration cap. Returns iterations used. */
function runUntilSettled(graph, params) {
  const p = params || SIM;
  let i = 0;
  while (i < p.maxIterations) {
    const energy = stepSimulation(graph, p);
    i++;
    if (i >= p.minIterations && energy < p.energyStop) break;
  }
  return i;
}

/** Related ideas for a node: connected nodes sorted by weight (desc), then title. */
function relatedIdeas(graph, index) {
  const node = graph.nodes[index];
  const out = node.edges.map((ei) => {
    const edge = graph.edges[ei];
    const other = edge.a === index ? edge.b : edge.a;
    return { index: other, shared: edge.shared, linked: edge.linked, weight: edge.weight };
  });
  out.sort((x, y) =>
    y.weight - x.weight ||
    graph.nodes[x.index].idea.title.localeCompare(graph.nodes[y.index].idea.title)
  );
  return out;
}

/**
 * Compute a view (scale, offsetX, offsetY) that fits all nodes in a w x h box.
 * extentOf(node) returns {left, right, top, bottom} world-space extents from the node centre.
 */
function fitView(nodes, w, h, padding, minScale, maxScale, extentOf) {
  if (nodes.length === 0 || w <= 0 || h <= 0) {
    return { scale: 1, offsetX: w / 2, offsetY: h / 2 };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const e = extentOf(node);
    minX = Math.min(minX, node.x - e.left);
    maxX = Math.max(maxX, node.x + e.right);
    minY = Math.min(minY, node.y - e.top);
    maxY = Math.max(maxY, node.y + e.bottom);
  }
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);
  let scale = Math.min((w - 2 * padding) / bw, (h - 2 * padding) / bh);
  scale = Math.min(Math.max(scale, minScale), maxScale);
  return {
    scale,
    offsetX: w / 2 - ((minX + maxX) / 2) * scale,
    offsetY: h / 2 - ((minY + maxY) / 2) * scale
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SIM, normaliseIdeas, buildGraph, stepSimulation, runUntilSettled, relatedIdeas, fitView };
}

function initApp() {
  const MIN_SCALE = 0.2;
  const MAX_SCALE = 5;
  const FIT_MAX_SCALE = 1.25;
  const FIT_PADDING = 36;
  const CLICK_SLOP = 5;           // px of movement still counted as a click
  const LABEL_FONT_PX = 13;
  const LABEL_LINE_PX = 16;
  const LABEL_MAX_WIDTH = 110;    // world px
  const LABEL_MAX_LINES = 3;
  const STEPS_PER_FRAME = 3;
  const FILE_PROTOCOL_MESSAGE =
    'Browsers block loading ideas.json when this page is opened straight from disk. ' +
    'Serve the folder with a static web server (see README), or choose the ideas.json file below.';

  const canvas = document.getElementById('cloud');
  const stage = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const statusArea = document.getElementById('status-area');
  const statusEl = document.getElementById('status');
  const fileFallback = document.getElementById('file-fallback');
  const fileBtn = document.getElementById('file-btn');
  const fileInput = document.getElementById('file-input');
  const fitBtn = document.getElementById('fit-btn');
  const dialog = document.getElementById('idea-dialog');
  const dialogClose = document.getElementById('dialog-close');
  const titleEl = document.getElementById('idea-title');
  const descEl = document.getElementById('idea-description');
  const tagsEl = document.getElementById('idea-tags');
  const relatedEl = document.getElementById('idea-related');
  const noRelatedEl = document.getElementById('idea-no-related');

  let graph = { nodes: [], edges: [] };
  let theme = {};
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let view = { scale: 1, offsetX: 0, offsetY: 0 };
  let userMoved = false;          // true once the user has panned or zoomed
  let simRunning = false;
  let simIterations = 0;
  let simMax = SIM.maxIterations;
  let drawQueued = false;
  let hoverIndex = -1;
  let selectedIndex = -1;
  const pointers = new Map();     // pointerId -> {x, y}
  let drag = null;
  let pinch = null;               // {dist, midX, midY}

  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const get = (name) => cs.getPropertyValue(name).trim();
    theme = {
      canvasBg: get('--canvas-bg'),
      node: get('--node'),
      nodeBorder: get('--node-border'),
      nodeHover: get('--node-hover'),
      edge: get('--edge'),
      label: get('--label'),
      accent: get('--accent'),
      font: LABEL_FONT_PX + 'px ' + getComputedStyle(document.body).fontFamily
    };
  }

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusArea.classList.toggle('error', !!isError);
  }

  function showFileFallback(message) {
    setStatus(message, true);
    fileFallback.hidden = false;
  }

  function loadText(text, sourceName) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      setStatus(sourceName + ' is not valid JSON: ' + err.message, true);
      return;
    }
    let result;
    try {
      result = normaliseIdeas(data);
    } catch (err) {
      setStatus(sourceName + ': ' + err.message, true);
      return;
    }
    setGraph(buildGraph(result.ideas));
    const count = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
    const skippedNote = result.skipped === 0 ? ''
      : ' Skipped ' + result.skipped + ' invalid or duplicate ' + (result.skipped === 1 ? 'entry.' : 'entries.');
    if (result.ideas.length === 0) {
      setStatus('No valid ideas in ' + sourceName + '.' + skippedNote, true);
      return;
    }
    fileFallback.hidden = true;
    setStatus(count(result.ideas.length, 'idea') + ', ' + count(graph.edges.length, 'connection') + '.' + skippedNote, false);
  }

  async function load() {
    if (location.protocol === 'file:') {
      showFileFallback(FILE_PROTOCOL_MESSAGE);
      return;
    }
    let text;
    try {
      const res = await fetch('ideas.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      text = await res.text();
    } catch (err) {
      showFileFallback('Could not load ideas.json (' + err.message + '). You can choose the file below instead.');
      return;
    }
    loadText(text, 'ideas.json');
  }

  function wrapLabel(text) {
    ctx.font = theme.font;
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width <= LABEL_MAX_WIDTH || !line) {
        line = test;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    // Truncate over-long lines and too many lines with an ellipsis.
    const out = lines.slice(0, LABEL_MAX_LINES).map((l) => truncate(l));
    if (lines.length > LABEL_MAX_LINES) {
      out[LABEL_MAX_LINES - 1] = truncate(out[LABEL_MAX_LINES - 1] + '...', true);
    }
    return out;
  }

  function truncate(line, force) {
    if (!force && ctx.measureText(line).width <= LABEL_MAX_WIDTH) return line;
    let s = line.replace(/\.\.\.$/, '');
    while (s.length > 1 && ctx.measureText(s + '...').width > LABEL_MAX_WIDTH) s = s.slice(0, -1);
    return s + '...';
  }

  function prepareLabels() {
    for (const node of graph.nodes) node.lines = wrapLabel(node.idea.title);
  }

  function extentOf(node) {
    const lines = node.lines.length;
    return {
      left: Math.max(node.r, LABEL_MAX_WIDTH / 2),
      right: Math.max(node.r, LABEL_MAX_WIDTH / 2),
      top: node.r,
      bottom: node.r + 4 + lines * LABEL_LINE_PX
    };
  }

  function setGraph(g) {
    graph = g;
    hoverIndex = -1;
    selectedIndex = -1;
    if (dialog.open) dialog.close();
    prepareLabels();
    userMoved = false;
    fitNow();
    wake(SIM.maxIterations);
  }

  function wake(maxIterations) {
    simIterations = 0;
    simMax = maxIterations;
    if (!simRunning) {
      simRunning = true;
      requestAnimationFrame(frame);
    }
  }

  function frame() {
    if (!simRunning) return;
    let energy = Infinity;
    for (let s = 0; s < STEPS_PER_FRAME; s++) {
      energy = stepSimulation(graph, SIM);
      simIterations++;
    }
    const holding = drag !== null && drag.node !== null && drag.moved;
    const settled = simIterations >= SIM.minIterations && energy < SIM.energyStop;
    if (!holding && (settled || simIterations >= simMax)) {
      simRunning = false;
      if (!userMoved) fitNow();
      draw();
      return;
    }
    if (!userMoved) fitNow();
    draw();
    requestAnimationFrame(frame);
  }

  function fitNow() {
    view = fitView(graph.nodes, cssW, cssH, FIT_PADDING, MIN_SCALE, FIT_MAX_SCALE, extentOf);
  }

  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      draw();
    });
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.canvasBg;
    ctx.fillRect(0, 0, cssW, cssH);
    if (graph.nodes.length === 0) return;

    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.offsetX, dpr * view.offsetY);
    ctx.lineCap = 'round';

    const nodes = graph.nodes;
    const hovered = hoverIndex >= 0 ? nodes[hoverIndex] : null;
    const neighbours = new Set();
    if (hovered) {
      neighbours.add(hoverIndex);
      for (const ei of hovered.edges) {
        const e = graph.edges[ei];
        neighbours.add(e.a);
        neighbours.add(e.b);
      }
    }

    for (let ei = 0; ei < graph.edges.length; ei++) {
      const e = graph.edges[ei];
      const a = nodes[e.a];
      const b = nodes[e.b];
      const active = hovered && (e.a === hoverIndex || e.b === hoverIndex);
      ctx.globalAlpha = hovered && !active ? 0.1 : Math.min(0.2 + 0.22 * e.weight, 0.95);
      ctx.strokeStyle = active ? theme.accent : theme.edge;
      ctx.lineWidth = 1 + (e.weight - 1) * 1.6;
      ctx.setLineDash(e.shared.length === 0 ? [5, 4] : []);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const node of nodes) {
      const dim = hovered && !neighbours.has(node.index);
      ctx.globalAlpha = dim ? 0.35 : 1;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
      ctx.fillStyle = node.index === hoverIndex ? theme.nodeHover : theme.node;
      ctx.fill();
      ctx.lineWidth = node.index === selectedIndex ? 3 : 1.5;
      ctx.strokeStyle = node.index === selectedIndex ? theme.accent : theme.nodeBorder;
      ctx.stroke();
    }

    // Labels (with a halo so they stay readable over edges)
    ctx.font = theme.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    for (const node of nodes) {
      const dim = hovered && !neighbours.has(node.index);
      ctx.globalAlpha = dim ? 0.35 : 1;
      const y0 = node.y + node.r + 4;
      for (let li = 0; li < node.lines.length; li++) {
        ctx.strokeStyle = theme.canvasBg;
        ctx.strokeText(node.lines[li], node.x, y0 + li * LABEL_LINE_PX);
        ctx.fillStyle = theme.label;
        ctx.fillText(node.lines[li], node.x, y0 + li * LABEL_LINE_PX);
      }
    }
    ctx.globalAlpha = 1;
  }

  function resize() {
    const rect = stage.getBoundingClientRect();
    cssW = Math.max(Math.floor(rect.width), 1);
    cssH = Math.max(Math.floor(rect.height), 1);
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    if (!userMoved) fitNow();
    draw();
  }

  function toWorld(x, y) {
    return { x: (x - view.offsetX) / view.scale, y: (y - view.offsetY) / view.scale };
  }

  function zoomAt(px, py, factor) {
    const s = Math.min(Math.max(view.scale * factor, MIN_SCALE), MAX_SCALE);
    const wx = (px - view.offsetX) / view.scale;
    const wy = (py - view.offsetY) / view.scale;
    view.scale = s;
    view.offsetX = px - wx * s;
    view.offsetY = py - wy * s;
    userMoved = true;
  }

  function nodeAt(px, py, extra) {
    const w = toWorld(px, py);
    const pad = (extra || 0) / view.scale;
    for (let i = graph.nodes.length - 1; i >= 0; i--) {
      const n = graph.nodes[i];
      const dx = w.x - n.x;
      const dy = w.y - n.y;
      const rr = n.r + pad;
      if (dx * dx + dy * dy <= rr * rr) return i;
    }
    return -1;
  }

  function localPoint(ev) {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function pinchState() {
    const pts = Array.from(pointers.values());
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    return {
      dist: Math.max(Math.sqrt(dx * dx + dy * dy), 1),
      midX: (pts[0].x + pts[1].x) / 2,
      midY: (pts[0].y + pts[1].y) / 2
    };
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    const p = localPoint(ev);
    pointers.set(ev.pointerId, p);
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    if (pointers.size === 1) {
      const slop = ev.pointerType === 'mouse' ? 0 : 8;
      const hit = nodeAt(p.x, p.y, slop);
      drag = {
        startX: p.x,
        startY: p.y,
        lastX: p.x,
        lastY: p.y,
        node: hit >= 0 ? hit : null,
        moved: false,
        pointerId: ev.pointerId
      };
      canvas.classList.add('panning');
    } else if (pointers.size === 2) {
      // Second finger: cancel any click or node drag, switch to pinch.
      endDrag(false);
      pinch = pinchState();
    }
    // Focus for the keyboard shortcuts, without showing the keyboard focus ring.
    canvas.focus({ preventScroll: true, focusVisible: false });
  });

  canvas.addEventListener('pointermove', (ev) => {
    const p = localPoint(ev);
    if (!pointers.has(ev.pointerId)) {
      // Hover only for a mouse with no button held.
      if (ev.pointerType === 'mouse') updateHover(p.x, p.y);
      return;
    }
    pointers.set(ev.pointerId, p);

    if (pointers.size >= 2 && pinch) {
      const next = pinchState();
      const factor = next.dist / pinch.dist;
      // Zoom around the previous midpoint, then shift by midpoint movement.
      zoomAt(pinch.midX, pinch.midY, factor);
      view.offsetX += next.midX - pinch.midX;
      view.offsetY += next.midY - pinch.midY;
      pinch = next;
      requestDraw();
      return;
    }

    if (!drag || drag.pointerId !== ev.pointerId) return;
    if (!drag.moved) {
      const dx = p.x - drag.startX;
      const dy = p.y - drag.startY;
      if (dx * dx + dy * dy < CLICK_SLOP * CLICK_SLOP) return;
      drag.moved = true;
      if (drag.node !== null) {
        userMoved = true;
        graph.nodes[drag.node].pinned = true;
        wake(600);
      }
    }
    if (drag.node !== null) {
      const w = toWorld(p.x, p.y);
      const n = graph.nodes[drag.node];
      n.x = w.x;
      n.y = w.y;
      n.vx = 0;
      n.vy = 0;
    } else {
      view.offsetX += p.x - drag.lastX;
      view.offsetY += p.y - drag.lastY;
      userMoved = true;
    }
    drag.lastX = p.x;
    drag.lastY = p.y;
    requestDraw();
  });

  function endDrag(allowClick) {
    if (!drag) return;
    const { node, moved } = drag;
    drag = null;
    if (node === null) return;
    if (moved) wake(300);
    else if (allowClick) openIdea(node);
  }

  function endPointer(ev, cancelled) {
    if (!pointers.has(ev.pointerId)) return;
    const p = localPoint(ev);
    pointers.delete(ev.pointerId);
    try { canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }

    if (pointers.size < 2) pinch = null;
    if (drag && drag.pointerId === ev.pointerId) endDrag(!cancelled);
    if (pointers.size === 0) {
      canvas.classList.remove('panning');
      drag = null;
      if (!cancelled && ev.pointerType === 'mouse') updateHover(p.x, p.y);
      else setHover(-1);
    } else if (pointers.size === 1) {
      // One finger left after a pinch: continue as a pan from its current spot.
      const [id, pt] = Array.from(pointers.entries())[0];
      drag = { startX: pt.x, startY: pt.y, lastX: pt.x, lastY: pt.y, node: null, moved: true, pointerId: id };
    }
  }

  canvas.addEventListener('pointerup', (ev) => endPointer(ev, false));
  canvas.addEventListener('pointercancel', (ev) => endPointer(ev, true));

  canvas.addEventListener('pointerleave', (ev) => {
    if (ev.pointerType === 'mouse' && !pointers.has(ev.pointerId)) setHover(-1);
  });

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const p = localPoint(ev);
    let dy = ev.deltaY;
    if (ev.deltaMode === 1) dy *= 16;
    else if (ev.deltaMode === 2) dy *= 400;
    const k = ev.ctrlKey ? 0.01 : 0.0015;   // ctrlKey is set for trackpad pinch
    zoomAt(p.x, p.y, Math.exp(-dy * k));
    requestDraw();
  }, { passive: false });

  function setHover(i) {
    if (i === hoverIndex) return;
    hoverIndex = i;
    canvas.classList.toggle('over-node', i >= 0);
    requestDraw();
  }

  function updateHover(x, y) {
    setHover(nodeAt(x, y, 0));
  }

  canvas.addEventListener('keydown', (ev) => {
    const step = 40;
    let handled = true;
    switch (ev.key) {
      case '+': case '=': zoomAt(cssW / 2, cssH / 2, 1.2); break;
      case '-': case '_': zoomAt(cssW / 2, cssH / 2, 1 / 1.2); break;
      case '0': userMoved = false; fitNow(); break;
      case 'ArrowLeft': view.offsetX += step; userMoved = true; break;
      case 'ArrowRight': view.offsetX -= step; userMoved = true; break;
      case 'ArrowUp': view.offsetY += step; userMoved = true; break;
      case 'ArrowDown': view.offsetY -= step; userMoved = true; break;
      default: handled = false;
    }
    if (handled) {
      ev.preventDefault();
      requestDraw();
    }
  });

  fitBtn.addEventListener('click', () => {
    userMoved = false;
    fitNow();
    draw();
  });

  function openIdea(index) {
    const node = graph.nodes[index];
    if (!node) return;
    selectedIndex = index;
    const idea = node.idea;

    titleEl.textContent = idea.title;
    descEl.textContent = idea.description;
    descEl.hidden = !idea.description;

    tagsEl.textContent = '';
    for (const tag of idea.tags) {
      const li = document.createElement('li');
      li.textContent = tag;
      tagsEl.appendChild(li);
    }
    if (idea.tags.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'no tags';
      tagsEl.appendChild(li);
    }

    relatedEl.textContent = '';
    const related = relatedIdeas(graph, index);
    noRelatedEl.hidden = related.length > 0;
    for (const r of related) {
      const other = graph.nodes[r.index].idea;
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'related-btn';
      const title = document.createElement('span');
      title.className = 'related-title';
      title.textContent = other.title;
      const meta = document.createElement('span');
      meta.className = 'related-meta';
      const parts = [];
      if (r.shared.length > 0) parts.push(r.shared.join(', '));
      if (r.linked) parts.push('linked');
      meta.textContent = parts.join(' + ');
      btn.appendChild(title);
      btn.appendChild(meta);
      btn.addEventListener('click', () => openIdea(r.index));
      li.appendChild(btn);
      relatedEl.appendChild(li);
    }

    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    titleEl.focus({ preventScroll: true });
    requestDraw();
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener('close', () => {
    selectedIndex = -1;
    requestDraw();
    canvas.focus({ preventScroll: true });
  });

  dialogClose.addEventListener('click', closeDialog);

  // Backdrop click: the dialog element itself is the target (content sits in .dialog-inner).
  let downOnBackdrop = false;
  dialog.addEventListener('pointerdown', (ev) => { downOnBackdrop = ev.target === dialog; });
  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog && downOnBackdrop) closeDialog();
    downOnBackdrop = false;
  });

  fileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      loadText(text, file.name);
    } catch (err) {
      setStatus('Could not read ' + file.name + ': ' + err.message, true);
    }
    fileInput.value = '';
  });

  readTheme();
  resize();
  new ResizeObserver(resize).observe(stage);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    readTheme();
    requestDraw();
  });
  load();
}

if (typeof document !== 'undefined') initApp();
