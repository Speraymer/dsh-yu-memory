// <define:import.meta.env>
var define_import_meta_env_default = {};

// ../cli/src/lib.ts
import { promises as fsp, createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import os from "node:os";
import * as zlib from "node:zlib";
import { createHash } from "node:crypto";

// ../src/utils.ts
var idCounter = 0;
function generateId() {
  return `node-${Date.now()}-${idCounter++}`;
}

// ../src/lib/graph.ts
function getDescendantIds(nodeId, edges) {
  const descendants = [];
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift();
    const children = edges.filter((e) => e.source === current && !e.data?.isCrossLink).map((e) => e.target);
    descendants.push(...children);
    queue.push(...children);
  }
  return descendants;
}

// ../src/lib/constants.ts
var API_BASE = define_import_meta_env_default.VITE_API_BASE ?? (define_import_meta_env_default.DEV ? "http://localhost:3001" : "");
var LAYOUT_COL_WIDTH = 540;
var LAYOUT_H_GAP = 64;
var LAYOUT_V_GAP = 96;
var COLLAPSED_LAYOUT_HEIGHT = 240;

// ../src/lib/layout.ts
function estimateNodeHeight(node) {
  if (node.data.isCollapsed) return COLLAPSED_LAYOUT_HEIGHT;
  const questionH = Math.min(180, 40 + (node.data.question || "").length / 1.2);
  const responseH = Math.min(400, (node.data.response || "").length / 1.05);
  const highlightsH = (node.data.highlights?.length ?? 0) * 26;
  const insightH = (node.data.attachments?.length ?? 0) > 0 ? 30 : 0;
  const estimated = 215 + questionH + responseH + highlightsH + insightH;
  return Math.max(260, Math.min(930, estimated));
}
function nodeHeight(node) {
  return Math.max(node.measured?.height ?? 0, estimateNodeHeight(node));
}
function autoLayout(allNodes, allEdges) {
  if (allNodes.length === 0) return allNodes;
  const contentIds = new Set(
    allNodes.filter((n) => ["note", "file", "link", "frame"].includes(n.data.stepKind ?? "")).map((n) => n.id)
  );
  const nodes = allNodes.filter((n) => !contentIds.has(n.id));
  const edges = allEdges.filter((e) => !contentIds.has(e.source) && !contentIds.has(e.target));
  const NODE_WIDTH = LAYOUT_COL_WIDTH;
  const H_GAP = LAYOUT_H_GAP;
  const V_GAP = LAYOUT_V_GAP;
  const V_PAD = 24;
  const structuralEdges = edges.filter((e) => !e.data?.isCrossLink);
  const hasStructuralParent = new Set(structuralEdges.map((e) => e.target));
  for (const e of edges) {
    if (e.data?.isCrossLink && !e.data?.isWatch && !hasStructuralParent.has(e.target)) {
      structuralEdges.push(e);
      hasStructuralParent.add(e.target);
    }
  }
  const targetIds = new Set(structuralEdges.map((e) => e.target));
  const roots = nodes.filter((n) => !targetIds.has(n.id));
  const structuralParents = /* @__PURE__ */ new Map();
  for (const e of structuralEdges) {
    const list = structuralParents.get(e.target) || [];
    list.push(e.source);
    structuralParents.set(e.target, list);
  }
  const materialAnchors = /* @__PURE__ */ new Map();
  const perMaterialCount = /* @__PURE__ */ new Map();
  for (const root of roots) {
    const mats = allEdges.filter((e) => e.target === root.id && !e.data?.isCrossLink && contentIds.has(e.source)).map((e) => allNodes.find((n) => n.id === e.source)).filter((m) => !!m);
    if (mats.length === 0) continue;
    const lowest = mats.reduce((a, b) => a.position.y + nodeHeight(a) > b.position.y + nodeHeight(b) ? a : b);
    const k = perMaterialCount.get(lowest.id) ?? 0;
    perMaterialCount.set(lowest.id, k + 1);
    materialAnchors.set(root.id, {
      x: lowest.position.x - 60 + k * (LAYOUT_COL_WIDTH + LAYOUT_H_GAP),
      y: lowest.position.y + nodeHeight(lowest) + LAYOUT_V_GAP
    });
  }
  const childrenMap = /* @__PURE__ */ new Map();
  for (const edge of structuralEdges) {
    const list = childrenMap.get(edge.source) || [];
    list.push(edge.target);
    childrenMap.set(edge.source, list);
  }
  const edgeKey = (parent, child) => `${parent}\0${child}`;
  const exploreEdges = new Set(
    edges.filter((e) => e.data?.isBranchFromSelection).map((e) => edgeKey(e.source, e.target))
  );
  function classifyChildren(parentId, claimant2) {
    const children = (childrenMap.get(parentId) || []).filter(
      (c) => (claimant2.get(c) ?? parentId) === parentId
    );
    const nonExplore = children.filter((c) => !exploreEdges.has(edgeKey(parentId, c)));
    const explores = children.filter((c) => exploreEdges.has(edgeKey(parentId, c)));
    return {
      continuation: nonExplore[0] ?? null,
      regenerates: nonExplore.slice(1),
      explores
    };
  }
  const VIRT_BASE = 1e5;
  function assignAllColumns(claimant2) {
    const nodeColumn2 = /* @__PURE__ */ new Map();
    let nextColumn = 0;
    let nextVirt = VIRT_BASE;
    const colXOverride = /* @__PURE__ */ new Map();
    const colX2 = (col) => colXOverride.get(col) ?? col * (NODE_WIDTH + H_GAP);
    function assignColumns(nodeId, col) {
      if (nodeColumn2.has(nodeId)) return;
      nodeColumn2.set(nodeId, col);
      const { continuation, regenerates, explores } = classifyChildren(nodeId, claimant2);
      if (continuation) assignColumns(continuation, col);
      for (let i = 0; i < regenerates.length; i++) {
        let regenCol;
        if (col >= VIRT_BASE) {
          regenCol = nextVirt++;
          colXOverride.set(regenCol, colX2(col) + (i + 1) * (NODE_WIDTH + H_GAP));
        } else {
          regenCol = col + 1 + i;
          nextColumn = Math.max(nextColumn, regenCol + 1);
        }
        assignColumns(regenerates[i], regenCol);
      }
      let exploreOffset = 0;
      for (const ec of explores) {
        let exploreCol;
        if (col >= VIRT_BASE) {
          exploreCol = nextVirt++;
          colXOverride.set(exploreCol, colX2(col) + (regenerates.length + 1 + exploreOffset) * (NODE_WIDTH + H_GAP));
          exploreOffset++;
        } else {
          exploreCol = nextColumn;
          nextColumn++;
        }
        assignColumns(ec, exploreCol);
      }
    }
    for (const root of roots) {
      const anchor = materialAnchors.get(root.id);
      if (anchor) {
        const virtCol = nextVirt++;
        colXOverride.set(virtCol, anchor.x);
        assignColumns(root.id, virtCol);
      } else {
        const rootCol = nextColumn;
        nextColumn++;
        assignColumns(root.id, rootCol);
      }
    }
    for (let guard = 0; guard < nodes.length; guard++) {
      let progressed = false;
      for (const node of nodes) {
        if (nodeColumn2.has(node.id)) continue;
        const cols = (structuralParents.get(node.id) || []).map((p) => nodeColumn2.get(p)).filter((c) => c !== void 0).sort((a, b) => a - b);
        if (!cols.length) continue;
        assignColumns(node.id, cols[Math.floor((cols.length - 1) / 2)]);
        progressed = true;
      }
      if (!progressed) break;
    }
    return { nodeColumn: nodeColumn2, colX: colX2 };
  }
  const claimant = /* @__PURE__ */ new Map();
  for (const [child, ps] of structuralParents) {
    if (ps.length < 2) continue;
    const continued = ps.filter((p) => !exploreEdges.has(edgeKey(p, child)));
    const pool = continued.length ? continued : ps;
    claimant.set(child, pool[0]);
  }
  const { nodeColumn, colX } = assignAllColumns(claimant);
  const nodeHeightMap = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    nodeHeightMap.set(node.id, nodeHeight(node));
  }
  const positioned = /* @__PURE__ */ new Map();
  const visited = /* @__PURE__ */ new Set();
  const queue = [...roots.map((r) => r.id)];
  for (const rootId of queue) {
    const col = nodeColumn.get(rootId) ?? 0;
    const anchor = materialAnchors.get(rootId);
    positioned.set(rootId, { x: colX(col), y: anchor?.y ?? 0 });
    visited.add(rootId);
  }
  while (queue.length > 0) {
    const current = queue.shift();
    const parentPos = positioned.get(current);
    const parentHeight = nodeHeightMap.get(current) || 220;
    const { continuation, regenerates, explores } = classifyChildren(current, claimant);
    if (continuation && !visited.has(continuation)) {
      visited.add(continuation);
      const col = nodeColumn.get(continuation) ?? 0;
      positioned.set(continuation, {
        x: colX(col),
        y: parentPos.y + parentHeight + V_GAP
      });
      queue.push(continuation);
    }
    const continuationY = parentPos.y + parentHeight + V_GAP;
    for (const rc of regenerates) {
      if (visited.has(rc)) continue;
      visited.add(rc);
      const col = nodeColumn.get(rc) ?? 0;
      positioned.set(rc, {
        x: colX(col),
        y: continuationY
      });
      queue.push(rc);
    }
    for (const ec of explores) {
      if (visited.has(ec)) continue;
      visited.add(ec);
      const col = nodeColumn.get(ec) ?? 0;
      positioned.set(ec, {
        x: colX(col),
        y: parentPos.y + parentHeight * 0.25
      });
      queue.push(ec);
    }
  }
  for (let guard = 0; guard < nodes.length; guard++) {
    let progressed = false;
    for (const node of nodes) {
      if (positioned.has(node.id)) continue;
      const ps = (structuralParents.get(node.id) || []).filter((p) => positioned.has(p));
      if (!ps.length) continue;
      const bottom = Math.max(
        ...ps.map((p) => positioned.get(p).y + (nodeHeightMap.get(p) || 220))
      );
      positioned.set(node.id, { x: colX(nodeColumn.get(node.id) ?? 0), y: bottom + V_GAP });
      progressed = true;
    }
    if (!progressed) break;
  }
  for (const node of nodes) {
    if (!positioned.has(node.id)) {
      positioned.set(node.id, { x: 0, y: 0 });
    }
  }
  for (let pass = 0; pass < 5; pass++) {
    let moved = false;
    for (const node of nodes) {
      const pos = positioned.get(node.id);
      if (!pos) continue;
      const all = (structuralParents.get(node.id) || []).filter((p) => positioned.has(p));
      if (all.length < 2) continue;
      const continued = all.filter((p) => !exploreEdges.has(`${p}\0${node.id}`));
      const explored = all.filter((p) => exploreEdges.has(`${p}\0${node.id}`));
      let floor = -Infinity;
      for (const p of continued) {
        floor = Math.max(floor, positioned.get(p).y + (nodeHeightMap.get(p) || 220) + V_GAP);
      }
      for (const p of explored) {
        floor = Math.max(floor, positioned.get(p).y);
      }
      if (floor > -Infinity && pos.y < floor) {
        const delta = floor - pos.y;
        pos.y = floor;
        for (const dId of new Set(getDescendantIds(node.id, structuralEdges))) {
          const dPos = positioned.get(dId);
          if (dPos) dPos.y += delta;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  const columnNodes = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    const col = nodeColumn.get(node.id) ?? 0;
    const list = columnNodes.get(col) || [];
    list.push(node.id);
    columnNodes.set(col, list);
  }
  for (let pass = 0; pass < 5; pass++) {
    let moved = false;
    for (const [, colNodeIds] of columnNodes) {
      colNodeIds.sort((a, b) => positioned.get(a).y - positioned.get(b).y);
      for (let i = 1; i < colNodeIds.length; i++) {
        const prevId = colNodeIds[i - 1];
        const currId = colNodeIds[i];
        const prevPos = positioned.get(prevId);
        const currPos = positioned.get(currId);
        const prevHeight = nodeHeightMap.get(prevId) || 220;
        const minY = prevPos.y + prevHeight + V_PAD;
        if (currPos.y < minY) {
          const delta = minY - currPos.y;
          currPos.y = minY;
          moved = true;
          for (const dId of new Set(getDescendantIds(currId, structuralEdges))) {
            const dPos = positioned.get(dId);
            if (dPos) dPos.y += delta;
          }
        }
      }
    }
    if (!moved) break;
  }
  const FOLD_HEIGHT = 8e3;
  const FOLD_COL_GAP = 180;
  const importerNotes = allNodes.filter((n) => n.data.stepKind === "note" && n.data.importSource);
  const noteTargets = new Set(
    allEdges.filter((e) => importerNotes.some((n) => n.id === e.source)).map((e) => e.target)
  );
  for (const root of roots) {
    const chain = [];
    let cur = root.id;
    let pure = true;
    while (cur) {
      chain.push(cur);
      const kids = childrenMap.get(cur) || [];
      if (kids.length > 1) {
        pure = false;
        break;
      }
      cur = kids[0];
    }
    if (!pure || chain.length < 8) continue;
    const chainSet = new Set(chain);
    const first = positioned.get(chain[0]);
    const lastId = chain[chain.length - 1];
    const totalH = positioned.get(lastId).y + (nodeHeightMap.get(lastId) || 220) - first.y;
    if (totalH <= FOLD_HEIGHT) continue;
    const rightOccupied = nodes.some((n) => !chainSet.has(n.id) && positioned.get(n.id).x > first.x + NODE_WIDTH / 2);
    if (rightOccupied) continue;
    let foldCol = 0;
    let y = first.y;
    for (const id of chain) {
      const h = nodeHeightMap.get(id) || 220;
      const used = y - first.y;
      const mustFold = used + h > FOLD_HEIGHT;
      const chapterFold = noteTargets.has(id) && used > FOLD_HEIGHT * 0.6;
      if ((mustFold || chapterFold) && y !== first.y) {
        foldCol++;
        y = first.y;
      }
      const p = positioned.get(id);
      p.x = first.x + foldCol * (NODE_WIDTH + FOLD_COL_GAP);
      p.y = y;
      y += h + V_GAP;
    }
  }
  const solidRects = nodes.map((n) => {
    const p = positioned.get(n.id);
    return { x: p.x, y: p.y, w: NODE_WIDTH, h: nodeHeightMap.get(n.id) || 220 };
  });
  const NOTE_W = 460;
  const NOTE_H = 130;
  const collides = (x, y) => solidRects.some((r) => x < r.x + r.w && x + NOTE_W > r.x && y < r.y + r.h && y + NOTE_H > r.y);
  const colTopStacks = /* @__PURE__ */ new Map();
  for (const note of importerNotes) {
    const targetId = allEdges.find((e) => e.source === note.id)?.target;
    const tp = targetId ? positioned.get(targetId) : void 0;
    if (!tp) continue;
    let x = tp.x - 520;
    let y = tp.y;
    if (collides(x, y)) {
      x = tp.x;
      y = tp.y - NOTE_H - 40;
    }
    if (collides(x, y)) {
      const colKey = Math.round(tp.x);
      const colMinY = Math.min(...nodes.filter((n) => Math.round(positioned.get(n.id).x) === colKey).map((n) => positioned.get(n.id).y));
      const k = colTopStacks.get(colKey) ?? 0;
      colTopStacks.set(colKey, k + 1);
      x = tp.x;
      y = colMinY - NOTE_H - 40 - k * (NOTE_H + 30);
    }
    positioned.set(note.id, { x, y });
  }
  return allNodes.map((node) => {
    const pos = positioned.get(node.id);
    return pos ? { ...node, position: pos } : node;
  });
}

// ../src/lib/import-chat.ts
function makeNode(question, response, isRoot) {
  return {
    id: generateId(),
    type: "thought",
    position: { x: 0, y: 0 },
    dragHandle: ".drag-handle",
    data: {
      question,
      response,
      responses: [response],
      responseIndex: 0,
      isCollapsed: true,
      isEditing: false,
      isEditingResponse: false,
      isLoading: false,
      tokenCount: Math.ceil((question + response).length / 4),
      highlights: [],
      highlightMode: "tag",
      attachments: [],
      excludedAttachmentIds: [],
      includedAttachmentIds: [],
      roleMode: "inherit",
      isRoot,
      isBranch: false
    }
  };
}

// ../src/lib/turn-insight.ts
function conclusionOf(response, max = 140) {
  const paras = response.replace(/```[\s\S]*?```/g, "").split(/\n\s*\n/).map((p) => p.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#*`>|_~]/g, "").replace(/^\s*[-•\d.)]+\s*/gm, "").replace(/\s+/g, " ").trim()).filter((p) => p.length > 12 && !/[:：]$/.test(p) && !/^(sources?|references?|来源|参考)\b/i.test(p));
  const substantive = paras.filter((p) => p.length >= 30);
  const last = substantive[substantive.length - 1] ?? paras[paras.length - 1] ?? response.replace(/[#*`>-]/g, "").replace(/\s+/g, " ").trim();
  return last.length > max ? `${last.slice(0, max)}\u2026` : last;
}

// ../src/lib/adapters/shared.ts
var TOOL_OPS = [
  [/^(Read|NotebookRead|read_file|view_image)$/i, "read"],
  [/^(Write|write_file)$/i, "write"],
  [/^(Edit|MultiEdit|NotebookEdit|apply_patch)$/i, "edit"],
  [/^(Bash|BashOutput|Shell|exec_command|local_shell|write_stdin)$/i, "run"],
  [/^(Grep|Glob|LS|Search|WebSearch|web_search)$/i, "search"],
  [/^(WebFetch|Fetch)$/i, "fetch"],
  [/^(Task|Agent)$/i, "agent"]
];
function toolOpOf(name) {
  return TOOL_OPS.find(([re]) => re.test(name))?.[1] ?? "other";
}
var TOOL_CALL_LIMIT = 800;
var ARTIFACT_CALL_LIMIT = 32e3;
var TOOL_RESULT_LIMIT = 4e3;
var clipText = (s, limit) => s.length > limit ? { text: `${s.slice(0, limit)}
\u2026[truncated, ${s.length} chars total]`, truncated: true } : { text: s, truncated: false };
var SELF_MARKS = ["<command-name>/memory-graph</command-name>", "[[memory-graph:command]]"];
function dropSelfCommandTurns(turns) {
  return turns.filter((t) => !SELF_MARKS.some((m) => t.question.includes(m)));
}
function markImporterNote(note) {
  note.width = 460;
}
function seedPlaque(node) {
  const line = conclusionOf(node.data.response, 90);
  if (line) node.data.summaries = [line];
}
function toolAttachments(turn) {
  return turn.tools.map((tool) => ({
    id: generateId(),
    name: `tool: ${tool.name}${tool.truncated ? " (truncated)" : ""}`,
    type: "text/plain",
    size: tool.call.length + tool.result.length,
    content: `[call] ${tool.call}
[result]
${tool.result}`,
    ...tool.paths?.length ? { paths: tool.paths } : {},
    ...tool.op ? { op: tool.op } : {}
  }));
}
function adoptSubagentSessions(turns, subs) {
  const used = /* @__PURE__ */ new Set();
  const settle = (run, sub) => {
    used.add(sub);
    const tools = sub.turns.flatMap((t) => t.tools);
    if (tools.length) run.tools = tools;
    if (!run.output.trim()) run.output = sub.turns.map((t) => t.response).filter((r) => r.trim()).at(-1) ?? "";
    if (!run.itemIds.includes(sub.sessionId)) run.itemIds.push(sub.sessionId);
    if (!run.at && sub.at) run.at = sub.at;
  };
  for (const turn of turns) for (const run of turn.subagents ?? []) {
    const key = run.match?.trim();
    if (!key) continue;
    const sub = subs.find((x) => !used.has(x) && x.firstQuestion.trim() === key);
    if (sub) settle(run, sub);
  }
  for (const sub of subs) {
    if (used.has(sub) || !sub.at) continue;
    const before = turns.filter((t) => t.at && t.at <= sub.at);
    const turn = before.at(-1) ?? turns.at(-1);
    if (!turn) continue;
    const run = { agent: sub.runner, task: sub.firstQuestion, output: "", itemIds: [sub.sessionId], at: sub.at };
    settle(run, sub);
    (turn.subagents ??= []).push(run);
  }
}
function attachSubagentBranches(parent, turn, nodes, edges, runner, sessionId, cwd) {
  const kids = [];
  for (const run of turn.subagents ?? []) {
    const node = makeNode(`[${run.agent}] ${run.task}`.trim(), run.output, false);
    node.data.isBranch = true;
    node.data.importSource = { runner, sessionId, itemIds: run.itemIds, ...cwd ? { cwd } : {}, subagent: { agent: run.agent, of: turn.itemIds[0] ?? "" } };
    node.data.source = { question: node.data.question, response: node.data.response };
    if (run.tools?.length) node.data.attachments = toolAttachments({ question: run.task, response: run.output, itemIds: run.itemIds, tools: run.tools });
    seedPlaque(node);
    nodes.push(node);
    kids.push(node);
    edges.push({ id: generateId(), source: parent.id, target: node.id, type: "smoothstep", data: { isBranchFromSelection: true, branchYRatio: 0.5 } });
  }
  return kids;
}
function toolScope(input) {
  const i = input ?? {};
  const out = {};
  if (typeof i.url === "string" && /^https?:\/\//.test(i.url)) out.url = i.url;
  const loc = {};
  if (typeof i.pages === "string" && i.pages.trim()) loc.pages = i.pages.trim();
  if (typeof i.offset === "number" || typeof i.limit === "number") {
    const start = Math.max(1, typeof i.offset === "number" ? i.offset : 1);
    const end = typeof i.limit === "number" ? start + Math.max(0, i.limit) - 1 : start;
    loc.lines = [start, Math.max(start, end)];
  }
  if (Object.keys(loc).length) out.locator = loc;
  return out;
}
function toolPaths(input) {
  const i = input ?? {};
  const p = i.file_path ?? i.notebook_path;
  return typeof p === "string" && p ? [p] : [];
}
function renderCall(name, input) {
  const i = input ?? {};
  const op = toolOpOf(name);
  if (op === "write" && typeof i.content === "string") return `${i.file_path ?? ""}

${i.content}`;
  if (op === "edit" && typeof i.new_string === "string") {
    return `${i.file_path ?? i.notebook_path ?? ""}${i.replace_all ? " (replace all)" : ""}
--- old
${i.old_string ?? ""}
+++ new
${i.new_string}`;
  }
  return JSON.stringify(input ?? {});
}

// ../src/lib/adapters/claude-code-session.ts
var NOTIFICATION_LIMIT = 16e3;
function textParts(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((p) => p.type === "text" && p.text).map((p) => p.text).join("\n");
}
function resultText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((p) => p.type === "text" && p.text ? p.text : p.type === "image" ? "[image result omitted]" : "").filter(Boolean).join("\n");
}
var clip = clipText;
var ClaudeSessionCollector = class {
  turns = [];
  // tool_use id → registration, so results pair up even across lines
  pendingTools = /* @__PURE__ */ new Map();
  current = null;
  pendingCompaction;
  sessionId = null;
  customTitle = null;
  summary = null;
  slug = null;
  firstQuestion = null;
  cwd = null;
  // decided by the first message line: what kind of file this is
  mode = null;
  feedLine(raw) {
    const t = raw.trim();
    if (!t) return;
    let line;
    try {
      line = JSON.parse(t);
    } catch {
      return;
    }
    this.feed(line);
  }
  flush() {
    const c = this.current;
    if (c && (c.question || c.response || c.tools.length)) this.turns.push(c);
    this.current = null;
  }
  feed(line) {
    if (line.type === "custom-title" && line.customTitle) this.customTitle = line.customTitle;
    if (line.type === "summary" && line.summary && !this.summary) this.summary = line.summary;
    if (line.slug && !this.slug) this.slug = line.slug;
    if (line.cwd && !this.cwd) this.cwd = line.cwd;
    if (this.mode === null && (line.type === "user" || line.type === "assistant") && line.uuid) {
      this.mode = line.isSidechain && line.agentId ? "sidechain" : "main";
      if (this.mode === "sidechain") this.sessionId = line.agentId;
    }
    if (!!line.isSidechain !== (this.mode === "sidechain")) return;
    if (line.type === "system" && line.subtype === "compact_boundary") {
      this.flush();
      const m = line.compactMetadata;
      this.pendingCompaction = `[Compaction] The source runner compacted its history here${m?.preTokens ? ` (${m.preTokens} \u2192 ${m.postTokens ?? "?"} tokens)` : ""}. Everything above this point reached later turns only as a summary.`;
      return;
    }
    if ((line.type === "user" || line.type === "assistant") && line.uuid && line.sessionId && !this.sessionId) {
      this.sessionId = line.sessionId;
    }
    if (line.type === "user") {
      const content = line.message?.content;
      if (Array.isArray(content)) {
        for (const p of content) {
          if (p.type === "tool_result" && p.tool_use_id) {
            const reg = this.pendingTools.get(p.tool_use_id);
            if (reg && this.current) {
              const res = clip(resultText(p.content), TOOL_RESULT_LIMIT);
              this.current.tools.push({
                name: reg.name,
                call: reg.call,
                result: res.text,
                truncated: res.truncated,
                ...reg.paths.length ? { paths: reg.paths } : {},
                op: reg.op,
                nativeCallId: p.tool_use_id,
                ...reg.url ? { url: reg.url } : {},
                ...reg.locator ? { locator: reg.locator } : {}
              });
              if (reg.spawn) {
                const report = clip(resultText(p.content), ARTIFACT_CALL_LIMIT);
                (this.current.subagents ??= []).push({ agent: reg.spawn.agent, task: reg.spawn.task, output: report.text, itemIds: [p.tool_use_id], match: reg.spawn.prompt, ...line.timestamp ? { at: line.timestamp } : {} });
              }
              this.pendingTools.delete(p.tool_use_id);
            }
          }
        }
      }
      const text = textParts(content);
      if (!text.trim()) return;
      if (/^\s*<task-notification>/.test(text)) {
        if (this.current) {
          const res = clip(text, NOTIFICATION_LIMIT);
          this.current.tools.push({ name: "Agent", call: "(task notification)", result: res.text, truncated: res.truncated, op: "agent" });
        }
        return;
      }
      {
        this.flush();
        if (!this.firstQuestion) this.firstQuestion = text.trim();
        this.current = {
          question: text,
          response: "",
          itemIds: line.uuid ? [line.uuid] : [],
          tools: [],
          parentItemId: line.parentUuid ?? void 0,
          ...line.timestamp ? { at: line.timestamp } : {}
        };
        if (this.pendingCompaction) {
          this.current.compactionBefore = this.pendingCompaction;
          this.pendingCompaction = void 0;
        }
      }
      return;
    }
    if (line.type === "assistant" && this.current) {
      if (line.uuid) this.current.itemIds.push(line.uuid);
      const content = line.message?.content;
      const text = textParts(content);
      if (text.trim()) this.current.response = this.current.response ? `${this.current.response}

${text}` : text;
      if (Array.isArray(content)) {
        for (const p of content) {
          if (p.type === "tool_use" && p.id && p.name) {
            const op = toolOpOf(p.name);
            const call = clip(renderCall(p.name, p.input), op === "write" || op === "edit" ? ARTIFACT_CALL_LIMIT : TOOL_CALL_LIMIT);
            const inp = p.input && typeof p.input === "object" ? p.input : {};
            const spawn = op === "agent" ? { agent: String(inp.subagent_type ?? "agent"), task: String(inp.description ?? inp.prompt?.split("\n")[0] ?? ""), prompt: String(inp.prompt ?? "") } : void 0;
            this.pendingTools.set(p.id, { name: p.name, call: call.text, paths: toolPaths(p.input), op, ...toolScope(p.input), ...spawn ? { spawn } : {} });
          }
        }
      }
    }
  }
  finish() {
    this.flush();
    if (!this.sessionId) return null;
    const asked = this.firstQuestion?.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("<"))?.slice(0, 80) ?? null;
    const title = this.customTitle ?? this.summary ?? asked ?? this.slug ?? `session ${this.sessionId.slice(0, 8)}`;
    return { sessionId: this.sessionId, title, turns: dropSelfCommandTurns(this.turns), ...this.cwd ? { cwd: this.cwd } : {} };
  }
  toConversation() {
    const s = this.finish();
    if (!s || s.turns.length === 0) return null;
    return {
      title: s.title,
      messageCount: s.turns.length,
      source: "claude-code",
      sessionId: s.sessionId,
      build: () => buildGraphFromTurns(s.turns, s.sessionId, s.cwd),
      adopt: (subs) => adoptSubagentSessions(s.turns, subs)
    };
  }
  /** This file as a subagent's transcript (a sidechain file), for its parent to adopt. */
  toSubagentSession() {
    const s = this.finish();
    if (!s || s.turns.length === 0 || this.mode !== "sidechain") return null;
    const first = s.turns[0];
    return { runner: "claude-code", sessionId: s.sessionId, firstQuestion: this.firstQuestion ?? first.question, turns: s.turns, ...s.cwd ? { cwd: s.cwd } : {}, ...first.at ? { at: first.at } : {} };
  }
};
function noteNode(text) {
  const n = makeNode(text, "", false);
  n.data.stepKind = "note";
  markImporterNote(n);
  return n;
}
function buildGraphFromTurns(turns, sessionId, cwd) {
  const origin = cwd ? { cwd } : {};
  const nodes = [];
  const edges = [];
  let prev = null;
  const byItem = /* @__PURE__ */ new Map();
  const link = (source, target) => {
    edges.push({ id: generateId(), source: source.id, target: target.id, type: "smoothstep" });
  };
  for (const turn of turns) {
    let noteToWire = null;
    if (turn.compactionBefore) {
      const note = noteNode(turn.compactionBefore);
      note.data.importSource = { runner: "claude-code", sessionId, itemIds: [], ...origin };
      nodes.push(note);
      noteToWire = note;
    }
    const node = makeNode(turn.question, turn.response, prev === null);
    node.data.importSource = { runner: "claude-code", sessionId, itemIds: turn.itemIds, ...origin };
    node.data.source = { question: node.data.question, response: node.data.response };
    seedPlaque(node);
    node.data.attachments = toolAttachments(turn);
    nodes.push(node);
    attachSubagentBranches(node, turn, nodes, edges, "claude-code", sessionId, cwd);
    const parent = turn.parentItemId ? byItem.get(turn.parentItemId) : void 0;
    if (parent) link(parent, node);
    else if (prev) link(prev, node);
    if (noteToWire) link(noteToWire, node);
    for (const id of turn.itemIds) byItem.set(id, node);
    prev = node;
  }
  return { nodes: autoLayout(nodes, edges), edges };
}

// ../src/lib/adapters/codex-session.ts
function patchPaths(patch) {
  const out = [];
  for (const m of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) out.push(m[1].trim());
  return out;
}
var clip2 = clipText;
var partText = (content) => (content ?? []).filter((p) => p.text && (p.type === "input_text" || p.type === "output_text" || p.type === "text")).map((p) => p.text).join("\n");
var INJECTED = /^\s*<\/?[a-zA-Z_][\w-]*[^>]*>/;
var isInjectedUserText = (text) => INJECTED.test(text) || text.trimStart().startsWith("# AGENTS.md instructions for ");
var userPartText = (content) => (content ?? []).filter((p) => p.text && (p.type === "input_text" || p.type === "text") && !isInjectedUserText(p.text)).map((p) => p.text).join("\n");
var outputText = (output) => {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return output.map((p) => p?.text ?? "").filter(Boolean).join("\n");
  return output == null ? "" : JSON.stringify(output);
};
var CodexSessionCollector = class {
  turns = [];
  pendingCalls = /* @__PURE__ */ new Map();
  current = null;
  pendingCompaction;
  sessionId = null;
  cwd = "";
  day = "";
  sawItems = false;
  firstQuestion = null;
  parentThreadId = null;
  startedAt = null;
  feedLine(raw) {
    const t = raw.trim();
    if (!t) return;
    let line;
    try {
      line = JSON.parse(t);
    } catch {
      return;
    }
    this.feed(line);
  }
  flush() {
    const c = this.current;
    if (c && (c.question || c.response || c.tools.length)) this.turns.push(c);
    this.current = null;
  }
  ensure() {
    if (!this.current) {
      this.current = { question: "", response: "", itemIds: [], tools: [] };
      if (this.pendingCompaction) {
        this.current.compactionBefore = this.pendingCompaction;
        this.pendingCompaction = void 0;
      }
    }
    return this.current;
  }
  feed(line) {
    const p = line.payload ?? {};
    if (line.type === "session_meta" && p.id && !this.sessionId) {
      this.sessionId = p.id;
      this.cwd = p.cwd ?? "";
      this.day = p.timestamp?.slice(0, 10) ?? "";
      this.parentThreadId = p.parent_thread_id ?? null;
      this.startedAt = p.timestamp ?? line.timestamp ?? null;
      return;
    }
    if (line.type === "response_item" || line.type === "event_msg") this.sawItems = true;
    if (line.type === "compacted") {
      this.flush();
      this.pendingCompaction = "[Compaction] The source runner compacted its history here. Everything above this point reached later turns only as a summary.";
      return;
    }
    if (line.type === "turn_context" || line.type === "event_msg" && p.type === "task_started") {
      this.flush();
      const t = this.ensure();
      if (p.turn_id) t.itemIds.push(p.turn_id);
      return;
    }
    if (line.type !== "response_item") return;
    if (p.type === "message") {
      if (p.role === "user") {
        const text = userPartText(p.content);
        if (text.trim()) {
          if (!this.firstQuestion) this.firstQuestion = text.trim();
          const t = this.ensure();
          if (!t.at && line.timestamp) t.at = line.timestamp;
          t.question = t.question ? `${t.question}

${text}` : text;
        }
      } else if (p.role === "assistant") {
        const text = partText(p.content);
        if (text.trim()) {
          const t = this.ensure();
          t.response = t.response ? `${t.response}

${text}` : text;
        }
      }
    } else if ((p.type === "function_call" || p.type === "custom_tool_call") && p.call_id && p.name) {
      const raw = String(p.arguments ?? p.input ?? "");
      const op = toolOpOf(p.name);
      const call = clip2(raw, op === "edit" || op === "write" ? ARTIFACT_CALL_LIMIT : TOOL_CALL_LIMIT);
      const viewed = op === "read" ? (() => {
        try {
          const a = JSON.parse(raw);
          return typeof a.path === "string" && a.path ? [a.path] : [];
        } catch {
          return [];
        }
      })() : [];
      this.pendingCalls.set(p.call_id, { name: p.name, call: call.text, paths: op === "edit" ? patchPaths(raw) : viewed, op });
    } else if ((p.type === "function_call_output" || p.type === "custom_tool_call_output") && p.call_id) {
      const reg = this.pendingCalls.get(p.call_id);
      if (reg) {
        const t = this.ensure();
        const res = clip2(outputText(p.output), TOOL_RESULT_LIMIT);
        t.tools.push({
          name: reg.name,
          call: reg.call,
          result: res.text,
          truncated: res.truncated,
          ...reg.paths.length ? { paths: reg.paths } : {},
          op: reg.op,
          nativeCallId: p.call_id
        });
        this.pendingCalls.delete(p.call_id);
      }
    }
  }
  finish() {
    this.flush();
    if (!this.sessionId || !this.sawItems) return null;
    const folded = [];
    let carriedCompaction;
    for (const turn of this.turns) {
      const prev = folded[folded.length - 1];
      if (!turn.question.trim() && prev) {
        if (turn.compactionBefore) carriedCompaction = carriedCompaction ?? turn.compactionBefore;
        if (turn.response) prev.response = prev.response ? `${prev.response}

${turn.response}` : turn.response;
        prev.tools.push(...turn.tools);
        prev.itemIds.push(...turn.itemIds);
      } else {
        if (carriedCompaction && !turn.compactionBefore) turn.compactionBefore = carriedCompaction;
        carriedCompaction = void 0;
        folded.push(turn);
      }
    }
    this.turns = folded;
    const dir = this.cwd.split("/").filter(Boolean).pop();
    const title = this.firstQuestion?.split("\n")[0].slice(0, 60) || ["codex", dir, this.day].filter(Boolean).join(" \xB7 ");
    return { sessionId: this.sessionId, title, turns: dropSelfCommandTurns(this.turns), subagent: !!this.parentThreadId, ...this.cwd ? { cwd: this.cwd } : {} };
  }
  toConversation() {
    const s = this.finish();
    if (!s || s.turns.length === 0) return null;
    return {
      title: s.title,
      messageCount: s.turns.length,
      source: "codex",
      sessionId: s.sessionId,
      build: () => buildGraphFromTurns2(s.turns, s.sessionId, s.cwd),
      adopt: (subs) => adoptSubagentSessions(s.turns, subs)
    };
  }
  /** This rollout as a child thread's transcript, for the parent named in its header to adopt. */
  toSubagentSession() {
    const s = this.finish();
    if (!s || s.turns.length === 0 || !s.subagent) return null;
    const first = s.turns[0];
    const at = first.at ?? this.startedAt ?? void 0;
    return { runner: "codex", sessionId: s.sessionId, firstQuestion: this.firstQuestion ?? first.question, turns: s.turns, ...s.cwd ? { cwd: s.cwd } : {}, ...at ? { at } : {} };
  }
};
function buildGraphFromTurns2(turns, sessionId, cwd) {
  const origin = cwd ? { cwd } : {};
  const nodes = [];
  const edges = [];
  let prev = null;
  for (const turn of turns) {
    let noteToWire = null;
    if (turn.compactionBefore) {
      const note = makeNode(turn.compactionBefore, "", false);
      note.data.stepKind = "note";
      note.data.importSource = { runner: "codex", sessionId, itemIds: [], ...origin };
      markImporterNote(note);
      nodes.push(note);
      noteToWire = note;
    }
    const node = makeNode(turn.question || "(tool-only turn)", turn.response, prev === null);
    node.data.importSource = { runner: "codex", sessionId, itemIds: turn.itemIds, ...origin };
    node.data.source = { question: node.data.question, response: node.data.response };
    node.data.attachments = toolAttachments(turn);
    seedPlaque(node);
    nodes.push(node);
    if (prev) edges.push({ id: generateId(), source: prev.id, target: node.id, type: "smoothstep" });
    if (noteToWire) edges.push({ id: generateId(), source: noteToWire.id, target: node.id, type: "smoothstep" });
    attachSubagentBranches(node, turn, nodes, edges, "codex", sessionId, cwd);
    prev = node;
  }
  return { nodes: autoLayout(nodes, edges), edges };
}

// ../src/lib/adapters/dsh-session.ts
function resultFailed(data) {
  if (!data) return false;
  if (data.error) return true;
  const parts = data.message?.content;
  return Array.isArray(parts) && parts.some((p) => !!p && typeof p === "object" && p.isError === true);
}
function partsText(content, depth = 0) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || depth > 2) return "";
  return content.map((p) => {
    if (!p || typeof p !== "object") return "";
    const o = p;
    if (o.type === "text" && typeof o.text === "string") return o.text;
    if (o.type === "image") return "[image omitted]";
    if (o.type === "reasoning") return "";
    return partsText(o.text ?? o.content, depth + 1);
  }).filter(Boolean).join("\n");
}
function renderRootCall(name, argumentsJson, args) {
  const op = toolOpOf(name);
  if (op === "run" || /^run_code$/i.test(name)) {
    const a = args ?? {};
    return clipText(typeof a.code === "string" ? a.code : argumentsJson, ARTIFACT_CALL_LIMIT);
  }
  const body = args && typeof args === "object" ? renderCall(name, args) : argumentsJson;
  return clipText(body, op === "write" || op === "edit" ? ARTIFACT_CALL_LIMIT : TOOL_CALL_LIMIT);
}
var parseArgs = (json) => {
  try {
    return JSON.parse(json ?? "");
  } catch {
    return void 0;
  }
};
var DshSessionCollector = class {
  turns = [];
  pendingTools = /* @__PURE__ */ new Map();
  current = null;
  sessionId = null;
  cwd = null;
  title = null;
  firstQuestion = null;
  feedLine(raw) {
    const t = raw.trim();
    if (!t) return;
    let line;
    try {
      line = JSON.parse(t);
    } catch {
      return;
    }
    this.feed(line);
  }
  flush() {
    const c = this.current;
    if (c && (c.question || c.response || c.tools.length)) this.turns.push(c);
    this.current = null;
  }
  ensure() {
    if (!this.current) this.current = { question: "", response: "", itemIds: [], tools: [] };
    return this.current;
  }
  feed(line) {
    if (line.type === "session" && line.id && !("timestamp" in line)) {
      if (!this.sessionId) this.sessionId = line.id;
      if (line.cwd && !this.cwd) this.cwd = line.cwd;
      return;
    }
    if (line.type === "session/title" && line.data?.title && !this.title) {
      this.title = line.data.title;
      return;
    }
    if (line.type === "user/message") {
      const um = line;
      const kind = um.data?.source?.kind;
      if (kind && kind !== "user") return;
      const text = partsText(um.data?.content).trim();
      if (!text) return;
      if (!this.firstQuestion) this.firstQuestion = text.split("\n")[0].slice(0, 80);
      this.flush();
      const t = this.ensure();
      t.question = text;
      t.itemIds = [um.data?.id ?? `u${um.seq}`];
      if (um.time) t.at = new Date(um.time).toISOString();
      return;
    }
    if (line.type === "assistant/message" && this.current) {
      const am = line;
      const parts = am.data?.message?.content;
      const text = partsText(parts).trim();
      const id = am.data?.message?.id;
      if (id) this.current.itemIds.push(id);
      if (text) this.current.response = this.current.response ? `${this.current.response}

${text}` : text;
      return;
    }
    if (line.type === "tool/call") {
      const tc = line;
      if (!tc.data?.callId || !tc.data?.name) return;
      const op = /^run_code$/i.test(tc.data.name) ? "run" : toolOpOf(tc.data.name);
      const args = parseArgs(tc.data.arguments);
      const call = renderRootCall(tc.data.name, tc.data.arguments ?? "", args);
      const scope = op === "run" ? {} : toolScope(args);
      this.pendingTools.set(tc.data.callId, { name: tc.data.name, call: call.text, truncated: call.truncated, op, paths: op === "run" ? [] : toolPaths(args), ...scope });
      return;
    }
    if (line.type === "tool/result") {
      const tr = line;
      const callId = tr.data?.message?.source?.callId;
      if (!callId) return;
      const reg = this.pendingTools.get(callId);
      if (!reg) return;
      const res = clipText(partsText(tr.data?.message?.content), TOOL_RESULT_LIMIT);
      const t = this.ensure();
      const failed = resultFailed(tr.data);
      t.tools.push({
        name: reg.name,
        call: reg.call,
        result: res.text,
        truncated: reg.truncated || res.truncated,
        op: failed ? "other" : reg.op,
        nativeCallId: callId,
        ...failed ? {} : { ...reg.paths.length ? { paths: reg.paths } : {}, ...reg.url ? { url: reg.url } : {}, ...reg.locator ? { locator: reg.locator } : {} }
      });
      this.pendingTools.delete(callId);
      return;
    }
    if (line.type === "tool/code-dispatch" || line.type === "tool/ptc-dispatch") {
      const d = line.data;
      if (!d?.name || !d.subCallId) return;
      const paths = toolPaths(d.arguments);
      const scope = toolScope(d.arguments);
      if (!paths.length && !scope.url) return;
      if (d.isError === true) {
        const attempt = clipText(renderCall(d.name, d.arguments), TOOL_CALL_LIMIT);
        const err = clipText(partsText(d.content), TOOL_RESULT_LIMIT);
        this.ensure().tools.push({ name: d.name, call: attempt.text, result: err.text, truncated: attempt.truncated || err.truncated, op: "other", nativeCallId: d.subCallId });
        return;
      }
      const op = toolOpOf(d.name);
      const call = clipText(renderCall(d.name, d.arguments), op === "write" || op === "edit" ? ARTIFACT_CALL_LIMIT : TOOL_CALL_LIMIT);
      const res = clipText(partsText(d.content), TOOL_RESULT_LIMIT);
      this.ensure().tools.push({
        name: d.name,
        call: call.text,
        result: res.text,
        truncated: call.truncated || res.truncated,
        op,
        nativeCallId: d.subCallId,
        ...paths.length ? { paths } : {},
        ...scope.url ? { url: scope.url } : {},
        ...scope.locator ? { locator: scope.locator } : {}
      });
      return;
    }
  }
  finish() {
    this.flush();
    if (!this.sessionId) return null;
    const asked = this.firstQuestion ?? null;
    const title = this.title ?? asked ?? `session ${this.sessionId.replace(/^session-/, "").slice(0, 8)}`;
    return { sessionId: this.sessionId, title, turns: dropSelfCommandTurns(this.turns), ...this.cwd ? { cwd: this.cwd } : {} };
  }
  toConversation() {
    const s = this.finish();
    if (!s || s.turns.length === 0) return null;
    return {
      title: s.title,
      messageCount: s.turns.length,
      source: "dsh",
      sessionId: s.sessionId,
      build: () => buildGraphFromTurns3(s.turns, s.sessionId, s.cwd)
    };
  }
};
function buildGraphFromTurns3(turns, sessionId, cwd) {
  const origin = cwd ? { cwd } : {};
  const nodes = [];
  const edges = [];
  let prev = null;
  for (const turn of turns) {
    const node = makeNode(turn.question || "(tool-only turn)", turn.response, prev === null);
    node.data.importSource = { runner: "dsh", sessionId, itemIds: turn.itemIds, ...origin };
    node.data.source = { question: node.data.question, response: node.data.response };
    node.data.attachments = toolAttachments(turn);
    seedPlaque(node);
    nodes.push(node);
    if (prev) edges.push({ id: generateId(), source: prev.id, target: node.id, type: "smoothstep" });
    prev = node;
  }
  return { nodes: autoLayout(nodes, edges), edges };
}

// ../src/lib/adapters/pi-session.ts
var textOf = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
};
function renderCall2(name, args) {
  const a = args && typeof args === "object" ? args : {};
  const op = toolOpOf(name);
  const paths = typeof a.path === "string" && a.path && (op === "read" || op === "edit" || op === "write") ? [a.path] : [];
  let locator;
  if (op === "read" && (typeof a.offset === "number" || typeof a.limit === "number")) {
    const start = Math.max(1, typeof a.offset === "number" ? a.offset : 1);
    const end = typeof a.limit === "number" ? start + Math.max(0, a.limit) - 1 : start;
    locator = { lines: [start, Math.max(start, end)] };
  }
  if (op === "write" && typeof a.content === "string") {
    const c2 = clipText(`${a.path ?? ""}

${a.content}`, ARTIFACT_CALL_LIMIT);
    return { ...c2, paths };
  }
  if (op === "edit") {
    const edits = Array.isArray(a.edits) ? a.edits : typeof a.newText === "string" ? [{ oldText: a.oldText, newText: a.newText }] : [];
    if (edits.length) {
      const body = edits.map((e) => `${a.path ?? ""}
--- old
${e.oldText ?? ""}
+++ new
${e.newText ?? ""}`).join("\n\n");
      const c2 = clipText(body, ARTIFACT_CALL_LIMIT);
      return { ...c2, paths };
    }
  }
  if (op === "run" && typeof a.command === "string") {
    const c2 = clipText(a.command, TOOL_CALL_LIMIT);
    return { ...c2, paths };
  }
  const c = clipText(JSON.stringify(args ?? {}), TOOL_CALL_LIMIT);
  return { ...c, paths, ...locator ? { locator } : {} };
}
var finalOutput = (messages) => {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "assistant") {
      const text = textOf(m.content).trim();
      if (text) return text;
    }
  }
  return "";
};
function subagentRuns(args, content, details, callId) {
  const d = details;
  if (Array.isArray(d?.results) && d.results.length) {
    return d.results.map((r, i) => ({ agent: String(r.agent ?? "agent"), task: String(r.task ?? ""), output: finalOutput(r.messages) || String(r.stderr ?? "").trim(), itemIds: [`${callId}#${i}`] }));
  }
  const a = args && typeof args === "object" ? args : {};
  const asked = Array.isArray(a.tasks) && a.tasks.length ? a.tasks : Array.isArray(a.chain) && a.chain.length ? a.chain : a.agent || a.task ? [{ agent: a.agent, task: a.task }] : [];
  const text = textOf(content).trim();
  return asked.map((x, i) => ({ agent: String(x.agent ?? "agent"), task: String(x.task ?? ""), output: asked.length === 1 ? text : "", itemIds: [`${callId}#${i}`] }));
}
var PiSessionCollector = class {
  turns = [];
  pending = /* @__PURE__ */ new Map();
  current = null;
  sessionId = null;
  cwd = null;
  firstQuestion = null;
  feedLine(raw) {
    const t = raw.trim();
    if (!t) return;
    let e;
    try {
      e = JSON.parse(t);
    } catch {
      return;
    }
    this.feed(e);
  }
  flush() {
    const c = this.current;
    if (c && (c.question || c.response || c.tools.length)) this.turns.push(c);
    this.current = null;
  }
  feed(e) {
    if (e.type === "session" && typeof e.id === "string") {
      if (!this.sessionId) this.sessionId = e.id;
      if (typeof e.cwd === "string" && !this.cwd) this.cwd = e.cwd;
      return;
    }
    if (e.type !== "message") {
      if (this.current && typeof e.id === "string") this.current.itemIds.push(e.id);
      return;
    }
    const m = e.message;
    if (!m) return;
    if (m.role === "user") {
      const text = textOf(m.content).trim();
      if (!text) return;
      this.flush();
      if (!this.firstQuestion) this.firstQuestion = text.split("\n")[0].slice(0, 80);
      const at = typeof e.timestamp === "string" ? e.timestamp : typeof m.timestamp === "number" ? new Date(m.timestamp).toISOString() : void 0;
      this.current = {
        question: text,
        response: "",
        itemIds: typeof e.id === "string" ? [e.id] : [],
        tools: [],
        ...typeof e.parentId === "string" ? { parentItemId: e.parentId } : {},
        ...at ? { at } : {}
      };
      return;
    }
    if (m.role === "assistant") {
      const cur = this.current ?? (this.current = { question: "", response: "", itemIds: [], tools: [] });
      if (typeof e.id === "string") cur.itemIds.push(e.id);
      const text = textOf(m.content).trim();
      if (text) cur.response = cur.response ? `${cur.response}

${text}` : text;
      if (Array.isArray(m.content)) {
        for (const b of m.content) {
          if (b?.type !== "toolCall" || typeof b.id !== "string" || typeof b.name !== "string") continue;
          const r = renderCall2(b.name, b.arguments);
          this.pending.set(b.id, { name: b.name, call: r.text, truncated: r.truncated, op: toolOpOf(b.name), paths: r.paths, ...r.locator ? { locator: r.locator } : {}, ...b.name === "subagent" ? { args: b.arguments } : {} });
        }
      }
      return;
    }
    if (m.role === "toolResult") {
      const id = m.toolCallId;
      if (!id) return;
      const reg = this.pending.get(id);
      if (!reg) return;
      const cur = this.current ?? (this.current = { question: "", response: "", itemIds: [], tools: [] });
      if (typeof e.id === "string") cur.itemIds.push(e.id);
      const res = clipText(textOf(m.content), TOOL_RESULT_LIMIT);
      cur.tools.push({
        name: reg.name,
        call: reg.call,
        result: res.text,
        truncated: reg.truncated || res.truncated,
        op: reg.op,
        nativeCallId: id,
        ...reg.paths.length ? { paths: reg.paths } : {},
        ...reg.locator ? { locator: reg.locator } : {}
      });
      if (reg.name === "subagent") {
        const runs = subagentRuns(reg.args, m.content, m.details, id);
        if (runs.length) cur.subagents = [...cur.subagents ?? [], ...runs];
      }
      this.pending.delete(id);
    }
  }
  finish() {
    this.flush();
    if (!this.sessionId) return null;
    const title = this.firstQuestion ?? `session ${this.sessionId.slice(0, 8)}`;
    return { sessionId: this.sessionId, title, turns: dropSelfCommandTurns(this.turns), ...this.cwd ? { cwd: this.cwd } : {} };
  }
  toConversation() {
    const s = this.finish();
    if (!s || s.turns.length === 0) return null;
    return {
      title: s.title,
      messageCount: s.turns.length,
      source: "pi",
      sessionId: s.sessionId,
      build: () => buildGraphFromTurns4(s.turns, s.sessionId, s.cwd)
    };
  }
};
function buildGraphFromTurns4(turns, sessionId, cwd) {
  const origin = cwd ? { cwd } : {};
  const nodes = [];
  const edges = [];
  const byItem = /* @__PURE__ */ new Map();
  const link = (a, b) => edges.push({ id: generateId(), source: a.id, target: b.id, type: "smoothstep" });
  let prev = null;
  for (const turn of turns) {
    const node = makeNode(turn.question || "(tool-only turn)", turn.response, prev === null);
    node.data.importSource = { runner: "pi", sessionId, itemIds: turn.itemIds, ...origin };
    node.data.source = { question: node.data.question, response: node.data.response };
    node.data.attachments = toolAttachments(turn);
    seedPlaque(node);
    nodes.push(node);
    const parent = turn.parentItemId ? byItem.get(turn.parentItemId) : void 0;
    if (parent) link(parent, node);
    else if (prev) link(prev, node);
    attachSubagentBranches(node, turn, nodes, edges, "pi", sessionId, cwd);
    for (const id of turn.itemIds) byItem.set(id, node);
    prev = node;
  }
  return { nodes: autoLayout(nodes, edges), edges };
}

