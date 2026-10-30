export const TONES = { cyan: '#5ec8f2', teal: '#5ee0b8', violet: '#b7a2ff', yellow: '#e8d27a', orange: '#f0a868', pink: '#f08aa8', green: '#a8e07a', gray: '#9fb0c3' };
const PALETTE = Object.values(TONES).slice(0, -1);
const STOPPED = '#9fb0c3';
const BACKGROUND = '#123d6e';
const GRID_MINOR = '#1d4a7d';
const GRID_MAJOR = '#28588e';
const INK = '#e8f1ff';
const EDGE = '#d6e4f5';
const LABEL_FILL = '#0f3260';
const LABEL_STROKE = '#7f9cc0';
const FONT = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace";
const CHAR = 7.9;
const LINE = 17;
const NODE_PAD_X = 14;
const NODE_PAD_Y = 10;
const NODE_WRAP = 24;
const EDGE_WRAP = 22;
const RANK_GAP = 78;
const NODE_GAP = 46;
const MARGIN = 40;
const REGION_PAD = 22;
const REGION_TITLE = 30;

const escape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function wrap(text, width) {
  const lines = [];
  let current = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (current && current.length + 1 + word.length > width) {
      lines.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function tallyLine(tally) {
  if (!tally) return null;
  const counted = tally.closed + tally.open + tally.contradicted + tally.blocked;
  if (counted + tally.wontfix === 0) return null;
  const parts = [`${tally.closed}/${counted} proven`];
  if (tally.contradicted) parts.push(`${tally.contradicted} contradicted`);
  if (tally.wontfix) parts.push(`${tally.wontfix} won't fix`);
  return parts.join(', ');
}

export function rank(stages, edges) {
  const outgoing = new Map(stages.map((stage) => [stage.id, []]));
  const incoming = new Map(stages.map((stage) => [stage.id, 0]));
  const forward = [];
  const state = new Map();
  for (const edge of edges) outgoing.get(edge.from).push(edge);
  const visit = (id) => {
    state.set(id, 'open');
    for (const edge of outgoing.get(id)) {
      if (state.get(edge.to) === 'open') continue;
      forward.push(edge);
      if (!state.has(edge.to)) visit(edge.to);
    }
    state.set(id, 'done');
  };
  for (const edge of edges) incoming.set(edge.to, incoming.get(edge.to) + 1);
  for (const stage of stages) if (incoming.get(stage.id) === 0 && !state.has(stage.id)) visit(stage.id);
  for (const stage of stages) if (!state.has(stage.id)) visit(stage.id);
  const ranks = new Map(stages.map((stage) => [stage.id, 0]));
  for (let pass = 0; pass < stages.length; pass += 1) {
    let changed = false;
    for (const edge of forward) {
      if (ranks.get(edge.to) < ranks.get(edge.from) + 1) {
        ranks.set(edge.to, ranks.get(edge.from) + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { ranks, forward: new Set(forward) };
}

function sizeLabel(text) {
  const lines = wrap(text, EDGE_WRAP);
  return { lines, width: Math.max(...lines.map((line) => line.length)) * 6.9 + 12, height: lines.length * 15 + 6 };
}

function layout(map, summary) {
  const groupColor = new Map(map.groups.map((group, index) => [group.id, TONES[group.tone] ?? PALETTE[index % PALETTE.length]]));
  const { ranks, forward } = rank(map.stages, map.edges);
  const items = new Map(map.stages.map((stage, order) => {
    const lines = wrap(stage.label, NODE_WRAP);
    const tally = tallyLine(summary.byStage.get(stage.id));
    const widest = Math.max(...lines.map((line) => line.length), tally ? tally.length * 0.85 : 0);
    const height = NODE_PAD_Y * 2 + lines.length * LINE + (tally ? LINE - 2 : 0);
    return [stage.id, {
      id: stage.id, stage, order, lines, tally, region: stage.region, rank: ranks.get(stage.id),
      width: Math.round(widest * CHAR + NODE_PAD_X * 2), height,
      color: stage.kind === 'stopped' ? STOPPED : groupColor.get(stage.group),
    }];
  }));
  const routes = [];
  map.edges.forEach((edge, index) => {
    if (!forward.has(edge)) return;
    const from = items.get(edge.from);
    const to = items.get(edge.to);
    const route = [from];
    const span = to.rank - from.rank;
    const region = from.region !== undefined && from.region === to.region ? from.region : undefined;
    const label = sizeLabel(edge.label);
    for (let step = 1; step < span; step += 1) {
      const carries = step === Math.ceil(span / 2);
      const dummy = {
        id: `edge-${index}-${step}`, dummy: true, order: from.order + step / 100, region, rank: from.rank + step,
        width: carries ? label.width : 14, height: carries ? label.height : 0, label: carries ? label : undefined,
      };
      items.set(dummy.id, dummy);
      route.push(dummy);
    }
    route.push(to);
    routes.push({ edge, route, label: span === 1 ? label : undefined });
  });
  const predecessors = new Map([...items.keys()].map((id) => [id, []]));
  for (const { route } of routes) {
    for (let index = 1; index < route.length; index += 1) predecessors.get(route[index].id).push(route[index - 1]);
  }
  const rows = [];
  for (const item of items.values()) (rows[item.rank] ??= []).push(item);
  const filled = rows.filter(Boolean);
  const slot = new Map();
  for (const row of filled) {
    const barycenter = (item) => {
      const parents = predecessors.get(item.id).filter((parent) => slot.has(parent.id));
      return parents.length ? parents.reduce((sum, parent) => sum + slot.get(parent.id), 0) / parents.length : item.order;
    };
    row.sort((left, right) => barycenter(left) - barycenter(right) || left.order - right.order);
    row.forEach((item, index) => slot.set(item.id, index + barycenter(item) / 1000));
  }
  const regionIds = (map.regions ?? []).map((region) => region.id);
  const segments = ['left', ...regionIds, 'right'];
  for (const row of filled) {
    const firstMember = row.findIndex((item) => item.region !== undefined);
    row.free = firstMember === -1;
    row.forEach((item, index) => {
      item.segment = item.region ?? (row.free ? 'free' : index < firstMember ? 'left' : 'right');
    });
  }
  const segmentWidth = new Map(segments.map((segment) => [segment, 0]));
  const span = (members) => members.reduce((sum, item) => sum + item.width, 0) + NODE_GAP * Math.max(0, members.length - 1);
  for (const region of map.regions ?? []) segmentWidth.set(region.id, region.label.length * CHAR + 30);
  for (const row of filled) {
    if (row.free) continue;
    for (const segment of segments) {
      segmentWidth.set(segment, Math.max(segmentWidth.get(segment), span(row.filter((item) => item.segment === segment))));
    }
  }
  const band = new Map();
  let cursor = 0;
  for (const segment of segments) {
    const width = segmentWidth.get(segment);
    if (width === 0) continue;
    const padding = regionIds.includes(segment) ? REGION_PAD : 0;
    if (cursor > 0) cursor += NODE_GAP;
    band.set(segment, { left: cursor + padding, width });
    cursor += width + padding * 2;
  }
  const freeWidth = Math.max(0, ...filled.filter((row) => row.free).map(span));
  const width = Math.max(cursor, freeWidth);
  const regionRows = new Map();
  for (const item of items.values()) {
    if (item.region === undefined || item.dummy) continue;
    const [first, last] = regionRows.get(item.region) ?? [item.rank, item.rank];
    regionRows.set(item.region, [Math.min(first, item.rank), Math.max(last, item.rank)]);
  }
  const opens = (rowRank) => [...regionRows.values()].some(([first]) => first === rowRank);
  const closes = (rowRank) => [...regionRows.values()].some(([, last]) => last === rowRank);
  let y = 0;
  for (const row of filled) {
    if (opens(row[0].rank) && y > 0) y += REGION_TITLE + REGION_PAD;
    const height = Math.max(...row.map((item) => item.height), 1);
    const place = (members, left, available) => {
      let x = left + (available - span(members)) / 2;
      for (const item of members) {
        item.x = x;
        item.y = y + (height - item.height) / 2;
        x += item.width + NODE_GAP;
      }
    };
    if (row.free) place(row, 0, width);
    else for (const [segment, { left, width: available }] of band) place(row.filter((item) => item.segment === segment), left, available);
    y += height + RANK_GAP + (closes(row[0].rank) ? REGION_PAD : 0);
  }
  const regionBounds = new Map();
  for (const regionId of regionIds) {
    const members = [...items.values()].filter((item) => item.region === regionId && !item.dummy);
    if (!members.length) continue;
    const { left, width: available } = band.get(regionId);
    regionBounds.set(regionId, {
      left: left - REGION_PAD, right: left + available + REGION_PAD,
      top: Math.min(...members.map((item) => item.y)) - REGION_PAD - REGION_TITLE,
      bottom: Math.max(...members.map((item) => item.y + item.height)) + REGION_PAD,
    });
  }
  const nodes = new Map([...items.values()].filter((item) => !item.dummy).map((item) => [item.id, item]));
  return { nodes, routes, forward, width, height: y - RANK_GAP, groupColor, regionBounds };
}

function nodeSvg(node, offsetX, offsetY) {
  const x = node.x + offsetX;
  const y = node.y + offsetY;
  const dashed = node.stage.kind === 'stopped' ? ' stroke-dasharray="5 4"' : '';
  const parts = [
    `<rect x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="2" fill="${node.color}" fill-opacity="0.16" stroke="${node.color}" stroke-width="1.6"${dashed}/>`,
  ];
  if (node.stage.kind === 'end') parts.push(`<rect x="${x + 3}" y="${y + 3}" width="${node.width - 6}" height="${node.height - 6}" rx="1" fill="none" stroke="${node.color}" stroke-opacity="0.5"/>`);
  node.lines.forEach((line, index) => {
    parts.push(`<text x="${x + node.width / 2}" y="${y + NODE_PAD_Y + LINE * (index + 1) - 4}" text-anchor="middle" fill="${INK}" font-size="13">${escape(line)}</text>`);
  });
  if (node.tally) {
    parts.push(`<text x="${x + node.width / 2}" y="${y + NODE_PAD_Y + LINE * (node.lines.length + 1) - 5}" text-anchor="middle" fill="${node.color}" font-size="11">${escape(node.tally)}</text>`);
  }
  return parts.join('');
}

function labelSvg(label, cx, cy) {
  const x = cx - label.width / 2;
  const y = cy - label.height / 2;
  return [
    `<rect x="${x}" y="${y}" width="${label.width}" height="${label.height}" rx="2" fill="${LABEL_FILL}" stroke="${LABEL_STROKE}" stroke-width="0.8"/>`,
    ...label.lines.map((line, index) => `<text x="${cx}" y="${y + 15 * (index + 1) - 1}" text-anchor="middle" fill="${INK}" font-size="11">${escape(line)}</text>`),
  ].join('');
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function placeLabel(label, cx, cy, taken) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const shift = Math.ceil(attempt / 2) * 18 * (attempt % 2 ? 1 : -1);
    const box = { x: cx + shift - label.width / 2 - 4, y: cy - label.height / 2 - 2, width: label.width + 8, height: label.height + 4 };
    if (!taken.some((other) => overlaps(box, other))) {
      taken.push(box);
      return cx + shift;
    }
  }
  return cx;
}

function ports(routes, nodes) {
  const exits = new Map();
  const entries = new Map();
  for (const entry of routes) {
    const { route } = entry;
    (exits.get(route[0].id) ?? exits.set(route[0].id, []).get(route[0].id)).push(entry);
    const last = route.at(-1);
    (entries.get(last.id) ?? entries.set(last.id, []).get(last.id)).push(entry);
  }
  const spread = (groups, pick, key) => {
    for (const [id, list] of groups) {
      const node = nodes.get(id);
      list.sort((left, right) => pick(left).x - pick(right).x);
      list.forEach((entry, index) => { entry[key] = node.x + (node.width * (index + 1)) / (list.length + 1); });
    }
  };
  spread(exits, (entry) => entry.route[1], 'exitX');
  spread(entries, (entry) => entry.route.at(-2), 'entryX');
}

function forwardSvg(entry, offsetX, offsetY, taken, regionBounds) {
  const { route } = entry;
  const points = [{ x: entry.exitX, y: route[0].y + route[0].height }];
  for (const hop of route.slice(1, -1)) {
    const cx = hop.x + hop.width / 2;
    points.push({ x: cx, y: hop.y }, { x: cx, y: hop.y + hop.height });
  }
  const target = route.at(-1);
  points.push({ x: entry.entryX, y: target.y - 6 });
  const shifted = points.map((point) => ({ x: point.x + offsetX, y: point.y + offsetY }));
  let d = `M${shifted[0].x},${shifted[0].y}`;
  for (let index = 1; index < shifted.length; index += 1) {
    const previous = shifted[index - 1];
    const point = shifted[index];
    const middle = (previous.y + point.y) / 2;
    d += previous.x === point.x ? ` L${point.x},${point.y}` : ` C${previous.x},${middle} ${point.x},${middle} ${point.x},${point.y}`;
  }
  const parts = [`<path d="${d}" fill="none" stroke="${EDGE}" stroke-width="1.2" marker-end="url(#arrow)"/>`];
  const carrier = route.find((hop) => hop.label);
  if (carrier) parts.push(labelSvg(carrier.label, carrier.x + offsetX + carrier.width / 2, carrier.y + offsetY + carrier.height / 2));
  else {
    const [start, end] = [shifted[0], shifted.at(-1)];
    const source = route[0];
    const opening = target.region !== undefined && target.region !== source.region ? regionBounds.get(target.region) : undefined;
    const closing = source.region !== undefined && source.region !== target.region ? regionBounds.get(source.region) : undefined;
    const top = closing ? Math.max(start.y, closing.bottom + offsetY) : start.y;
    const bottom = opening ? Math.min(end.y, opening.top + offsetY) : end.y;
    const cy = top < bottom ? (top + bottom) / 2 : (start.y + end.y) / 2;
    parts.push(labelSvg(entry.label, placeLabel(entry.label, (start.x + end.x) / 2, cy, taken), cy));
  }
  return parts.join('');
}

function backSvg(edge, lane, nodes, offsetX, offsetY) {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  const x1 = from.x + offsetX + from.width;
  const y1 = from.y + offsetY + from.height / 2;
  const x2 = to.x + offsetX + to.width;
  const y2 = to.y + offsetY + to.height / 2;
  const d = `M${x1},${y1} C${lane},${y1} ${lane},${y2} ${x2 + 6},${y2}`;
  return `<path d="${d}" fill="none" stroke="${EDGE}" stroke-width="1.2" stroke-dasharray="4 3" marker-end="url(#arrow)"/>${labelSvg(sizeLabel(edge.label), lane, (y1 + y2) / 2)}`;
}

function regionSvg(region, bounds, offsetX, offsetY) {
  const left = bounds.left + offsetX;
  const right = bounds.right + offsetX;
  const top = bounds.top + offsetY;
  const bottom = bounds.bottom + offsetY;
  return [
    `<rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" fill="#ffffff" fill-opacity="0.025" stroke="${LABEL_STROKE}" stroke-width="1" stroke-dasharray="6 4"/>`,
    `<line x1="${left}" y1="${top + REGION_TITLE}" x2="${right}" y2="${top + REGION_TITLE}" stroke="${LABEL_STROKE}" stroke-width="0.8" stroke-dasharray="6 4"/>`,
    `<text x="${right - 12}" y="${top + 20}" text-anchor="end" fill="${INK}" font-size="13" font-weight="700">${escape(region.label)}</text>`,
  ].join('');
}

function legendSvg(map, groupColor, width) {
  const chips = map.groups.map((group) => ({ label: group.label, color: groupColor.get(group.id), dashed: false }));
  chips.push({ label: "Won't fix or stopped", color: STOPPED, dashed: true });
  const rows = [];
  let row = [];
  let rowWidth = 0;
  for (const chip of chips) {
    const chipWidth = chip.label.length * CHAR + 28;
    if (row.length && rowWidth + chipWidth > width - 40) {
      rows.push(row);
      row = [];
      rowWidth = 0;
    }
    row.push({ ...chip, width: chipWidth });
    rowWidth += chipWidth + 18;
  }
  rows.push(row);
  const height = 34 + rows.length * 44 + 8;
  const parts = [
    `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${LABEL_STROKE}" stroke-dasharray="6 4"/>`,
    `<line x1="0" y1="30" x2="${width}" y2="30" stroke="${LABEL_STROKE}" stroke-width="0.8" stroke-dasharray="6 4"/>`,
    `<text x="${width / 2}" y="20" text-anchor="middle" fill="${INK}" font-size="13" font-weight="700">Legend</text>`,
  ];
  rows.forEach((chipsInRow, rowIndex) => {
    let x = 16;
    for (const chip of chipsInRow) {
      const y = 42 + rowIndex * 44;
      const dashed = chip.dashed ? ' stroke-dasharray="5 4"' : '';
      parts.push(`<rect x="${x}" y="${y}" width="${chip.width}" height="32" rx="2" fill="${chip.color}" fill-opacity="0.16" stroke="${chip.color}" stroke-width="1.6"${dashed}/>`);
      parts.push(`<text x="${x + chip.width / 2}" y="${y + 21}" text-anchor="middle" fill="${INK}" font-size="13">${escape(chip.label)}</text>`);
      x += chip.width + 18;
    }
  });
  return { svg: parts.join(''), height };
}

export function renderSvg(map, summary) {
  const { nodes, routes, forward, width: graphWidth, height: graphHeight, groupColor, regionBounds } = layout(map, summary);
  ports(routes, nodes);
  const backEdges = map.edges.filter((edge) => !forward.has(edge));
  const widestBack = Math.max(0, ...backEdges.map((edge) => sizeLabel(edge.label).width));
  const lanePad = backEdges.length ? 36 * backEdges.length + widestBack + 24 : 0;
  const title = `${map.target}, design map and gaps`;
  const width = Math.max(graphWidth + MARGIN * 2 + lanePad, title.length * 16 + MARGIN * 2, 640);
  const legend = legendSvg(map, groupColor, width - MARGIN * 2);
  const offsetX = MARGIN + (width - MARGIN * 2 - lanePad - graphWidth) / 2;
  const firstRegionTop = Math.min(0, ...[...regionBounds.values()].map((bounds) => bounds.top));
  const offsetY = MARGIN + 46 + legend.height + 90 - firstRegionTop;
  const height = offsetY + graphHeight + REGION_PAD + MARGIN;
  const taken = [...nodes.values()].map((node) => ({ x: node.x + offsetX, y: node.y + offsetY, width: node.width, height: node.height }));
  const regions = (map.regions ?? []).filter((region) => regionBounds.has(region.id)).map((region) => regionSvg(region, regionBounds.get(region.id), offsetX, offsetY));
  const sources = [...nodes.values()].filter((node) => !map.edges.some((edge) => edge.to === node.stage.id));
  const starts = sources.map((node) => {
    const cx = node.x + offsetX + node.width / 2;
    const top = node.y + offsetY;
    return `<circle cx="${cx}" cy="${top - 44}" r="6" fill="#7fd3ff"/><path d="M${cx},${top - 38} L${cx},${top - 6}" stroke="${EDGE}" stroke-width="1.2" marker-end="url(#arrow)"/>`;
  });
  const laneStart = offsetX + graphWidth + 24 + widestBack / 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">`,
    `<title>${escape(title)}</title>`,
    '<defs>',
    `<pattern id="minor" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20,0 L0,0 0,20" fill="none" stroke="${GRID_MINOR}" stroke-width="0.6"/></pattern>`,
    `<pattern id="major" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#minor)"/><path d="M100,0 L0,0 0,100" fill="none" stroke="${GRID_MAJOR}" stroke-width="1"/></pattern>`,
    `<marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${EDGE}"/></marker>`,
    '</defs>',
    `<rect width="100%" height="100%" fill="${BACKGROUND}"/>`,
    '<rect width="100%" height="100%" fill="url(#major)"/>',
    `<text x="${width / 2}" y="${MARGIN + 18}" text-anchor="middle" fill="${INK}" font-size="26">${escape(title)}</text>`,
    `<g transform="translate(${MARGIN},${MARGIN + 46})">${legend.svg}</g>`,
    ...regions,
    ...starts,
    ...routes.map((entry) => forwardSvg(entry, offsetX, offsetY, taken, regionBounds)),
    ...backEdges.map((edge, index) => backSvg(edge, laneStart + index * 36, nodes, offsetX, offsetY)),
    ...[...nodes.values()].map((node) => nodeSvg(node, offsetX, offsetY)),
    '</svg>',
    '',
  ].join('\n');
}