// ../src/lib/adapters/dsh-zstd.ts
var ZSTD_MAGIC = 4247762216;
function scanZstdFrames(buf) {
  const frames = [];
  const u32 = (o) => (buf[o] | buf[o + 1] << 8 | buf[o + 2] << 16 | buf[o + 3] << 24) >>> 0;
  let offset = 0;
  while (offset < buf.length) {
    const start = offset;
    if (buf.length - offset < 4) break;
    if (u32(offset) !== ZSTD_MAGIC) return frames;
    offset += 4;
    if (offset >= buf.length) break;
    const descriptor = buf[offset];
    offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictFlag = descriptor & 3;
    const dictBytes = dictFlag === 3 ? 4 : dictFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? singleSegment ? 1 : 0 : 1 << contentSizeFlag;
    const restOfHeader = (singleSegment ? 0 : 1) + dictBytes + contentSizeBytes;
    if (buf.length - offset < restOfHeader) break;
    offset += restOfHeader;
    for (; ; ) {
      if (buf.length - offset < 3) return frames;
      const header = buf[offset] | buf[offset + 1] << 8 | buf[offset + 2] << 16;
      offset += 3;
      const last = (header & 1) !== 0;
      const type = header >>> 1 & 3;
      const size = header >>> 3;
      const payload = type === 1 ? 1 : size;
      if (buf.length - offset < payload) return frames;
      offset += payload;
      if (last) break;
    }
    if (checksum) {
      if (buf.length - offset < 4) return frames;
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return frames;
}
function decompressZstdFrames(buf, inflate) {
  const parts = scanZstdFrames(buf).map((f) => inflate(buf.subarray(f.start, f.end)));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ../src/lib/events/project.ts
var EXCERPT_CHARS = 200;
var OBS_FULL = { basis: "observed", completeness: "full" };
var OBS_PART = { basis: "observed", completeness: "partial" };
var clip3 = (s, max = EXCERPT_CHARS) => {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max)}\u2026` : t;
};
var sessionKey = (runner, nativeId) => `${runner}:${nativeId}`;
function fragmentTag(sourceId) {
  let h = 5381;
  for (let i = 0; i < sourceId.length; i++) h = (h << 5) + h + sourceId.charCodeAt(i) | 0;
  return (h >>> 0).toString(36);
}
function turnKeys(session, turns) {
  const seen = /* @__PURE__ */ new Map();
  return turns.map((t, i) => {
    const base = t.itemIds[0] ?? `i${i}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? `${session}#${base}` : `${session}#${base}~${n}`;
  });
}
var isWindowsAbs = (p) => /^[A-Za-z]:[\\/]/.test(p);
function absolutePath(observed, cwd) {
  const p = observed.replace(/\\/g, "/");
  let base;
  if (p.startsWith("/") || isWindowsAbs(p)) base = p;
  else if (cwd) base = `${cwd.replace(/\\/g, "/").replace(/\/+$/, "")}/${p}`;
  else return null;
  const drive = isWindowsAbs(base) ? base.slice(0, 2) : "";
  const parts = [];
  for (const seg of base.slice(drive.length).split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return `${drive}/${parts.join("/")}`;
}
function fileUri(absPath) {
  const drive = isWindowsAbs(absPath) ? absPath.slice(0, 2) : "";
  const rest = absPath.slice(drive.length);
  const encoded = rest.split("/").map((seg) => encodeURIComponent(seg)).join("/");
  return `file://${drive ? `/${drive}` : ""}${encoded}`;
}
function filePathOf(id) {
  if (!id.startsWith("file://")) return null;
  const raw = id.slice("file://".length);
  const decoded = raw.split("/").map((seg) => {
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  }).join("/");
  return /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded;
}
function fileArtifact(observed, cwd) {
  const abs = absolutePath(observed, cwd);
  return abs ? { id: fileUri(abs), observedPath: observed } : null;
}
var ARXIV_RE = /^\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?\/?$/;
function urlArtifact(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (host === "arxiv.org" || host === "www.arxiv.org") {
    const m = u.pathname.match(ARXIV_RE);
    if (m) return { id: `arxiv:${m[1]}`, observedPath: url };
  }
  u.hash = "";
  return { id: u.href, observedPath: url };
}
function arxivArtifact(text) {
  const m = text.trim().match(/^(?:arxiv:)?(\d{4}\.\d{4,5})(?:v\d+)?$/i);
  return m ? { id: `arxiv:${m[1]}`, observedPath: text } : null;
}
function toolArtifacts(tool, cwd) {
  const out = [];
  for (const p of tool.paths ?? []) {
    const a = fileArtifact(p, cwd);
    if (a) out.push(tool.locator ? { ...a, locator: tool.locator } : a);
  }
  if (tool.url) {
    const a = urlArtifact(tool.url);
    if (a) out.push(a);
  }
  return out;
}
function changeHead(t) {
  const one = (s, max = 70) => {
    const l = s.trim();
    return l.length > max ? `${l.slice(0, max)}\u2026` : l;
  };
  if (t.op === "edit" && /^\*\*\* Begin Patch/m.test(t.call)) {
    const lines = t.call.split("\n");
    const minus = lines.find((l) => l.startsWith("-") && !l.startsWith("---"))?.slice(1) ?? "";
    const plus = lines.find((l) => l.startsWith("+") && !l.startsWith("+++"))?.slice(1) ?? "";
    if (minus || plus) return `${one(minus) || "\u2205"} \u2192 ${one(plus) || "\u2205"}`;
  }
  if (t.op === "edit") {
    const m = t.call.match(/\n--- old\n([\s\S]*?)\n\+\+\+ new\n([\s\S]*)$/);
    if (!m) return void 0;
    const a = m[1].split("\n");
    const b = m[2].split("\n");
    let k = 0;
    while (k < a.length && k < b.length && a[k] === b[k]) k++;
    const before = a.slice(k).find((l) => l.trim()) ?? "";
    const after = b.slice(k).find((l) => l.trim()) ?? "";
    return `${one(before) || "\u2205"} \u2192 ${one(after) || "\u2205"}`;
  }
  if (t.op === "write") {
    const body = t.call.replace(/^[^\n]*\n\n?/, "");
    const first = body.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
    return `new file, ${body.length} chars: ${one(first, 80)}`;
  }
  return void 0;
}
var opOf = (t) => t.op ?? "unknown";
var ANCHOR_RE = /\[记忆图 anchor: project=([\w-]+) node=([\w-]+) bundle=([\w-]+)(?: mode=(branch|continue))?\]/;
function anchorOf(text) {
  const m = text.match(ANCHOR_RE);
  return m ? { project: m[1], node: m[2], bundle: m[3], mode: m[4] === "continue" ? "continue" : "branch" } : void 0;
}
function sessionToEvents(s) {
  const sid = sessionKey(s.runner, s.nativeId);
  const src = (ref) => ({ runner: s.runner, file: s.file, ref, schema: s.schema });
  const out = [];
  const sourceId = s.sourceId ?? s.file;
  const started = {
    id: `${sid}/session@${fragmentTag(sourceId)}`,
    kind: "session.started",
    sessionId: sid,
    source: src(s.nativeId),
    ...OBS_FULL,
    runner: s.runner,
    nativeId: s.nativeId,
    sourceId,
    title: s.title,
    ...s.cwd ? { cwd: s.cwd } : {},
    ...s.workspace ? { workspace: s.workspace } : {},
    ...s.parentSessionId ? { parentSessionId: s.parentSessionId } : {},
    ...s.subagent ? { subagent: true } : {}
  };
  const anchor = anchorOf(s.turns[0]?.question ?? "");
  if (anchor) started.anchor = anchor;
  out.push(started);
  const keys = turnKeys(sid, s.turns);
  const byItem = /* @__PURE__ */ new Map();
  s.turns.forEach((t, i) => {
    for (const id of t.itemIds) if (!byItem.has(id)) byItem.set(id, keys[i]);
  });
  s.turns.forEach((t, i) => {
    const tid = keys[i];
    const at = t.at;
    const base = { sessionId: sid, turnId: tid, turnIndex: i, ...at ? { at } : {} };
    if (t.compactionBefore) {
      const b = {
        id: `${tid}/compaction`,
        kind: "boundary.compaction",
        sessionId: sid,
        source: src(t.itemIds[0] ?? `turn-${i}`),
        ...OBS_PART,
        ...at ? { at } : {},
        summaryExcerpt: clip3(t.compactionBefore)
      };
      out.push(b);
    }
    const parent = t.parentItemId ? byItem.get(t.parentItemId) : void 0;
    const ts = {
      id: `${tid}/turn`,
      kind: "turn.started",
      ...base,
      source: src(t.itemIds[0] ?? `turn-${i}`),
      ...OBS_FULL,
      ...parent && parent !== tid ? { parentTurnId: parent } : {},
      humanAuthored: !!t.question.trim()
    };
    out.push(ts);
    if (t.question.trim()) {
      const m = {
        id: `${tid}/q`,
        kind: "message.recorded",
        ...base,
        source: src(t.itemIds[0] ?? `turn-${i}`),
        ...OBS_FULL,
        role: "user",
        actor: "human",
        modelVisible: true,
        excerpt: clip3(t.question),
        length: t.question.length
      };
      out.push(m);
    }
    t.tools.forEach((tool, k) => {
      const callId = `${tid}/t${k}`;
      const nativeRef = tool.nativeCallId ?? `${t.itemIds[0] ?? `turn-${i}`}:tool${k}`;
      const artifacts = toolArtifacts(tool, s.cwd);
      const change = changeHead(tool);
      const called = {
        id: callId,
        kind: "tool.called",
        ...base,
        source: src(nativeRef),
        ...OBS_PART,
        callId: tool.nativeCallId ?? callId,
        name: tool.name,
        op: opOf(tool),
        artifacts,
        excerpt: clip3(tool.call),
        length: tool.call.length,
        ...change ? { change } : {}
      };
      out.push(called);
      const done = {
        id: `${callId}/result`,
        kind: "tool.completed",
        ...base,
        source: src(nativeRef),
        basis: "observed",
        completeness: tool.truncated ? "partial" : "full",
        calledEventId: callId,
        excerpt: clip3(tool.result),
        length: tool.result.length,
        truncated: tool.truncated
      };
      out.push(done);
    });
    if (t.response.trim()) {
      const m = {
        id: `${tid}/a`,
        kind: "message.recorded",
        ...base,
        source: src(t.itemIds[t.itemIds.length - 1] ?? `turn-${i}`),
        ...OBS_PART,
        role: "assistant",
        actor: "model",
        modelVisible: true,
        excerpt: clip3(t.response),
        length: t.response.length
      };
      out.push(m);
    }
  });
  return out;
}
function deriveTouches(events) {
  const rank = { read: 1, fetch: 1, attach: 1, write: 2, edit: 2 };
  const byKey = /* @__PURE__ */ new Map();
  for (const raw of events) {
    const e = raw.kind === "artifact.attached" ? { kind: "tool.called", id: raw.id, sessionId: raw.sessionId, turnId: raw.turnId, turnIndex: raw.turnIndex, at: raw.at, op: "attach", artifacts: [raw.artifact], change: void 0 } : raw;
    if (e.kind !== "tool.called" || !(e.op in rank)) continue;
    for (const a of e.artifacts) {
      const key = `${e.turnId}|${a.id}`;
      const prev = byKey.get(key);
      const stronger = !prev || rank[e.op] > rank[prev.op];
      const locators = [...prev?.locators ?? []];
      if (a.locator && !locators.some((l) => JSON.stringify(l) === JSON.stringify(a.locator))) locators.push(a.locator);
      if (!prev || stronger) {
        const change = stronger ? e.change ?? prev?.change : prev?.change;
        byKey.set(key, {
          artifact: a.id,
          op: e.op,
          sessionId: e.sessionId,
          turnId: e.turnId,
          turnIndex: e.turnIndex ?? 0,
          derivedFrom: e.id,
          ...e.at ? { at: e.at } : {},
          ...change ? { change } : {},
          ...locators.length ? { locators } : {}
        });
      } else {
        if (!prev.change && e.change) prev.change = e.change;
        if (locators.length) prev.locators = locators;
      }
    }
  }
  return [...byKey.values()];
}

// ../src/lib/events/manifests.ts
var OBS_FULL2 = { basis: "observed", completeness: "full" };
var OBS_PART2 = { basis: "observed", completeness: "partial" };
var UNKNOWN = { basis: "inferred", completeness: "unknown" };
var CLAUDE_CODE_MANIFEST = {
  runner: "claude-code",
  schema: "cc-jsonl/2026-09",
  turns: OBS_FULL2,
  parenting: OBS_FULL2,
  // parentUuid is written on every message
  messages: OBS_PART2,
  // one assistant record per turn
  toolPairing: OBS_FULL2,
  // tool_use.id ↔ tool_result.tool_use_id
  artifactTouch: OBS_PART2,
  // shell commands are not parsed for files
  compaction: OBS_PART2,
  // the boundary is marked; what it replaced is not
  contextSurface: UNKNOWN
};
var CODEX_MANIFEST = {
  runner: "codex",
  schema: "codex-rollout/2026-09",
  turns: OBS_FULL2,
  parenting: OBS_PART2,
  // rollouts are linear; forks live in the app-server thread store
  messages: OBS_PART2,
  toolPairing: OBS_FULL2,
  // call_id pairs function_call with its output
  artifactTouch: OBS_PART2,
  // only apply_patch names files
  compaction: OBS_PART2,
  contextSurface: UNKNOWN
};
var YU_MEMORY_GRAPH_MANIFEST = {
  runner: "memory-graph",
  schema: "memory-graph-canvas/1",
  turns: OBS_FULL2,
  parenting: OBS_FULL2,
  // the wires ARE the structure
  messages: OBS_FULL2,
  // hand-made nodes carry their text whole
  toolPairing: UNKNOWN,
  // no tools run on the canvas
  artifactTouch: OBS_FULL2,
  // attachments and references are explicit
  compaction: UNKNOWN,
  // condensing is a new node, not a replacement
  contextSurface: OBS_PART2
  // exact for logged commits, upstream-only before
};
var PI_MANIFEST = {
  runner: "pi",
  schema: "pi-session/v3",
  turns: OBS_FULL2,
  // one user message opens every turn
  parenting: OBS_FULL2,
  // every entry names its parent; the session is a tree
  messages: OBS_PART2,
  // assistant text blocks fold per turn; thinking is dropped
  toolPairing: OBS_FULL2,
  // toolCall blocks ↔ toolResult messages pair by toolCallId
  artifactTouch: OBS_FULL2,
  // `path` on read/edit/write; shell commands stay opaque, as for every runner
  compaction: UNKNOWN,
  // not projected yet
  contextSurface: UNKNOWN
  // the log records messages, not requests
};
var DSH_MANIFEST = {
  runner: "dsh",
  schema: "dsh-events/2026-09",
  turns: OBS_FULL2,
  // user/message events (source.kind=user) bound every turn
  parenting: OBS_FULL2,
  // turns are linear; a continued session is a new file
  messages: OBS_PART2,
  // assistant text folds per step; reasoning is dropped
  toolPairing: OBS_FULL2,
  // tool/call ↔ tool/result pair by callId
  artifactTouch: OBS_FULL2,
  // file_path on read/write/edit — top-level calls and run_code dispatches alike; shell commands stay opaque, as for every runner
  compaction: UNKNOWN,
  // no boundary event observed in the log yet
  contextSurface: OBS_PART2
  // request/context carries provider+model+window, never messages
};
var MANIFESTS = {
  "claude-code": CLAUDE_CODE_MANIFEST,
  codex: CODEX_MANIFEST,
  dsh: DSH_MANIFEST,
  pi: PI_MANIFEST,
  memory-graph: YU_MEMORY_GRAPH_MANIFEST
};

// ../src/lib/adapters/memory-graph-canvas.ts
var OBS_FULL3 = { basis: "observed", completeness: "full" };
var OBS_PART3 = { basis: "observed", completeness: "partial" };
var clip4 = (s, max = EXCERPT_CHARS) => {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max)}\u2026` : t;
};
function isCanvasBackup(v) {
  return !!v && typeof v === "object" && Array.isArray(v.nodes) && Array.isArray(v.edges);
}
function canvasNativeId(file) {
  const base = file.replace(/\\/g, "/").split("/").pop() ?? file;
  return base.replace(/\.memory-graph\.json$/i, "");
}
function canvasToEvents(backup, opts) {
  const nativeId = backup.projectId?.trim() || canvasNativeId(opts.file);
  const sid = sessionKey("memory-graph", nativeId);
  const sourceId = opts.sourceId ?? opts.file;
  const schema = YU_MEMORY_GRAPH_MANIFEST.schema;
  const src = (ref) => ({ runner: "memory-graph", file: opts.file, ref, schema });
  const out = [];
  const texts = /* @__PURE__ */ new Map();
  const title = backup.name?.trim() || nativeId;
  const started = {
    id: `${sid}/session@${fragmentTag(sourceId)}`,
    kind: "session.started",
    sessionId: sid,
    source: src("canvas"),
    ...OBS_FULL3,
    runner: "memory-graph",
    nativeId,
    sourceId,
    title,
    ...backup.exportedAt ? { at: backup.exportedAt } : {}
  };
  out.push(started);
  const turnIdOf = (nodeId) => `${sid}#${nodeId}`;
  const kept = backup.nodes.filter((n) => !n.data.archived);
  const index = /* @__PURE__ */ new Map();
  kept.forEach((n, i) => index.set(n.id, i));
  for (const n of kept) {
    const d = n.data;
    const tid = turnIdOf(n.id);
    const i = index.get(n.id) ?? 0;
    const at = d.createdAt ?? d.lastGeneratedAt;
    const base = { sessionId: sid, turnId: tid, turnIndex: i, ...at ? { at } : {} };
    const mirror = d.importSource ? { sessionId: sessionKey(d.importSource.runner, d.importSource.sessionId), item: d.importSource.itemIds[0] ?? n.id } : void 0;
    const isMaterial = d.stepKind === "file" || d.stepKind === "link" || d.stepKind === "frame";
    const isNote = d.stepKind === "note";
    const ts = {
      id: `${tid}/turn`,
      kind: "turn.started",
      ...base,
      source: src(n.id),
      ...OBS_FULL3,
      humanAuthored: !isMaterial,
      ...mirror ? { mirrorOf: mirror } : {}
    };
    out.push(ts);
    if (isMaterial) {
      const held = (d.attachments ?? []).filter((a) => !a.name.startsWith("tool: ")).map((a) => a.name);
      texts.set(tid, { question: held.length ? `[${d.stepKind}] ${held.join(", ")}` : `[${d.stepKind}] ${clip4(d.question ?? "", 80)}`, response: "" });
    }
    if (!mirror && !isMaterial) {
      texts.set(tid, { question: d.question ?? "", response: d.response ?? "" });
      if (d.question?.trim()) {
        const m = {
          id: `${tid}/q`,
          kind: "message.recorded",
          ...base,
          source: src(`${n.id}:question`),
          ...OBS_FULL3,
          role: isNote ? "custom" : "user",
          actor: "human",
          modelVisible: true,
          excerpt: clip4(d.question),
          length: d.question.length
        };
        out.push(m);
      }
      if (d.response?.trim() && !isNote) {
        const model = d.generatedBy?.[d.responseIndex ?? 0] ?? void 0;
        const a = {
          id: `${tid}/a`,
          kind: "message.recorded",
          ...base,
          source: src(`${n.id}:response`),
          ...OBS_FULL3,
          ...d.lastGeneratedAt ? { at: d.lastGeneratedAt } : {},
          role: "assistant",
          actor: model ? "model" : "unknown",
          modelVisible: true,
          excerpt: clip4(d.response),
          length: d.response.length
        };
        out.push(a);
      }
    }
    if (mirror && d.source) {
      for (const field of ["question", "response"]) {
        const now = d[field] ?? "";
        const was = d.source[field] ?? "";
        if (now !== was) {
          const e = {
            id: `${tid}/edit:${field}`,
            kind: "record.edited",
            ...base,
            source: src(`${n.id}:${field}`),
            ...OBS_FULL3,
            field,
            excerpt: clip4(now),
            length: now.length
          };
          out.push(e);
        }
      }
    }
    for (const h of d.highlights ?? []) {
      const visible = d.highlightMode === "filter" || d.highlightMode === "tag";
      const m = {
        id: `${tid}/hl:${h.id}`,
        kind: "message.recorded",
        ...base,
        ...h.at ? { at: h.at } : {},
        source: src(`${n.id}:highlight:${h.id}`),
        ...OBS_FULL3,
        role: "custom",
        actor: "human",
        modelVisible: visible,
        excerpt: clip4(h.text),
        length: h.text.length
      };
      out.push(m);
    }
    const excluded = new Set(d.excludedAttachmentIds ?? []);
    for (const att of d.attachments ?? []) {
      if (att.name.startsWith("tool: ") || att.op) continue;
      const artifact = {
        id: `memory-graph:attachment/${att.id}`,
        observedPath: att.name,
        ...d.anchor && d.anchor.attId === att.id ? { locator: { pages: String(d.anchor.page) } } : {}
      };
      const e = {
        id: `${tid}/att:${att.id}`,
        kind: "artifact.attached",
        ...base,
        ...att.addedAt ? { at: att.addedAt } : {},
        source: src(`${n.id}:attachment:${att.id}`),
        ...OBS_FULL3,
        artifact,
        via: "attachment",
        mediaType: att.type,
        inContext: !excluded.has(att.id)
      };
      out.push(e);
    }
    if (d.anchor?.attId && !(d.attachments ?? []).some((a) => a.id === d.anchor?.attId)) {
      const e = {
        id: `${tid}/anchor`,
        kind: "artifact.attached",
        ...base,
        source: src(`${n.id}:anchor`),
        ...OBS_FULL3,
        artifact: { id: `memory-graph:attachment/${d.anchor.attId}`, locator: { pages: String(d.anchor.page) } },
        via: "anchor",
        inContext: "unknown"
      };
      out.push(e);
    }
    for (const [k, r] of (d.references ?? []).entries()) {
      const a = r.url ? urlArtifact(r.url) : null;
      if (!a) continue;
      const e = {
        id: `${tid}/ref:${k}`,
        kind: "artifact.attached",
        ...base,
        source: src(`${n.id}:reference:${k}`),
        ...OBS_FULL3,
        artifact: a,
        via: "reference",
        inContext: "unknown"
      };
      out.push(e);
    }
    const material = (d.attachments ?? []).filter((a) => !a.name.startsWith("tool: ") && !a.op && typeof a.extractedText === "string" && a.extractedText.trim()).map((a) => `[${a.name}]
${a.extractedText.slice(0, 4e3)}`).join("\n\n");
    if (material) {
      const prev = texts.get(tid) ?? { question: "", response: "" };
      texts.set(tid, { ...prev, material });
    }
    if (d.lastContextHash && !mirror) {
      const c = {
        id: `${tid}/ctx:upstream`,
        kind: "context.committed",
        ...base,
        ...d.lastGeneratedAt ? { at: d.lastGeneratedAt } : {},
        source: src(`${n.id}:lastContextHash`),
        ...OBS_PART3,
        requestId: `${n.id}@${d.lastGeneratedAt ?? "unknown"}`,
        members: [],
        contentHash: d.lastContextHash,
        hashOf: "upstream",
        decidedBy: "user",
        confirmed: true
      };
      out.push(c);
    }
  }
  for (const e of backup.edges) {
    if (!index.has(e.source) || !index.has(e.target)) continue;
    const ev = {
      id: `${sid}/edge:${e.id}`,
      kind: "edge.recorded",
      sessionId: sid,
      source: src(e.id),
      ...OBS_FULL3,
      edgeType: "context",
      via: e.data?.isCrossLink ? "reference" : "mainline",
      fromTurnId: turnIdOf(e.source),
      toTurnId: turnIdOf(e.target)
    };
    out.push(ev);
  }
  for (const ev of backup.events ?? []) {
    if (ev.op !== "commit" || !ev.id || !ev.d || !index.has(ev.id)) continue;
    const sha = typeof ev.d.sha === "string" ? ev.d.sha : "";
    if (!sha) continue;
    const kind = ev.d.kind === "bundle" ? "bundle" : "request";
    const members = typeof ev.d.m === "string" && ev.d.m ? ev.d.m.split(",").filter(Boolean).map((nodeId) => ({ nodeId })) : [];
    const truncated = ev.d.more === true;
    const c = {
      id: `${sid}/commit:${ev.id}@${ev.t}${kind === "bundle" ? ":bundle" : ""}`,
      kind: "context.committed",
      sessionId: sid,
      turnId: turnIdOf(ev.id),
      turnIndex: index.get(ev.id) ?? 0,
      at: ev.t,
      source: src(`event:commit:${ev.id}@${ev.t}`),
      basis: "observed",
      completeness: truncated || !members.length ? "partial" : "full",
      requestId: typeof ev.d.bundle === "string" ? ev.d.bundle : `${ev.id}@${ev.t}`,
      members,
      contentHash: sha.startsWith("sha256:") ? sha : `sha256:${sha}`,
      hashOf: kind,
      ...typeof ev.d.n === "number" ? { messageCount: ev.d.n } : {},
      ...typeof ev.d.model === "string" && ev.d.model ? { model: ev.d.model } : {},
      decidedBy: "user",
      confirmed: true
    };
    out.push(c);
  }
  return { sessionId: sid, nativeId, title, events: out, texts };
}

// ../cli/src/lib.ts
var readLike = (op) => op === "read" || op === "fetch" || op === "attach";
var INDEX_VERSION = 14;
var EXCERPT = 200;
var HOME = process.env.YU_MEMORY_GRAPH_HOME ?? path.join(os.homedir(), ".memory-graph");
var FACT_FILE = path.join(HOME, "fact-index.json");
var CACHE_FILE = path.join(HOME, "interpretation-cache.json");
var TEXT_FILE = path.join(HOME, "text-index.json");
var TEXT_LINES = path.join(HOME, "text-index.jsonl");
var LEGACY_FILE = path.join(HOME, "why-index.json");
var CONFIG_FILE = path.join(HOME, "config.json");
var DSH_ROOT = path.join(process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh"), "sessions");
var PI_ROOT = path.join(os.homedir(), ".pi", "agent", "sessions");
var ROOTS = process.env.YU_MEMORY_GRAPH_SESSION_ROOTS?.split(path.delimiter).filter(Boolean) ?? [path.join(os.homedir(), ".claude", "projects"), path.join(os.homedir(), ".codex", "sessions"), DSH_ROOT, PI_ROOT];
var MEMORY_ROOTS = (() => {
  const env = process.env.YU_MEMORY_GRAPH_MEMORY_ROOTS;
  if (env !== void 0) {
    return env.split(path.delimiter).filter(Boolean).flatMap((e) => {
      const m = /^(claude-code|codex)=(.+)$/.exec(e);
      return m ? [{ runner: m[1], root: m[2] }] : [];
    });
  }
  if (process.env.YU_MEMORY_GRAPH_SESSION_ROOTS) return [];
  return [
    { runner: "claude-code", root: path.join(os.homedir(), ".claude", "projects") },
    { runner: "codex", root: path.join(os.homedir(), ".codex", "memories") }
  ];
})();
var isMemoryFile = (file, runner) => {
  if (!file.endsWith(".md")) return false;
  if (runner === "claude-code") return path.basename(path.dirname(file)) === "memory" && path.basename(file) !== "MEMORY.md";
  return true;
};
var CANVAS_RECORDS = path.join(HOME, "canvases");
async function canvasRoots() {
  const env = process.env.YU_MEMORY_GRAPH_CANVAS_ROOTS?.split(path.delimiter).filter(Boolean);
  if (env) return [CANVAS_RECORDS, ...env];
  try {
    const c = JSON.parse(await fsp.readFile(CONFIG_FILE, "utf8"));
    return [CANVAS_RECORDS, ...c.canvasRoots ?? []];
  } catch {
    return [CANVAS_RECORDS];
  }
}
async function rememberCanvasRoot(dir) {
  const roots = await canvasRoots();
  const abs = path.resolve(dir);
  if (!roots.includes(abs)) await writePrivate(CONFIG_FILE, { canvasRoots: [...roots, abs] });
}
var isCanvasFile = (name) => /\.memory-graph\.json$/i.test(name);
var isSessionFile = (name) => name.endsWith(".jsonl") || name.endsWith(".jsonl.zstd");
async function walk(dir, depth, out, accept) {
  if (depth > 5) return;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) await walk(p, depth + 1, out, accept);
    else if (ent.isFile() && accept(ent.name)) {
      try {
        const st = await fsp.stat(p);
        out.push({ file: p, mtime: st.mtimeMs, size: st.size });
      } catch {
      }
    }
  }
}
async function listSources() {
  const files = [];
  for (const root of ROOTS) await walk(root, 0, files, isSessionFile);
  for (const root of await canvasRoots()) await walk(root, 0, files, isCanvasFile);
  for (const { runner, root } of MEMORY_ROOTS) {
    const md = [];
    await walk(root, 0, md, (name) => name.endsWith(".md"));
    for (const m of md) if (isMemoryFile(m.file, runner)) files.push({ ...m, memory: runner });
  }
  return files;
}
async function firstLine(file) {
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8", highWaterMark: 65536 }) });
  for await (const line of rl) {
    rl.close();
    return line;
  }
  return "";
}
async function realOr(p) {
  try {
    return await fsp.realpath(p);
  } catch {
    return p;
  }
}
async function canonicalPath(p, memo) {
  const hit = memo?.get(p);
  if (hit) return hit;
  let out;
  try {
    out = await fsp.realpath(p);
  } catch {
    const parent = path.dirname(p);
    out = parent === p ? p : path.join(await canonicalPath(parent, memo), path.basename(p));
  }
  memo?.set(p, out);
  return out;
}
async function workspaceOf(dir) {
  let cur = await realOr(dir);
  for (; ; ) {
    try {
      await fsp.stat(path.join(cur, ".git"));
      return cur;
    } catch {
    }
    const up = path.dirname(cur);
    if (up === cur) return await realOr(dir);
    cur = up;
  }
}
var strongest = (a, b) => a === "edit" || a === "write" ? a : b;
async function canonicalArtifact(id, memo) {
  const p = filePathOf(id);
  return p ? fileUri(await canonicalPath(p, memo)) : id;
}
function mentionKey(id) {
  const p = filePathOf(id);
  if (p) return path.basename(p);
  if (id.startsWith("arxiv:")) return id.slice("arxiv:".length);
  try {
    const u = new URL(id);
    return u.pathname.split("/").filter(Boolean).pop() ?? u.hostname;
  } catch {
    return id;
  }
}
async function displayOf(id, names = {}) {
  const p = filePathOf(id);
  if (!p) return names[id] ? `${names[id]}  (${id})` : id;
  const rel = path.relative(await realOr(process.cwd()), await realOr(p));
  return rel.startsWith("..") || path.isAbsolute(rel) ? p : rel;
}
var clipLine = (s, max) => {
  const l = s.trim();
  return l.length > max ? `${l.slice(0, max)}\u2026` : l;
};
function mentionOf(response, key) {
  const base = key.toLowerCase();
  if (base.length < 4) return void 0;
  const paras = response.replace(/```[\s\S]*?```/g, "").split(/\n\s*\n/).map((p) => p.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#*`>|_~]/g, "").replace(/\s+/g, " ").trim()).filter((p) => p.length > 12 && p.toLowerCase().includes(base) && !/[:：]$/.test(p) && !/^(sources?|references?|来源|参考)\b/i.test(p));
  const last = paras[paras.length - 1];
  return last ? clipLine(last, 240) : void 0;
}
function questionExcerpt(text) {
  const cmd = text.match(/<command-name>([^<]+)<\/command-name>/);
  const line = (cmd ? cmd[1] : text).split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("<")) ?? "";
  return clipLine(line, EXCERPT);
}
var zstdInflate = zlib.zstdDecompressSync;
var ZSTD_MAX = 512 * 1024 * 1024;
var zstdSkipped = 0;
async function eventsOf(file, sourceId) {
  if (isCanvasFile(file)) {
    let parsed;
    try {
      parsed = JSON.parse(await fsp.readFile(file, "utf8"));
    } catch {
      return null;
    }
    if (!isCanvasBackup(parsed)) return null;
    const c = canvasToEvents(parsed, { file, sourceId });
    return { runner: "memory-graph", nativeId: c.nativeId, title: c.title, events: c.events, texts: c.texts, manifest: MANIFESTS.memory-graph };
  }
  let meta = {};
  let lines;
  if (file.endsWith(".zstd")) {
    if (!zstdInflate) {
      zstdSkipped++;
      return null;
    }
    let raw;
    try {
      raw = await fsp.readFile(file);
    } catch {
      return null;
    }
    if (raw.length > ZSTD_MAX) return null;
    let text;
    try {
      text = Buffer.from(decompressZstdFrames(raw, zstdInflate)).toString("utf8");
    } catch {
      return null;
    }
    const arr = text.split("\n");
    try {
      meta = JSON.parse(arr[0] ?? "");
    } catch {
    }
    lines = arr;
  } else {
    try {
      meta = JSON.parse(await firstLine(file));
    } catch {
    }
    lines = createInterface({ input: createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 20 }) });
  }
  const runner = meta.type === "session_meta" ? "codex" : meta.type === "session" && typeof meta.id === "string" ? typeof meta.timestamp === "string" ? "pi" : "dsh" : "claude-code";
  const collector = runner === "codex" ? new CodexSessionCollector() : runner === "dsh" ? new DshSessionCollector() : runner === "pi" ? new PiSessionCollector() : new ClaudeSessionCollector();
  for await (const line of lines) collector.feedLine(line);
  const s = collector.finish();
  if (!s) return null;
  const subagent = "subagent" in s ? !!s.subagent : runner === "claude-code" && /\/subagents\//.test(file);
  const cwd = "cwd" in s && s.cwd ? s.cwd : void 0;
  const session = {
    runner,
    nativeId: s.sessionId,
    title: s.title,
    file,
    ...sourceId ? { sourceId } : {},
    schema: MANIFESTS[runner].schema,
    ...cwd ? { cwd } : {},
    ...subagent ? { subagent } : {},
    turns: s.turns
  };
  const events = sessionToEvents(session);
  const texts = /* @__PURE__ */ new Map();
  for (const e of events) if (e.kind === "turn.started") {
    const t = s.turns[e.turnIndex];
    if (t) texts.set(e.turnId, { question: t.question, response: t.response });
  }
  const started = events.find((e) => e.kind === "session.started");
  const anchor = started?.anchor ? { project: started.anchor.project, node: started.anchor.node, bundle: started.anchor.bundle } : void 0;
  return { runner, nativeId: s.sessionId, title: s.title, ...anchor ? { anchor } : {}, ...cwd ? { cwd } : {}, ...subagent ? { subagent } : {}, events, texts, manifest: MANIFESTS[runner], turns: s.turns };
}
async function parseSession(f) {
  if (f.memory) return parseMemory(f, f.memory);
  const memo = /* @__PURE__ */ new Map();
  const sourceId = await canonicalPath(f.file, memo);
  const p = await eventsOf(f.file, sourceId);
  if (!p) return null;
  const cwd = p.cwd ? await canonicalPath(p.cwd, memo) : "";
  const workspace = cwd ? await workspaceOf(cwd) : "";
  const names = {};
  const opsByTurn = /* @__PURE__ */ new Map();
  for (const t of deriveTouches(p.events)) {
    const id = await canonicalArtifact(t.artifact, memo);
    const ops = opsByTurn.get(t.turnId) ?? opsByTurn.set(t.turnId, {}).get(t.turnId);
    const prev = ops[id];
    const d = prev?.d ?? t.change;
    const l = [...prev?.l ?? [], ...t.locators ?? []].filter((x, i, arr) => arr.findIndex((y) => JSON.stringify(y) === JSON.stringify(x)) === i);
    ops[id] = { op: strongest(prev?.op, t.op), ...d ? { d } : {}, ...l.length ? { l } : {} };
  }
  for (const e of p.events) if (e.kind === "artifact.attached" && e.artifact.observedPath && !e.artifact.id.startsWith("file://")) names[e.artifact.id] = e.artifact.observedPath;
  const bundles = {};
  for (const e of p.events) if (e.kind === "context.committed" && e.hashOf === "bundle" && e.turnId) bundles[e.requestId] = { canvas: p.nativeId, node: e.turnId.split("#").pop() ?? "" };
  const questions = /* @__PURE__ */ new Map();
  for (const e of p.events) if (e.kind === "message.recorded" && e.role === "user" && !questions.has(e.turnId)) questions.set(e.turnId, e.excerpt);
  const turns = [];
  const cache = {};
  const text_ = {};
  let lastSubstantive = "";
  const starts = p.events.filter((e) => e.kind === "turn.started").sort((a, b) => a.turnIndex - b.turnIndex);
  for (const ts of starts) {
    const text = p.texts.get(ts.turnId);
    const q = text ? questionExcerpt(text.question) : questions.get(ts.turnId) ?? (ts.mirrorOf ? "(mirrored turn)" : "");
    const item = ts.mirrorOf?.item ?? (p.runner === "memory-graph" ? ts.turnId : ts.turnId.split("#").pop());
    turns.push({ i: ts.turnIndex, t: ts.turnId, ...item ? { item } : {}, ...ts.at ? { at: ts.at } : {}, q, ops: opsByTurn.get(ts.turnId) ?? {} });
    if (!text) continue;
    if (text.question.trim() || text.response.trim() || text.material?.trim()) {
      text_[String(ts.turnIndex)] = { q: text.question, a: text.response, ...text.material ? { m: text.material } : {} };
    }
    const entry = {};
    const con = conclusionOf(text.response, 240);
    if (con) entry.c = con;
    if (q.length < 12 && lastSubstantive) entry.p = lastSubstantive;
    if (q.length >= 12) lastSubstantive = q;
    for (const id of Object.keys(opsByTurn.get(ts.turnId) ?? {})) {
      const m = mentionOf(text.response, mentionKey(names[id] ? `file://${names[id]}` : id));
      if (m) (entry.m ??= {})[id] = m;
    }
    if (Object.keys(entry).length) cache[String(ts.turnIndex)] = entry;
  }
  return {
    fact: { id: p.nativeId, runner: p.runner, file: f.file, mtime: f.mtime, size: f.size, cwd, workspace, title: p.title, ...p.subagent ? { subagent: true } : {}, ...p.anchor ? { anchor: p.anchor } : {}, turns },
    cache,
    text: text_,
    names,
    bundles
  };
}
function frontmatterOf(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^\s*([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv && kv[2].trim()) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: text.slice(m[0].length) };
}
function sectionsOf(text, level) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let cur = null;
  const isBoundary = (line) => {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    return m && m[1].length <= level ? m[1].length : null;
  };
  for (const line of lines) {
    const lvl = isBoundary(line);
    if (lvl === level) {
      if (cur) out.push({ heading: cur.heading, body: cur.body.join("\n").trim() });
      cur = { heading: line.replace(/^#+\s+/, "").trim(), body: [] };
      continue;
    }
    if (lvl !== null && lvl < level) {
      if (cur) out.push({ heading: cur.heading, body: cur.body.join("\n").trim() });
      cur = null;
      continue;
    }
    if (cur) cur.body.push(line);
  }
  if (cur) out.push({ heading: cur.heading, body: cur.body.join("\n").trim() });
  return out;
}
var metaLine = (body, key) => {
  const m = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(body);
  return m ? m[1].trim() : void 0;
};
var claudeCwdMemo = /* @__PURE__ */ new Map();
function claudeProjectCwd(projectDir) {
  let p = claudeCwdMemo.get(projectDir);
  if (!p) {
    p = (async () => {
      let entries = [];
      try {
        entries = (await fsp.readdir(projectDir)).filter((n) => n.endsWith(".jsonl")).sort();
      } catch {
        return "";
      }
      for (const n of entries) {
        try {
          const o = JSON.parse(await firstLine(path.join(projectDir, n)));
          if (typeof o.cwd === "string" && o.cwd) return o.cwd;
        } catch {
        }
      }
      return "";
    })();
    claudeCwdMemo.set(projectDir, p);
  }
  return p;
}
async function memoryFile(file, runner) {
  let text;
  try {
    text = await fsp.readFile(file, "utf8");
  } catch {
    return null;
  }
  const base = path.basename(file);
  if (runner === "claude-code") {
    const projectDir = path.dirname(path.dirname(file));
    const cwd = await claudeProjectCwd(projectDir);
    const { meta, body } = frontmatterOf(text);
    const heading = meta.description || meta.name || base.replace(/\.md$/, "");
    const project = path.basename(cwd || projectDir);
    return { title: `memory \xB7 ${project} \xB7 ${base.replace(/\.md$/, "")}`, cwd, units: body.trim() ? [{ heading, body: body.trim() }] : [] };
  }
  if (base === "MEMORY.md") {
    const units = [];
    for (const g of sectionsOf(text, 1)) {
      const cwd = /cwd=([^;\n]+)/.exec(metaLine(g.body, "applies_to") ?? "")?.[1]?.trim();
      const subs2 = sectionsOf(g.body, 2);
      if (!subs2.length) {
        units.push({ heading: g.heading, body: g.body, ...cwd ? { cwd } : {} });
        continue;
      }
      for (const u of subs2) units.push({ heading: `${g.heading} \u203A ${u.heading}`, body: u.body, ...cwd ? { cwd } : {} });
    }
    return { title: "memory \xB7 Codex \xB7 MEMORY.md", cwd: "", units };
  }
  if (base === "raw_memories.md") {
    const units = sectionsOf(text, 2).map((u) => {
      const cwd = metaLine(u.body, "cwd");
      const at = metaLine(u.body, "updated_at");
      const heading = cwd ? `${u.heading} \xB7 ${path.basename(cwd)}` : u.heading;
      return { heading, body: u.body, ...cwd ? { cwd } : {}, ...at ? { at: new Date(at).toISOString() } : {} };
    });
    return { title: "memory \xB7 Codex \xB7 raw_memories.md", cwd: "", units };
  }
  const subs = sectionsOf(text, 2);
  if (subs.length) return { title: `memory \xB7 Codex \xB7 ${base}`, cwd: "", units: subs };
  const h1 = sectionsOf(text, 1)[0];
  return { title: `memory \xB7 Codex \xB7 ${base}`, cwd: "", units: text.trim() ? [{ heading: h1?.heading ?? base, body: text.trim() }] : [] };
}
var shortHash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 12);
async function parseMemory(f, runner) {
  const mf = await memoryFile(f.file, runner);
  if (!mf || !mf.units.length) return null;
  const memo = /* @__PURE__ */ new Map();
  const cwd = mf.cwd ? await canonicalPath(mf.cwd, memo) : "";
  const workspace = cwd ? await workspaceOf(cwd) : "";
  const at = new Date(f.mtime).toISOString();
  const turns = [];
  const text = {};
  for (const [i, u] of mf.units.entries()) {
    const unitCwd = u.cwd ? await canonicalPath(u.cwd, memo) : "";
    turns.push({ i, t: `memory#${i}`, at: u.at ?? at, q: questionExcerpt(u.heading), ops: {}, ...unitCwd && unitCwd !== cwd ? { cwd: unitCwd } : {} });
    text[String(i)] = { q: u.heading, a: u.body };
  }
  const id = `mem-${runner === "codex" ? "cx" : "cc"}-${shortHash(await canonicalPath(f.file, memo))}`;
  return {
    fact: { id, runner, kind: "memory", file: f.file, mtime: f.mtime, size: f.size, cwd, workspace, title: mf.title, turns },
    cache: {},
    text,
    names: {},
    bundles: {}
  };
}
var emptyFacts = () => ({ version: INDEX_VERSION, builtAt: "", sessions: {}, skipped: {}, names: {}, bundles: {} });
var emptyCache = () => ({ version: INDEX_VERSION, sessions: {} });
var emptyText = () => ({ version: INDEX_VERSION, sessions: {} });
async function readJson(file, empty) {
  try {
    const v = JSON.parse(await fsp.readFile(file, "utf8"));
    return v.version === INDEX_VERSION ? v : empty();
  } catch {
    return empty();
  }
}
var tmpFor = (file) => `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
var LOCK_FILE = path.join(HOME, "index.lock");
var LOCK_STALE_MS = 10 * 6e4;
async function acquireLock(file = LOCK_FILE, staleMs = LOCK_STALE_MS) {
  await fsp.mkdir(HOME, { recursive: true, mode: 448 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await fsp.open(file, "wx", 384);
      await fh.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
      await fh.close();
      return async () => {
        await fsp.rm(file, { force: true }).catch(() => void 0);
      };
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let holder = {};
      try {
        holder = JSON.parse(await fsp.readFile(file, "utf8"));
      } catch {
      }
      const alive = (() => {
        if (!holder.pid) return false;
        try {
          process.kill(holder.pid, 0);
          return true;
        } catch {
          return false;
        }
      })();
      const stale = !alive || !holder.at || Date.now() - holder.at > staleMs;
      if (!stale) return null;
      await fsp.rm(file, { force: true }).catch(() => void 0);
    }
  }
  return null;
}
async function waitForLock(maxMs = 2e4) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      await fsp.access(LOCK_FILE);
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}
async function writePrivate(file, data) {
  await fsp.mkdir(HOME, { recursive: true, mode: 448 });
  await fsp.chmod(HOME, 448).catch(() => void 0);
  const tmp = tmpFor(file);
  await fsp.writeFile(tmp, JSON.stringify(data), { mode: 384 });
  await fsp.chmod(tmp, 384).catch(() => void 0);
  await fsp.rename(tmp, file);
}
var loadFacts = async () => {
  const f = await readJson(FACT_FILE, emptyFacts);
  f.skipped ??= {};
  f.sessions ??= {};
  f.names ??= {};
  f.bundles ??= {};
  return f;
};
var loadCache = () => readJson(CACHE_FILE, emptyCache);
var loadText = () => readJson(TEXT_FILE, emptyText);
async function rewriteTextLines(replaced, removed, full) {
  await fsp.mkdir(HOME, { recursive: true, mode: 448 });
  const tmp = tmpFor(TEXT_LINES);
  const out = createWriteStream(tmp, { mode: 384 });
  const write = (line) => new Promise((res, rej) => {
    out.write(line + "\n", (e) => e ? rej(e) : res());
  });
  if (!full) {
    let old = null;
    try {
      await fsp.access(TEXT_LINES);
      old = createInterface({ input: createReadStream(TEXT_LINES, { encoding: "utf8", highWaterMark: 1 << 20 }) });
    } catch {
    }
    if (old) {
      for await (const line of old) {
        const at = line.indexOf('"k":"');
        if (at < 0) continue;
        const k = JSON.parse(line.slice(at + 4, line.indexOf('"', at + 5) + 1));
        if (replaced.has(k) || removed.has(k)) continue;
        await write(line);
      }
    }
  }
  for (const [k, turns] of replaced) {
    for (const [i, t] of Object.entries(turns)) await write(JSON.stringify({ k, i: Number(i), ...t }));
  }
  await new Promise((res, rej) => out.end((e) => e ? rej(e) : res()));
  await fsp.chmod(tmp, 384).catch(() => void 0);
  await fsp.rename(tmp, TEXT_LINES);
}
async function buildIndex(full, canvasDir) {
  const t0 = Date.now();
  if (canvasDir) await rememberCanvasRoot(canvasDir);
  const release = await acquireLock();
  if (!release) {
    const done = await waitForLock();
    return { parsed: 0, kept: 0, skipped: 0, removed: 0, seconds: (Date.now() - t0) / 1e3, waited: done };
  }
  try {
    return await buildIndexLocked(full, t0);
  } finally {
    await release();
  }
}
async function buildIndexLocked(full, t0) {
  await fsp.rm(LEGACY_FILE, { force: true }).catch(() => void 0);
  const facts = full ? emptyFacts() : await loadFacts();
  const cache = full ? emptyCache() : await loadCache();
  const text = full ? emptyText() : await loadText();
  const files = await listSources();
  let parsed = 0, kept = 0, skipped = 0, removed = 0;
  const seen = /* @__PURE__ */ new Set();
  const replacedText = /* @__PURE__ */ new Map();
  const removedKeys = /* @__PURE__ */ new Set();
  for (const f of files) {
    const key = await canonicalPath(f.file);
    seen.add(key);
    const prev = facts.sessions[key];
    const sk = facts.skipped[key];
    if (sk && sk.mtime === f.mtime && sk.size === f.size) {
      skipped++;
      continue;
    }
    if (prev && prev.mtime === f.mtime && prev.size === f.size && key in cache.sessions && key in text.sessions) {
      kept++;
      continue;
    }
    const r = await parseSession(f).catch(() => null);
    if (!r) {
      facts.skipped[key] = { mtime: f.mtime, size: f.size };
      skipped++;
      continue;
    }
    delete facts.skipped[key];
    facts.sessions[key] = r.fact;
    cache.sessions[key] = r.cache;
    replacedText.set(key, r.text);
    text.sessions[key] = Object.keys(r.text).length;
    Object.assign(facts.names, r.names);
    Object.assign(facts.bundles, r.bundles);
    parsed++;
  }
  for (const key of Object.keys(facts.sessions)) {
    if (!seen.has(key)) {
      delete facts.sessions[key];
      delete cache.sessions[key];
      delete text.sessions[key];
      removedKeys.add(key);
      removed++;
    }
  }
  for (const key of Object.keys(facts.skipped)) if (!seen.has(key)) delete facts.skipped[key];
  facts.builtAt = (/* @__PURE__ */ new Date()).toISOString();
  await writePrivate(FACT_FILE, facts);
  await writePrivate(CACHE_FILE, cache);
  if (full || replacedText.size || removedKeys.size) await rewriteTextLines(replacedText, removedKeys, full);
  await writePrivate(TEXT_FILE, text);
  return { parsed, kept, skipped, removed, seconds: (Date.now() - t0) / 1e3 };
}
var quiet = false;
function setQuiet(v) {
  quiet = v;
}
async function ensureFresh() {
  const facts = await loadFacts();
  const cache = await loadCache();
  const text = await loadText();
  const files = await listSources();
  const keyed = await Promise.all(files.map(async (f) => ({ ...f, key: await canonicalPath(f.file) })));
  const known = (f) => {
    const p = facts.sessions[f.key];
    if (p) return p.mtime === f.mtime && p.size === f.size && f.key in cache.sessions && f.key in text.sessions;
    const sk = facts.skipped[f.key];
    return !!sk && sk.mtime === f.mtime && sk.size === f.size;
  };
  const stale = !facts.builtAt || keyed.some((f) => !known(f)) || Object.keys(facts.sessions).length + Object.keys(facts.skipped).length !== keyed.length;
  if (!stale) return facts;
  const r = await buildIndex(false);
  if (!quiet) {
    if (r.waited !== void 0) console.error(r.waited ? "(index refreshed by another process)" : "(index refresh in progress elsewhere; answering from the current index)");
    else console.error(`(index refreshed: ${r.parsed} session${r.parsed === 1 ? "" : "s"} re-read, ${r.removed} gone, ${r.seconds.toFixed(1)}s)`);
  }
  return loadFacts();
}
var schemeOf = (id) => id.startsWith("file://") ? "file" : id.startsWith("arxiv:") ? "arxiv" : /^https?:\/\//.test(id) ? "url" : "other";
var artifactsLine = (a) => [`${a.file} files`, a.url ? `${a.url} urls` : "", a.arxiv ? `${a.arxiv} papers` : "", a.other ? `${a.other} other` : ""].filter(Boolean).join(" \xB7 ");
function summarize(facts, cache) {
  const seen = /* @__PURE__ */ new Set();
  const artifacts = { file: 0, url: 0, arxiv: 0, other: 0 };
  let turns = 0, touches = 0, changes = 0, withChangeHead = 0, withMention = 0;
  for (const [key, s] of Object.entries(facts.sessions)) {
    turns += s.turns.length;
    for (const t of s.turns) {
      const ct = cache.sessions[key]?.[String(t.i)];
      for (const [p, x] of Object.entries(t.ops)) {
        if (!seen.has(p)) {
          seen.add(p);
          artifacts[schemeOf(p)]++;
        }
        touches++;
        if (!readLike(x.op)) {
          changes++;
          if (x.d) withChangeHead++;
        }
        if (ct?.m?.[p]) withMention++;
      }
    }
  }
  const sessions = new Set(Object.values(facts.sessions).map((s) => s.id)).size;
  const mem = Object.values(facts.sessions).filter((s) => s.kind === "memory");
  return { sessions, sources: Object.keys(facts.sessions).length, turns, artifacts, touches, changes, withChangeHead, withMention, memoryFiles: mem.length, memoryEntries: mem.reduce((n, s) => n + s.turns.length, 0) };
}
var allPaths = (facts) => {
  const all = /* @__PURE__ */ new Set();
  for (const s of Object.values(facts.sessions)) for (const t of s.turns) for (const p of Object.keys(t.ops)) all.add(p);
  return all;
};
async function resolveQuery(facts, rawArg, all) {
  const arg = rawArg.trim().replace(/^@/, "").replace(/^["'`]|["'`:]+$/g, "");
  const ids = allPaths(facts);
  const web = urlArtifact(arg) ?? arxivArtifact(arg);
  if (web) return ids.has(web.id) ? { path: web.id, candidates: [web.id], elsewhere: 0 } : { path: null, candidates: [], elsewhere: 0 };
  if (arg.startsWith("memory-graph:")) return ids.has(arg) ? { path: arg, candidates: [arg], elsewhere: 0 } : { path: null, candidates: [], elsewhere: 0 };
  const named = Object.entries(facts.names).filter(([, name]) => name === arg || name.endsWith(`/${arg}`)).map(([id]) => id);
  if (named.length === 1) return { path: named[0], candidates: named, elsewhere: 0 };
  const abs = absolutePath(arg, process.cwd());
  if (abs) {
    const typed = fileUri(abs);
    if (ids.has(typed)) return { path: typed, candidates: [typed], elsewhere: 0 };
    const real = fileUri(await canonicalPath(abs));
    if (ids.has(real)) return { path: real, candidates: [real], elsewhere: 0 };
  }
  const needle = arg.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  const files = [...ids].flatMap((id) => {
    const p = filePathOf(id);
    return p ? [{ id, p }] : [];
  });
  const bySuffix = files.filter(({ p }) => p === needle || p.endsWith(`/${needle}`));
  const ws = (await workspaceOf(process.cwd())).replace(/\\/g, "/");
  const inside = all ? bySuffix : bySuffix.filter(({ p }) => p.startsWith(`${ws}/`));
  if (inside.length === 1) return { path: inside[0].id, candidates: [inside[0].p], elsewhere: bySuffix.length - inside.length };
  return { path: null, candidates: inside.map((x) => x.p).sort(), elsewhere: bySuffix.length - inside.length };
}
function hitsFor(facts, artifact, includeRead) {
  const all = [];
  const seen = /* @__PURE__ */ new Set();
  const sources = Object.entries(facts.sessions).sort((a, b) => a[1].mtime - b[1].mtime);
  for (const [sourceKey, session] of sources) {
    for (const turn of session.turns) {
      const touch = turn.ops[artifact];
      if (!touch) continue;
      if (turn.item) {
        if (seen.has(turn.item)) continue;
        seen.add(turn.item);
      }
      all.push({ session, sourceKey, turn, touch });
    }
  }
  const hasChanges = all.some((h) => !readLike(h.touch.op));
  if (includeRead || !hasChanges) return { hits: all, readsHidden: 0 };
  const hits = all.filter((h) => !readLike(h.touch.op));
  return { hits, readsHidden: all.length - hits.length };
}
function anchorStatus(facts, a) {
  const b = facts.bundles[a.bundle];
  if (!b) return "unverified";
  return b.node === a.node ? "matched" : "mismatch";
}
function openLink(h) {
  if (h.session.kind === "memory") return `memory-graph://open?memory=${encodeURIComponent(h.session.file)}&entry=${h.turn.i}`;
  if (h.session.runner === "memory-graph") return `memory-graph://open?canvas=${encodeURIComponent(h.session.id)}&node=${encodeURIComponent(h.turn.t.split("#").pop() ?? "")}`;
  return `memory-graph://open?session=${h.session.id}${h.turn.item ? `&turn=${encodeURIComponent(h.turn.item)}` : ""}`;
}
var OP_MARK = { edit: "\u270F\uFE0F edit ", write: "\u270F\uFE0F write", read: "\u{1F4D6} read ", fetch: "\u{1F310} fetch", attach: "\u{1F4CE} attach" };
function when(t, s) {
  const d = new Date(t.at ?? s.mtime);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
var EVIDENCE = {
  footprint: "observed",
  change: "observed, partial (first differing line)",
  askedBefore: "inferred (the earlier question a bare reply answers)",
  about: "inferred (a paragraph of the answer naming the file)",
  conclusion: "inferred (the answer's closing paragraph)"
};
function fragmentsOf(facts, sessionId) {
  const frags = Object.entries(facts.sessions).filter(([, s]) => s.id === sessionId).sort((a, b) => a[1].mtime - b[1].mtime);
  let offset = 0;
  return frags.map(([key, s]) => {
    const f = { key, s, offset };
    offset += s.turns.length;
    return f;
  });
}
function turnNumber(facts, h) {
  return (fragmentsOf(facts, h.session.id).find((f) => f.key === h.sourceKey)?.offset ?? 0) + h.turn.i;
}
async function renderWhy(facts, file, hits, readsHidden, cache, limit, json) {
  const out = [];
  const bySession = /* @__PURE__ */ new Map();
  for (const h of hits) (bySession.get(h.session.id) ?? bySession.set(h.session.id, []).get(h.session.id)).push(h);
  const groups = [...bySession.values()].map((hs) => hs.sort((a, b) => a.turn.i - b.turn.i)).sort((a, b) => (b[b.length - 1].turn.at ?? "").localeCompare(a[a.length - 1].turn.at ?? ""));
  const shown = /* @__PURE__ */ new Set();
  for (const g of groups) for (const h of g) if (shown.size < limit) shown.add(h);
  const interp = (h) => cache.sessions[h.sourceKey]?.[String(h.turn.i)] ?? {};
  if (json) {
    out.push(JSON.stringify({
      artifact: file,
      file: filePathOf(file),
      turns: hits.length,
      sessions: bySession.size,
      readsHidden,
      evidence: EVIDENCE,
      hits: [...shown].map((h) => {
        const c = interp(h);
        return {
          session: h.session.id,
          runner: h.session.runner,
          title: h.session.title,
          subagent: !!h.session.subagent,
          anchor: h.session.anchor ? { ...h.session.anchor, status: anchorStatus(facts, h.session.anchor) } : null,
          turn: turnNumber(facts, h),
          at: h.turn.at ?? null,
          op: h.touch.op,
          locators: h.touch.l ?? null,
          question: h.turn.q,
          askedBefore: c.p ?? null,
          change: h.touch.d ?? null,
          about: c.m?.[file] ?? null,
          conclusion: c.c ?? null,
          open: openLink(h)
        };
      })
    }, null, 1));
    return out.join("\n");
  }
  const label = await displayOf(file, facts.names);
  const n = hits.length;
  const head = `why ${label}  \xB7  ${n} turn${n === 1 ? "" : "s"} in ${bySession.size} session${bySession.size === 1 ? "" : "s"}`;
  const notes = [
    readsHidden ? `${readsHidden} read${readsHidden === 1 ? "" : "s"} hidden, --include-read` : "",
    n > limit ? `showing ${limit}, --limit for more` : ""
  ].filter(Boolean);
  out.push(`${head}${notes.length ? `  (${notes.join("; ")})` : ""}
`);
  let printed = 0;
  for (const g of groups) {
    const mine = g.filter((h) => shown.has(h));
    if (!mine.length) continue;
    const s = g[0].session;
    out.push(`${s.runner}  \u300C${s.title.slice(0, 70)}\u300D${s.subagent ? "  (subagent)" : ""}${s.anchor ? `  \u21A9 from canvas node ${s.anchor.node} (${s.anchor.bundle}, ${anchorStatus(facts, s.anchor)})` : ""}`);
    for (const h of mine) {
      const c = interp(h);
      const where = h.touch.l?.map((l) => l.pages ? `p.${l.pages}` : l.lines ? `L${l.lines[0]}-${l.lines[1]}` : "").filter(Boolean).join(" ");
      out.push(`  ${when(h.turn, s)}  ${OP_MARK[h.touch.op]}  #${turnNumber(facts, h)}${where ? `  ${where}` : ""}  ${openLink(h)}`);
      out.push(`    Q: ${h.turn.q}${c.p ? `   \u2934 ${c.p}` : ""}`);
      if (h.touch.d) out.push(`    \u0394 ${h.touch.d}`);
      const about = c.m?.[file];
      if (about) out.push(`    \u2248 ${about}`);
      else if (c.c) out.push(`    \u2248 ${c.c}   (closing line)`);
      printed++;
    }
    out.push("");
  }
  if (!printed) out.push("(no turns)\n");
  out.push("\u0394 observed change \xB7 \u2248 read from the answer, a candidate explanation, not a verified reason \xB7 \u2934 the earlier question this reply answers");
  return out.join("\n");
}
function snippetAround(text, needle, width = 70) {
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return "";
  const start = Math.max(0, at - width);
  const end = Math.min(text.length, at + needle.length + width);
  return `${start > 0 ? "\u2026" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "\u2026" : ""}`;
}
async function findHits(facts, phrase, scope) {
  const needle = phrase.toLowerCase();
  const turnsOf = /* @__PURE__ */ new Map();
  const lookup = (k, i) => {
    let m = turnsOf.get(k);
    if (!m) {
      m = new Map(facts.sessions[k]?.turns.map((t) => [t.i, t]) ?? []);
      turnsOf.set(k, m);
    }
    return m.get(i);
  };
  const raw = [];
  let lines = null;
  try {
    await fsp.access(TEXT_LINES);
    lines = createInterface({ input: createReadStream(TEXT_LINES, { encoding: "utf8", highWaterMark: 1 << 20 }) });
  } catch {
    return [];
  }
  for await (const line of lines) {
    if (!line.toLowerCase().includes(needle)) continue;
    let t;
    try {
      t = JSON.parse(line);
    } catch {
      continue;
    }
    const session = facts.sessions[t.k];
    const turn = lookup(t.k, t.i);
    if (!session || !turn) continue;
    const fields = [["Q", t.q], ["A", t.a], ["M", t.m]];
    for (const [where, body] of fields) {
      if (!body) continue;
      if (scope !== "all" && where.toLowerCase() !== scope) continue;
      if (!body.toLowerCase().includes(needle)) continue;
      raw.push({ session, sourceKey: t.k, turn, where, snippet: snippetAround(body, needle), kind: session.kind === "memory" ? "memory" : "turn" });
      break;
    }
  }
  const seen = /* @__PURE__ */ new Set();
  const hits = [];
  for (const h of raw.sort((a, b) => a.session.mtime - b.session.mtime)) {
    if (h.turn.item) {
      if (seen.has(h.turn.item)) continue;
      seen.add(h.turn.item);
    }
    hits.push(h);
  }
  return hits.sort((a, b) => (b.turn.at ?? "").localeCompare(a.turn.at ?? ""));
}
function renderFind(facts, phrase, hits, limit, json) {
  const out = [];
  const shown = hits.slice(0, limit);
  const sessions = new Set(hits.map((h) => h.session.id)).size;
  if (json) {
    out.push(JSON.stringify({
      phrase,
      turns: hits.length,
      sessions,
      evidence: { Q: "observed (a question, verbatim)", A: "observed (an answer, verbatim)", M: "observed (an attached material's text, verbatim)" },
      hits: shown.map((h) => ({ kind: h.kind, session: h.session.id, runner: h.session.runner, title: h.session.title, cwd: h.turn.cwd ?? h.session.cwd, file: h.session.file, turn: turnNumber(facts, h), at: h.turn.at ?? null, where: h.where, snippet: h.snippet, open: openLink(h) }))
    }, null, 1));
    return out.join("\n");
  }
  out.push(`find "${phrase}"  \xB7  ${hits.length} turn${hits.length === 1 ? "" : "s"} in ${sessions} session${sessions === 1 ? "" : "s"}${hits.length > limit ? `  (showing ${limit}, --limit for more)` : ""}
`);
  for (const h of shown) {
    const s = h.session;
    out.push(`${when(h.turn, s)}  ${s.runner}${h.kind === "memory" ? " memory" : ""}  \u300C${s.title.slice(0, 60)}\u300D  #${turnNumber(facts, h)}  ${openLink(h)}`);
    out.push(`    ${h.where}: ${h.snippet}`);
  }
  if (!shown.length) out.push("(nothing asked, answered or attached in those words \u2014 try another wording; matching is exact)");
  else out.push("\nQ: asked \xB7 A: answered \xB7 M: in an attached material \u2014 all verbatim; the phrase must appear in those words");
  return out.join("\n");
}
var CHECK_FRESH_MS = 10 * 6e4;
async function factsForCheck(force) {
  const facts = await loadFacts();
  const age = facts.builtAt ? Date.now() - new Date(facts.builtAt).getTime() : Infinity;
  return force || age > CHECK_FRESH_MS ? ensureFresh() : facts;
}
function renderCheck(facts, arg, file, hits, json) {
  const changes = hits.filter((h) => !readLike(h.touch.op)).length;
  const reads = hits.length - changes;
  const sessions = new Set(hits.map((h) => h.session.id)).size;
  const latest = hits.map((h) => h.turn.at ?? "").filter(Boolean).sort().pop();
  const has = hits.length > 0;
  if (json) return { text: JSON.stringify({ query: arg, artifact: file, history: has, turns: hits.length, sessions, changes, reads, latest: latest ?? null }), has };
  if (!has) return { text: `${arg}: no history`, has };
  const parts = [`${hits.length} turn${hits.length === 1 ? "" : "s"} in ${sessions} session${sessions === 1 ? "" : "s"}`, changes ? `${changes} edit${changes === 1 ? "" : "s"}/write${changes === 1 ? "" : "s"}` : "", reads ? `${reads} read${reads === 1 ? "" : "s"}` : "", latest ? `latest ${latest.slice(0, 10)}` : ""].filter(Boolean);
  return { text: `${arg}: ${parts.join(" \xB7 ")}  \u2192  memory-graph why ${arg}`, has };
}
async function recallTurn(facts, sidPrefix, n) {
  const any = Object.values(facts.sessions).find((x) => x.id.startsWith(sidPrefix));
  if (!any) throw new Error(`no session starts with ${sidPrefix}`);
  const frag = fragmentsOf(facts, any.id).find((f) => n >= f.offset && n < f.offset + f.s.turns.length);
  const s = frag?.s ?? any;
  const local = frag ? n - frag.offset : n;
  const base = { runner: s.runner, session: s.id, title: s.title, turn: n, file: s.file };
  if (s.kind === "memory") {
    const mf = await memoryFile(s.file, s.runner);
    const u = mf?.units[local];
    if (!u) throw new Error(`memory ${s.id.slice(0, 8)} has no entry #${n}`);
    return { ...base, kind: "memory", at: s.turns[local]?.at, cwd: s.turns[local]?.cwd ?? s.cwd, question: u.heading, response: u.body, tools: [] };
  }
  const p = await eventsOf(s.file);
  const turn = p?.turns?.[local] ?? (() => {
    const tid = s.turns[local]?.t;
    const text = tid ? p?.texts.get(tid) : void 0;
    return text ? { question: text.question, response: text.response, tools: [], at: s.turns[local]?.at } : void 0;
  })();
  if (!turn) throw new Error(`session ${s.id.slice(0, 8)} has no turn #${n}`);
  return { ...base, kind: "turn", at: turn.at, cwd: s.cwd, question: turn.question, response: turn.response, tools: turn.tools };
}
async function renderRecall(facts, sidPrefix, n) {
  const r = await recallTurn(facts, sidPrefix, n);
  const out = [];
  out.push(`${r.runner}${r.kind === "memory" ? " memory" : ""}  \u300C${r.title}\u300D  ${r.kind === "memory" ? "entry" : "turn"} #${n}${r.at ? `  ${r.at.slice(0, 16).replace("T", " ")}` : ""}
`);
  if (r.kind === "memory") {
    out.push(`## ${r.question.trim()}

${r.response.trim() || "(empty)"}
`);
    return out.join("\n");
  }
  out.push(`## Question

${r.question.trim()}
`);
  out.push(`## Answer

${r.response.trim() || "(none)"}
`);
  if (r.tools.length) {
    out.push(`## Tools (${r.tools.length})
`);
    for (const t of r.tools) {
      out.push(`- ${t.name}${t.paths?.length ? `  ${t.paths.join(", ")}` : ""}`);
      if (t.op === "edit" || t.op === "write") out.push(t.call.slice(0, 1200).split("\n").map((l) => `    ${l}`).join("\n"));
      else if (t.op === "other" && /^error\b/i.test(t.result.trimStart())) out.push(`    \u2717 ${t.result.trim().split("\n")[0].slice(0, 200)}`);
    }
  }
  return out.join("\n");
}
async function findJson(phrase, opts = {}) {
  const facts = await ensureFresh();
  let hits = await findHits(facts, phrase, opts.scope ?? "all");
  if (opts.cwd) {
    const want = opts.cwd.replace(/[\\/]+$/, "");
    hits = hits.filter((h) => {
      const c = h.turn.cwd ?? h.session.cwd;
      return c === want || c.startsWith(want + path.sep);
    });
  }
  const limit = opts.limit ?? 20;
  const shown = [...hits.filter((h) => h.kind === "memory").slice(0, limit), ...hits.filter((h) => h.kind === "turn").slice(0, limit)];
  return {
    phrase,
    turns: hits.length,
    sessions: new Set(hits.map((h) => h.session.id)).size,
    hits: shown.map((h) => ({ kind: h.kind, session: h.session.id, runner: h.session.runner, title: h.session.title, cwd: h.turn.cwd ?? h.session.cwd, file: h.session.file, turn: turnNumber(facts, h), at: h.turn.at ?? null, where: h.where, snippet: h.snippet, open: openLink(h) }))
  };
}
var refreshInBackground = null;
async function turnsJson(opts = {}) {
  if (opts.limit === 0) {
    const current = await fsp.readFile(TEXT_FILE, "utf8").then((raw2) => JSON.parse(raw2).version === INDEX_VERSION).catch(() => false);
    if (!current) {
      refreshInBackground ??= ensureFresh().then(() => void 0, () => void 0).finally(() => {
        refreshInBackground = null;
      });
      return { total: 0, turns: [], refreshing: true };
    }
    const text = await loadText();
    return { total: Object.values(text.sessions).reduce((a, b) => a + b, 0), turns: [] };
  }
  const facts = await ensureFresh();
  const head = Math.max(40, Math.min(1e3, opts.head ?? 300));
  const turnsOf = /* @__PURE__ */ new Map();
  const lookup = (k, i) => {
    let m = turnsOf.get(k);
    if (!m) {
      m = new Map(facts.sessions[k]?.turns.map((t) => [t.i, t]) ?? []);
      turnsOf.set(k, m);
    }
    return m.get(i);
  };
  const clipHead = (text) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, head);
  const raw = [];
  let lines = null;
  try {
    await fsp.access(TEXT_LINES);
    lines = createInterface({ input: createReadStream(TEXT_LINES, { encoding: "utf8", highWaterMark: 1 << 20 }) });
  } catch {
    return { total: 0, turns: [] };
  }
  for await (const line of lines) {
    let t;
    try {
      t = JSON.parse(line);
    } catch {
      continue;
    }
    const session = facts.sessions[t.k];
    const turn = lookup(t.k, t.i);
    if (!session || !turn) continue;
    const memory = session.kind === "memory";
    raw.push({ session, sourceKey: t.k, turn, q: memory ? "" : clipHead(t.q), a: clipHead(memory ? t.m : t.a), kind: memory ? "memory" : "turn" });
  }
  const seen = /* @__PURE__ */ new Set();
  const all = [];
  for (const h of raw.sort((a, b) => a.session.mtime - b.session.mtime)) {
    if (h.turn.item) {
      if (seen.has(h.turn.item)) continue;
      seen.add(h.turn.item);
    }
    all.push(h);
  }
  all.sort((a, b) => (b.turn.at ?? "").localeCompare(a.turn.at ?? ""));
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = Math.max(0, opts.limit ?? all.length);
  return {
    total: all.length,
    turns: all.slice(offset, offset + limit).map((h) => ({ kind: h.kind, session: h.session.id, runner: h.session.runner, title: h.session.title, cwd: h.turn.cwd ?? h.session.cwd, file: h.session.file, turn: turnNumber(facts, h), at: h.turn.at ?? null, q: h.q, a: h.a, open: openLink(h) }))
  };
}
async function recallJson(session, n) {
  return recallTurn(await ensureFresh(), session, n);
}
var vocabCache = null;
async function vocabulary() {
  let stamp = "";
  try {
    const st = await fsp.stat(TEXT_LINES);
    stamp = `${st.mtimeMs}:${st.size}`;
  } catch {
    return /* @__PURE__ */ new Map();
  }
  if (vocabCache && vocabCache.builtFrom === stamp) return vocabCache.counts;
  const counts = /* @__PURE__ */ new Map();
  const lines = createInterface({ input: createReadStream(TEXT_LINES, { encoding: "utf8", highWaterMark: 1 << 20 }) });
  for await (const line of lines) {
    let t;
    try {
      t = JSON.parse(line);
    } catch {
      continue;
    }
    for (const body of [t.q, t.a, t.m]) {
      if (!body) continue;
      for (const m of body.matchAll(/[A-Za-z][A-Za-z0-9_-]{3,}/g)) {
        const w = m[0].toLowerCase();
        counts.set(w, (counts.get(w) ?? 0) + 1);
      }
    }
  }
  vocabCache = { builtFrom: stamp, counts };
  return counts;
}
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
async function suggestJson(term, k = 8) {
  const t = term.toLowerCase().trim();
  const counts = await vocabulary();
  const known = counts.get(t) ?? 0;
  if (!t || t.length < 3) return { term, known, suggestions: [] };
  const max = t.length >= 6 ? 2 : 1;
  const out = [];
  for (const [w, count] of counts) {
    if (w === t) continue;
    const d = editDistance(t, w, max);
    if (d <= max) out.push({ term: w, count, distance: d });
  }
  out.sort((a, b) => a.distance - b.distance || b.count - a.count);
  return { term, known, suggestions: out.slice(0, k) };
}
var TOPICS_FILE = path.join(HOME, "topics.json");
var TOPICS_VERSION = 1;
var emptyTopics = () => ({ version: TOPICS_VERSION, topics: [], labels: {}, labeledAt: {}, updatedAt: "" });
var loadTopics = async () => {
  try {
    const v = JSON.parse(await fsp.readFile(TOPICS_FILE, "utf8"));
    return v.version === TOPICS_VERSION ? { ...emptyTopics(), ...v } : emptyTopics();
  } catch {
    return emptyTopics();
  }
};
var turnKey = (k, i) => `${k}#${i}`;
var cleanForJudge = (s) => s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
async function systemOne(call, state, questions) {
  const body = call.wrap === "cloudflare" ? { model: call.model ?? "typesafe/jev", input: { state, questions } } : { ...call.model ? { model: call.model } : {}, state, questions };
  const r = await fetch(call.url, { method: "POST", headers: { "Content-Type": "application/json", ...call.headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(9e4) });
  const text = await r.text();
  let j = {};
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`judge answered ${r.status} with non-JSON`);
  }
  if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : j.error?.message ?? `HTTP ${r.status}`);
  const answers = (call.wrap === "cloudflare" ? j.result?.answers : j.answers) ?? {};
  return answers;
}
var labelStatus = { running: false, done: 0, total: 0, labeled: 0, errors: 0, startedAt: null, finishedAt: null, lastError: null, stopRequested: false };
async function topicsJson() {
  const tf = await loadTopics();
  const text = await loadText();
  const turns = Object.values(text.sessions).reduce((n, c) => n + c, 0);
  const counts = /* @__PURE__ */ new Map();
  for (const per of Object.values(tf.labels)) for (const [id, p] of Object.entries(per)) if (p >= 0.6) counts.set(id, (counts.get(id) ?? 0) + 1);
  return { topics: tf.topics.map((t) => ({ ...t, count: counts.get(t.id) ?? 0 })), labeled: Object.keys(tf.labels).length, turns, status: { ...labelStatus } };
}
async function setTopics(topics) {
  const tf = await loadTopics();
  const clean = topics.filter((t) => t.name?.trim()).map((t) => ({ id: t.id && /^[a-z0-9_-]{1,40}$/.test(t.id) ? t.id : shortHash(t.name.trim().toLowerCase()), name: t.name.trim().slice(0, 60), description: (t.description ?? "").trim().slice(0, 240) }));
  const keep = new Set(clean.map((t) => t.id));
  for (const [k, per] of Object.entries(tf.labels)) {
    for (const id of Object.keys(per)) if (!keep.has(id)) delete per[id];
    if (!Object.keys(per).length) {
      delete tf.labels[k];
      delete tf.labeledAt[k];
    }
  }
  tf.topics = clean;
  tf.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await writePrivate(TOPICS_FILE, tf);
  return clean;
}
async function labelStart(call, opts = {}) {
  if (labelStatus.running) return { ...labelStatus };
  const tf = await loadTopics();
  if (!tf.topics.length) throw new Error("no topics to label with");
  const batch = Math.max(1, Math.min(16, opts.batch ?? 8));
  Object.assign(labelStatus, { running: true, done: 0, total: 0, labeled: 0, errors: 0, startedAt: (/* @__PURE__ */ new Date()).toISOString(), finishedAt: null, lastError: null, stopRequested: false });
  void (async () => {
    try {
      const needs = (t) => {
        const have = tf.labels[turnKey(t.k, t.i)];
        if (have && tf.topics.every((tp) => tp.id in have)) return false;
        return (t.q?.trim().length ?? 0) + (t.a?.trim().length ?? 0) >= 40;
      };
      const open = async () => {
        try {
          await fsp.access(TEXT_LINES);
          return createInterface({ input: createReadStream(TEXT_LINES, { encoding: "utf8", highWaterMark: 1 << 20 }) });
        } catch {
          return null;
        }
      };
      const keys = [];
      const first = await open();
      if (first) for await (const line of first) {
        let t;
        try {
          t = JSON.parse(line);
        } catch {
          continue;
        }
        if (needs(t)) keys.push(turnKey(t.k, t.i));
      }
      const chosen = new Set(opts.max ? keys.slice(-opts.max) : keys);
      const pending = [];
      const second = chosen.size ? await open() : null;
      if (second) for await (const line of second) {
        let t;
        try {
          t = JSON.parse(line);
        } catch {
          continue;
        }
        if (chosen.has(turnKey(t.k, t.i))) pending.push(t);
      }
      pending.reverse();
      labelStatus.total = pending.length;
      let sinceWrite = 0;
      for (let at = 0; at < pending.length && !labelStatus.stopRequested; at += batch) {
        const group = pending.slice(at, at + batch);
        const state = {};
        const questions = {};
        group.forEach((t, gi) => {
          state[`t${gi}`] = { q: cleanForJudge((t.q ?? "").slice(0, 300)), a: cleanForJudge((t.a ?? "").slice(0, 700)) };
          for (const tp of tf.topics) questions[`t${gi}_${tp.id}`] = { type: "noul", instructions: `Is the turn \`t${gi}\` about the topic "${tp.name}"${tp.description ? ` (${tp.description})` : ""}?` };
        });
        try {
          const answers = await systemOne(call, state, questions);
          group.forEach((t, gi) => {
            const key = turnKey(t.k, t.i);
            const per = tf.labels[key] ?? {};
            for (const tp of tf.topics) {
              const p = answers[`t${gi}_${tp.id}`]?.noul;
              if (typeof p === "number") per[tp.id] = Math.round(p * 100) / 100;
            }
            tf.labels[key] = per;
            tf.labeledAt[key] = (/* @__PURE__ */ new Date()).toISOString();
            labelStatus.labeled++;
          });
        } catch (e) {
          labelStatus.errors++;
          labelStatus.lastError = e instanceof Error ? e.message : String(e);
          if (labelStatus.errors >= 5 && labelStatus.labeled === 0) break;
          await new Promise((r) => setTimeout(r, 1500));
        }
        labelStatus.done = Math.min(pending.length, at + group.length);
        sinceWrite += group.length;
        if (sinceWrite >= 80) {
          tf.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
          await writePrivate(TOPICS_FILE, tf);
          sinceWrite = 0;
        }
      }
      tf.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await writePrivate(TOPICS_FILE, tf);
    } catch (e) {
      labelStatus.lastError = e instanceof Error ? e.message : String(e);
    } finally {
      labelStatus.running = false;
      labelStatus.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
    }
  })();
  return { ...labelStatus };
}
function labelStop() {
  if (labelStatus.running) labelStatus.stopRequested = true;
  return { ...labelStatus };
}
async function byTopicJson(topicIds, opts = {}) {
  const tf = await loadTopics();
  const facts = await loadFacts();
  const minP = opts.minP ?? 0.6;
  const want = new Set(topicIds);
  const rows = [];
  for (const [key, per] of Object.entries(tf.labels)) {
    let score = 0;
    const topics = {};
    for (const [id, p] of Object.entries(per)) if (want.has(id) && p >= minP) {
      score = Math.max(score, p);
      topics[id] = p;
    }
    if (!score) continue;
    const hash = key.lastIndexOf("#");
    rows.push({ key, k: key.slice(0, hash), i: Number(key.slice(hash + 1)), score, topics });
  }
  const hits = [];
  for (const r of rows) {
    const session = facts.sessions[r.k];
    const turn = session?.turns.find((t) => t.i === r.i);
    if (!session || !turn) continue;
    hits.push({ kind: session.kind === "memory" ? "memory" : "turn", session: session.id, runner: session.runner, title: session.title, cwd: turn.cwd ?? session.cwd, file: session.file, turn: turnNumber(facts, { session, sourceKey: r.k, turn }), at: turn.at ?? null, where: "Q", snippet: turn.q.slice(0, 200), open: openLink({ session, turn }), topics: r.topics, _score: r.score });
  }
  hits.sort((a, b) => (b._score ?? 0) - (a._score ?? 0) || (b.at ?? "").localeCompare(a.at ?? ""));
  const total = hits.length;
  return { hits: hits.slice(0, opts.limit ?? 60).map((h) => {
    const { _score, ...rest } = h;
    void _score;
    return rest;
  }), total };
}
var DOSSIERS_FILE = path.join(HOME, "dossiers.json");
var DOSSIERS_VERSION = 1;
var emptyDossiers = () => ({ version: DOSSIERS_VERSION, byTopic: {} });
var loadDossiers = async () => {
  try {
    const v = JSON.parse(await fsp.readFile(DOSSIERS_FILE, "utf8"));
    return v.version === DOSSIERS_VERSION ? { ...emptyDossiers(), ...v } : emptyDossiers();
  } catch {
    return emptyDossiers();
  }
};
var emptyDossier = (topicId) => ({ topicId, sections: { what: [], decisions: [], now: [], open: [] }, sources: {}, covered: [], pending: [], changelog: [], builtAt: null, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
async function dossiersJson() {
  const [tf, df] = await Promise.all([loadTopics(), loadDossiers()]);
  const out = [];
  for (const tp of tf.topics) {
    const d = df.byTopic[tp.id];
    const labeled = (await byTopicJson([tp.id], { limit: 5e3 })).hits.map((h) => `${h.session}#${h.turn}`);
    const covered = new Set(d?.covered ?? []);
    const s = d?.sections;
    const sentences = s ? s.what.length + s.decisions.length + s.now.length + s.open.length : 0;
    out.push({ topicId: tp.id, name: tp.name, built: !!d?.builtAt, builtAt: d?.builtAt ?? null, updatedAt: d?.updatedAt ?? "", lead: s?.what[0]?.text ?? s?.now[0]?.text ?? "", sentences, covered: covered.size, pending: d?.pending.length ?? 0, newTurns: labeled.filter((k) => !covered.has(k)).length, labeled: labeled.length });
  }
  return out;
}
async function dossierJson(topicId) {
  return (await loadDossiers()).byTopic[topicId] ?? null;
}
var DOSSIERS_LOCK = path.join(HOME, "dossiers.lock");
var DOSSIERS_LOCK_WAIT_MS = 5e3;
var dossierWrites = Promise.resolve();
async function withDossiers(fn) {
  const run = async () => {
    let release = null;
    const deadline = Date.now() + DOSSIERS_LOCK_WAIT_MS;
    while (!(release = await acquireLock(DOSSIERS_LOCK, 3e4)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 60));
    try {
      const df = await loadDossiers();
      const out = fn(df);
      await writePrivate(DOSSIERS_FILE, df);
      return out;
    } finally {
      await release?.();
    }
  };
  const p = dossierWrites.then(run, run);
  dossierWrites = p.catch(() => void 0);
  return p;
}
async function setDossier(topicId, d) {
  return withDossiers((df) => {
    const cur = df.byTopic[topicId] ?? emptyDossier(topicId);
    const { consumePending, ...rest } = d;
    const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== void 0));
    const next = { ...cur, ...patch, topicId, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    if (consumePending) {
      const read = new Set(consumePending);
      next.pending = cur.pending.filter((p) => !read.has(p.id));
    }
    df.byTopic[topicId] = next;
    return next;
  });
}
async function deleteDossier(topicId) {
  await withDossiers((df) => {
    delete df.byTopic[topicId];
  });
}
async function dossierAddPending(topicId, item) {
  return withDossiers((df) => {
    const cur = df.byTopic[topicId] ?? emptyDossier(topicId);
    cur.pending.push({ id: shortHash(`${Date.now()}:${cur.pending.length}:${item.text}`), text: item.text.slice(0, 400), at: (/* @__PURE__ */ new Date()).toISOString(), ...item.from ? { from: item.from } : {} });
    cur.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    df.byTopic[topicId] = cur;
    return cur;
  });
}
async function dossierNewTurns(topicId, opts = {}) {
  const d = (await loadDossiers()).byTopic[topicId];
  const covered = new Set(d?.covered ?? []);
  const all = await byTopicJson([topicId], { limit: 5e3 });
  const fresh = all.hits.filter((h) => !covered.has(`${h.session}#${h.turn}`));
  const sorted = fresh.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")).slice(0, opts.limit ?? 120);
  const excerpts = [];
  for (const h of sorted) {
    try {
      const r = await recallJson(h.session, h.turn);
      excerpts.push({ key: `${h.session}#${h.turn}`, q: r.question.replace(/\s+/g, " ").slice(0, 300), a: r.response.replace(/\s+/g, " ").slice(0, 600) });
    } catch {
    }
  }
  return { hits: sorted, excerpts, total: fresh.length };
}
async function sampleQuestions(n = 120) {
  const out = [];
  let lines = null;
  try {
    await fsp.access(TEXT_LINES);
    lines = createInterface({ input: createReadStream(TEXT_LINES, { encoding: "utf8", highWaterMark: 1 << 20 }) });
  } catch {
    return out;
  }
  const all = [];
  for await (const line of lines) {
    let t;
    try {
      t = JSON.parse(line);
    } catch {
      continue;
    }
    const q = (t.q ?? "").trim();
    if (q.length >= 20 && q.length <= 400) all.push(q);
  }
  const step = Math.max(1, Math.floor(all.length / n));
  for (let i = 0; i < all.length && out.length < n; i += step) out.push(all[i].slice(0, 200));
  return out;
}
async function memoriesJson() {
  const facts = await ensureFresh();
  return Object.values(facts.sessions).filter((x) => x.kind === "memory").sort((a, b) => b.mtime - a.mtime).map((x) => ({ id: x.id, runner: x.runner, file: x.file, title: x.title, cwd: x.cwd, entries: x.turns.length, mtime: x.mtime, headings: x.turns.map((t) => t.q) }));
}
var CLI_VERSION = "0.2.2";
var MCP_TOOLS = [
  { name: "why_check", description: "Cheap first question before editing a file: does this artifact have any history in local agent sessions? One line; history true/false.", inputSchema: { type: "object", properties: { path: { type: "string", description: "file path (absolute or relative to cwd), URL, or arxiv:<id>" } }, required: ["path"] } },
  { name: "why_file", description: "The turns across local Claude Code, Codex, DeepSeek Harness, Pi and 记忆图 sessions that touched a file, URL or paper: when, what changed (\u0394, observed), what was asked, what the answer said about it (\u2248, a candidate explanation, not a verified reason). Each hit carries a deep link.", inputSchema: { type: "object", properties: { path: { type: "string" }, include_read: { type: "boolean", description: "also list turns that only read it (default false)" }, limit: { type: "number", description: "max hits (default 10)" } }, required: ["path"] } },
  { name: "find", description: "Where these exact words were asked (Q), answered (A) or attached (M) across local sessions, canvases and the memories Claude Code and Codex keep for themselves. Exact, case-insensitive match; every hit is a verbatim snippet with a pointer.", inputSchema: { type: "object", properties: { phrase: { type: "string" }, in: { type: "string", enum: ["q", "a", "m", "all"] }, limit: { type: "number" } }, required: ["phrase"] } },
  { name: "recall_turn", description: "One turn in full \u2014 the question, the answer, the tool calls with their diffs \u2014 by session id (or prefix) and turn number as shown by why_file.", inputSchema: { type: "object", properties: { session: { type: "string" }, turn: { type: "number" } }, required: ["session", "turn"] } }
];
async function mcpCall(name, a) {
  if (name === "why_check") {
    const facts = await factsForCheck(false);
    const q = String(a.path ?? "");
    const { path: file } = await resolveQuery(facts, q, false);
    return renderCheck(facts, q, file, file ? hitsFor(facts, file, true).hits : [], false).text;
  }
  if (name === "why_file") {
    const facts = await ensureFresh();
    const q = String(a.path ?? "");
    const { path: file, candidates, elsewhere } = await resolveQuery(facts, q, false);
    if (!file) return candidates.length ? `${candidates.length} files match "${q}" \u2014 pick one:
${candidates.slice(0, 20).map((c) => `  ${c}`).join("\n")}` : elsewhere ? `no match in this workspace (${elsewhere} elsewhere)` : `no session touched ${q}`;
    const { hits, readsHidden } = hitsFor(facts, file, a.include_read === true);
    return renderWhy(facts, file, hits, readsHidden, await loadCache(), Number(a.limit ?? 10) || 10, false);
  }
  if (name === "find") {
    const facts = await ensureFresh();
    const scope = ["q", "a", "m"].find((x) => x === a.in) ?? "all";
    return renderFind(facts, String(a.phrase ?? ""), await findHits(facts, String(a.phrase ?? ""), scope), Number(a.limit ?? 10) || 10, false);
  }
  if (name === "recall_turn") return renderRecall(await ensureFresh(), String(a.session ?? ""), Number(a.turn ?? 0));
  throw new Error(`unknown tool: ${name}`);
}
export {
  CACHE_FILE,
  CLI_VERSION,
  FACT_FILE,
  HOME,
  LEGACY_FILE,
  LOCK_FILE,
  MCP_TOOLS,
  TEXT_FILE,
  TEXT_LINES,
  artifactsLine,
  buildIndex,
  byTopicJson,
  deleteDossier,
  dossierAddPending,
  dossierJson,
  dossierNewTurns,
  dossiersJson,
  ensureFresh,
  eventsOf,
  factsForCheck,
  findHits,
  findJson,
  hitsFor,
  labelStart,
  labelStop,
  loadCache,
  loadFacts,
  mcpCall,
  memoriesJson,
  recallJson,
  recallTurn,
  renderCheck,
  renderFind,
  renderRecall,
  renderWhy,
  resolveQuery,
  sampleQuestions,
  setDossier,
  setQuiet,
  setTopics,
  suggestJson,
  summarize,
  topicsJson,
  turnsJson,
  when,
  zstdSkipped
};
