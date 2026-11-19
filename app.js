const LEFT = 236;
const TOP = 112;
const CELL_SIZE = 32;
const PAGE_SIZE = 50;
const COLORS = ["#fff7c1", "#dceeb5", "#a7ddd0", "#60c0ce", "#4a9ac4", "#4d5b97"];
const elements = Object.fromEntries([
  "global-search", "min-articles", "hide-flagged", "phase-options", "row-sort", "col-sort", "show-empty",
  "filtered-badge", "pair-count", "target-count", "disease-count", "probe-count", "matrix-status",
  "matrix-viewport", "matrix-content", "matrix-canvas", "matrix-tooltip", "results-body", "page-status",
  "page-prev", "page-next", "download-csv", "reset-filters", "detail-panel", "detail-content", "close-detail",
].map((id) => [id, document.getElementById(id)]));

let dataset;
let probeImagePaths = new Map();
let viewPairs = [];
let rows = [];
let columns = [];
let cellMap = new Map();
let page = 0;
let selectedPair = null;
let detailReturnFocus = null;
let hoveredPair = null;
let keyboardCell = null;
let drawPending = false;
let resizeObserver;
let filterWidgets = [];
const state = {
  query: "", targets: new Set(), diseases: new Set(), areas: new Set(), probes: new Set(),
  phases: new Set(), minArticles: 1, hideFlagged: false, rowSort: "area", colSort: "name", showEmpty: false,
};

function node(tag, className, value) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (value !== undefined) result.textContent = value;
  return result;
}

function formatNumber(value) { return value.toLocaleString("en-GB"); }
function areaId(disease) { return disease.area || "unclassified"; }
function areaName(identifier) { return dataset.areaLabels?.[identifier] || (identifier === "unclassified" ? "Unclassified" : identifier); }
function phaseLabel(value) { return value === null ? "n" : String(value); }
function pairKey(targetIndex, diseaseIndex) { return `${targetIndex}:${diseaseIndex}`; }
function hasFilters() {
  return Boolean(state.query || state.targets.size || state.diseases.size || state.areas.size ||
    state.probes.size || state.phases.size || state.minArticles > 1 || state.hideFlagged);
}

function parseSet(params, key) { return new Set((params.get(key) || "").split(",").filter(Boolean)); }
function readURL() {
  const params = new URLSearchParams(location.search);
  state.query = params.get("q") || "";
  state.targets = parseSet(params, "target");
  state.diseases = parseSet(params, "disease");
  state.areas = parseSet(params, "area");
  state.probes = parseSet(params, "probe");
  state.phases = parseSet(params, "phase");
  state.minArticles = Math.max(1, Number.parseInt(params.get("min"), 10) || 1);
  state.hideFlagged = params.get("flagged") === "hide";
  state.rowSort = ["area", "name", "articles"].includes(params.get("rows")) ? params.get("rows") : "area";
  state.colSort = ["name", "articles"].includes(params.get("columns")) ? params.get("columns") : "name";
  state.showEmpty = params.get("empty") === "1";
}

function updateURL() {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  for (const [key, values] of [["target", state.targets], ["disease", state.diseases], ["area", state.areas], ["probe", state.probes], ["phase", state.phases]]) {
    if (values.size) params.set(key, [...values].sort().join(","));
  }
  if (state.minArticles > 1) params.set("min", String(state.minArticles));
  if (state.hideFlagged) params.set("flagged", "hide");
  if (state.rowSort !== "area") params.set("rows", state.rowSort);
  if (state.colSort !== "name") params.set("columns", state.colSort);
  if (state.showEmpty) params.set("empty", "1");
  const query = params.toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
}

function makeMultiFilter(hostId, title, options, stateKey) {
  const details = node("details", "filter-group");
  const summary = node("summary", "", title);
  const count = node("span", "filter-count");
  summary.append(count);
  details.append(summary);
  const inner = node("div", "filter-inner");
  const search = node("input", "filter-search");
  search.type = "search";
  search.placeholder = `Find and select ${title.toLowerCase()}`;
  search.setAttribute("aria-label", `Find and select ${title.toLowerCase()}`);
  const list = node("div", "filter-options");
  inner.append(search, list);
  details.append(inner);
  document.getElementById(hostId).append(details);
  const optionNodes = [];
  for (const option of options) {
    const label = node("label", "filter-option");
    const input = node("input");
    input.type = "checkbox";
    input.value = option.id;
    input.checked = state[stateKey].has(option.id);
    const text = node("span", "", option.name);
    if (option.id !== option.name && option.id !== "unclassified") text.append(node("small", "", option.id));
    label.append(input, text);
    list.append(label);
    optionNodes.push({ label, input, searchText: `${option.name} ${option.id}`.toLowerCase() });
    input.addEventListener("change", () => {
      if (input.checked) state[stateKey].add(option.id);
      else state[stateKey].delete(option.id);
      count.textContent = state[stateKey].size ? String(state[stateKey].size) : "";
      applyFilters();
    });
  }
  search.addEventListener("input", () => {
    const term = search.value.trim().toLowerCase();
    for (const option of optionNodes) option.label.hidden = !option.searchText.includes(term);
  });
  count.textContent = state[stateKey].size ? String(state[stateKey].size) : "";
  filterWidgets.push({ stateKey, optionNodes, count });
}

function renderFilterControls() {
  makeMultiFilter("target-filter", "Targets", dataset.targets, "targets");
  makeMultiFilter("disease-filter", "Diseases", dataset.diseases, "diseases");
  const areas = [...new Set(dataset.diseases.map(areaId))].map((id) => ({ id, name: areaName(id) }))
    .sort((first, second) => first.name.localeCompare(second.name));
  makeMultiFilter("area-filter", "Therapeutic areas", areas, "areas");
  makeMultiFilter("probe-filter", "Chemical probes", dataset.probes, "probes");
  for (const phase of ["none", "0.5", "1", "2", "3", "4"]) {
    const label = node("label", "phase-option");
    const input = node("input");
    input.type = "checkbox";
    input.value = phase;
    input.checked = state.phases.has(phase);
    label.append(input, node("span", "", phase === "none" ? "n · no match" : phase));
    elements["phase-options"].append(label);
    input.addEventListener("change", () => {
      if (input.checked) state.phases.add(phase);
      else state.phases.delete(phase);
      applyFilters();
    });
  }
  syncSimpleControls();
}

function syncSimpleControls() {
  elements["global-search"].value = state.query;
  elements["min-articles"].value = state.minArticles;
  elements["hide-flagged"].checked = state.hideFlagged;
  elements["row-sort"].value = state.rowSort;
  elements["col-sort"].value = state.colSort;
  elements["show-empty"].checked = state.showEmpty;
  for (const widget of filterWidgets) {
    for (const option of widget.optionNodes) option.input.checked = state[widget.stateKey].has(option.input.value);
    widget.count.textContent = state[widget.stateKey].size ? String(state[widget.stateKey].size) : "";
  }
  for (const input of elements["phase-options"].querySelectorAll("input")) input.checked = state.phases.has(input.value);
}

function viewForPair(pair) {
  const groups = state.probes.size
    ? pair.probes.filter(([probeIndex]) => state.probes.has(dataset.probes[probeIndex].id))
    : pair.probes;
  if (!groups.length) return null;
  const articleIds = new Set();
  for (const [, groupArticleIds] of groups) for (const articleId of groupArticleIds) articleIds.add(articleId);
  return { pair, groups, articleIds, articles: state.probes.size ? articleIds.size : pair.articleCount, probeCount: groups.length };
}

function applyFilters() {
  const query = state.query.trim().toLowerCase();
  const targetMatches = (index) => !query || `${dataset.targets[index].name} ${dataset.targets[index].id}`.toLowerCase().includes(query);
  const diseaseMatches = (index) => !query || `${dataset.diseases[index].name} ${dataset.diseases[index].id}`.toLowerCase().includes(query);
  viewPairs = [];
  const targetTotals = new Map();
  const diseaseTotals = new Map();
  const visibleProbes = new Set();
  for (const pair of dataset.pairs) {
    const target = dataset.targets[pair.targetIndex];
    const disease = dataset.diseases[pair.diseaseIndex];
    if (state.hideFlagged && disease.flagged) continue;
    if (!targetMatches(pair.targetIndex) && !diseaseMatches(pair.diseaseIndex)) continue;
    if (state.targets.size && !state.targets.has(target.id)) continue;
    if (state.diseases.size && !state.diseases.has(disease.id)) continue;
    if (state.areas.size && !state.areas.has(areaId(disease))) continue;
    if (state.phases.size && !state.phases.has(pair.phase === null ? "none" : String(pair.phase))) continue;
    const view = viewForPair(pair);
    if (!view || view.articles < state.minArticles) continue;
    viewPairs.push(view);
    targetTotals.set(pair.targetIndex, (targetTotals.get(pair.targetIndex) || 0) + view.articles);
    diseaseTotals.set(pair.diseaseIndex, (diseaseTotals.get(pair.diseaseIndex) || 0) + view.articles);
    for (const [probeIndex] of view.groups) visibleProbes.add(probeIndex);
  }

  const allowedTargets = (index) => (!state.targets.size || state.targets.has(dataset.targets[index].id)) &&
    (!query || targetMatches(index) || targetTotals.has(index));
  const allowedDiseases = (index) => {
    const disease = dataset.diseases[index];
    return (!state.hideFlagged || !disease.flagged) && (!state.diseases.size || state.diseases.has(disease.id)) &&
      (!state.areas.size || state.areas.has(areaId(disease))) && (!query || diseaseMatches(index) || diseaseTotals.has(index));
  };
  columns = dataset.targets.map((_, index) => index).filter((index) =>
    state.showEmpty ? allowedTargets(index) : targetTotals.has(index));
  rows = dataset.diseases.map((_, index) => index).filter((index) =>
    state.showEmpty ? allowedDiseases(index) : diseaseTotals.has(index));
  columns.sort((first, second) => state.colSort === "articles"
    ? (targetTotals.get(second) || 0) - (targetTotals.get(first) || 0) || dataset.targets[first].name.localeCompare(dataset.targets[second].name)
    : dataset.targets[first].name.localeCompare(dataset.targets[second].name));
  rows.sort((first, second) => {
    if (state.rowSort === "articles") return (diseaseTotals.get(second) || 0) - (diseaseTotals.get(first) || 0) || dataset.diseases[first].name.localeCompare(dataset.diseases[second].name);
    if (state.rowSort === "area") {
      const areaCompare = areaName(areaId(dataset.diseases[first])).localeCompare(areaName(areaId(dataset.diseases[second])));
      if (areaCompare) return areaCompare;
    }
    return dataset.diseases[first].name.localeCompare(dataset.diseases[second].name);
  });
  const rowPositions = new Map(rows.map((value, index) => [value, index]));
  const columnPositions = new Map(columns.map((value, index) => [value, index]));
  cellMap = new Map(viewPairs.map((view) => [pairKey(view.pair.targetIndex, view.pair.diseaseIndex), view]));
  viewPairs.sort((first, second) => rowPositions.get(first.pair.diseaseIndex) - rowPositions.get(second.pair.diseaseIndex) || columnPositions.get(first.pair.targetIndex) - columnPositions.get(second.pair.targetIndex));
  elements["pair-count"].textContent = formatNumber(viewPairs.length);
  elements["target-count"].textContent = formatNumber(columns.length);
  elements["disease-count"].textContent = formatNumber(rows.length);
  elements["probe-count"].textContent = formatNumber(visibleProbes.size);
  elements["filtered-badge"].hidden = !hasFilters();
  elements["matrix-status"].textContent = viewPairs.length
    ? `${formatNumber(viewPairs.length)} observed pairs · ${formatNumber(columns.length)} targets × ${formatNumber(rows.length)} diseases`
    : "No pairs match these filters. Try broadening your search.";
  if (selectedPair && !cellMap.has(pairKey(selectedPair.targetIndex, selectedPair.diseaseIndex))) closeDetail(false);
  else if (selectedPair) renderDetail(cellMap.get(pairKey(selectedPair.targetIndex, selectedPair.diseaseIndex)));
  page = 0;
  keyboardCell = null;
  hoveredPair = null;
  elements["matrix-tooltip"].hidden = true;
  updateURL();
  resizeMatrix();
  renderTable();
}

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function mixColors(first, second, factor) {
  const parts = [1, 3, 5].map((offset) => {
    const start = Number.parseInt(first.slice(offset, offset + 2), 16);
    const end = Number.parseInt(second.slice(offset, offset + 2), 16);
    return Math.round(start + (end - start) * factor).toString(16).padStart(2, "0");
  });
  return `#${parts.join("")}`;
}
function bubbleColor(articles) {
  const maximum = dataset.maxArticles || 1260;
  const position = clamp(Math.log10(Math.max(1, articles)) / Math.log10(Math.max(10, maximum)), 0, 1) * (COLORS.length - 1);
  const start = Math.min(COLORS.length - 2, Math.floor(position));
  return mixColors(COLORS[start], COLORS[start + 1], position - start);
}
function areaColor(identifier) {
  let hash = 0;
  for (const character of identifier) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return ["#3b9ba6", "#75b9a2", "#759ec7", "#b9b26b", "#a991be", "#d1a783"][Math.abs(hash) % 6];
}
function truncate(context, value, width) {
  if (context.measureText(value).width <= width) return value;
  let result = value;
  while (result.length && context.measureText(`${result}…`).width > width) result = result.slice(0, -1);
  return `${result}…`;
}

function resizeMatrix() {
  const viewport = elements["matrix-viewport"];
  const canvas = elements["matrix-canvas"];
  const content = elements["matrix-content"];
  const size = CELL_SIZE;
  content.style.width = `${Math.max(viewport.clientWidth, LEFT + columns.length * size + 2)}px`;
  content.style.height = `${Math.max(viewport.clientHeight, TOP + rows.length * size + 2)}px`;
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  canvas.getContext("2d").setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  scheduleDraw();
}

function scheduleDraw() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => { drawPending = false; drawMatrix(); });
}

function drawMatrix() {
  if (!dataset) return;
  const viewport = elements["matrix-viewport"];
  const canvas = elements["matrix-canvas"];
  const context = canvas.getContext("2d");
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  const size = CELL_SIZE;
  const scrollX = viewport.scrollLeft;
  const scrollY = viewport.scrollTop;
  const firstColumn = clamp(Math.floor(scrollX / size), 0, columns.length);
  const lastColumn = clamp(Math.ceil((scrollX + width - LEFT) / size) + 1, 0, columns.length);
  const firstRow = clamp(Math.floor(scrollY / size), 0, rows.length);
  const lastRow = clamp(Math.ceil((scrollY + height - TOP) / size) + 1, 0, rows.length);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);

  context.save();
  context.beginPath();
  context.rect(LEFT, TOP, width - LEFT, height - TOP);
  context.clip();
  context.strokeStyle = "#e4edef";
  context.lineWidth = 1;
  context.beginPath();
  for (let index = firstColumn; index <= lastColumn; index++) {
    const coordinate = Math.round(LEFT + index * size - scrollX) + .5;
    context.moveTo(coordinate, TOP);
    context.lineTo(coordinate, height);
  }
  for (let index = firstRow; index <= lastRow; index++) {
    const coordinate = Math.round(TOP + index * size - scrollY) + .5;
    context.moveTo(LEFT, coordinate);
    context.lineTo(width, coordinate);
  }
  context.stroke();
  for (let rowIndex = firstRow; rowIndex < lastRow; rowIndex++) {
    const diseaseIndex = rows[rowIndex];
    const y = TOP + rowIndex * size - scrollY + size / 2;
    for (let columnIndex = firstColumn; columnIndex < lastColumn; columnIndex++) {
      const targetIndex = columns[columnIndex];
      const view = cellMap.get(pairKey(targetIndex, diseaseIndex));
      if (!view) continue;
      const x = LEFT + columnIndex * size - scrollX + size / 2;
      const radius = Math.min(size / 2 - 2, 4 + 4 * Math.sqrt(view.probeCount));
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = bubbleColor(view.articles);
      context.fill();
      context.strokeStyle = view.pair === selectedPair ? "#123a55" : "#87a5aa";
      context.lineWidth = view.pair === selectedPair ? 2.5 : .8;
      context.stroke();
      if (radius >= 8) {
        context.fillStyle = "#14313d";
        context.font = "600 10px ui-sans-serif,system-ui,sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(phaseLabel(view.pair.phase), x, y + .5);
      }
    }
  }
  if (keyboardCell) {
    const x = LEFT + keyboardCell.column * size - scrollX;
    const y = TOP + keyboardCell.row * size - scrollY;
    context.strokeStyle = "#007a95";
    context.lineWidth = 2.5;
    context.strokeRect(x + 1, y + 1, size - 2, size - 2);
  }
  context.restore();

  context.fillStyle = "#f8fbfc";
  context.fillRect(0, 0, width, TOP);
  context.fillRect(0, 0, LEFT, height);
  context.strokeStyle = "#cbdde2";
  context.beginPath();
  context.moveTo(LEFT + .5, 0);
  context.lineTo(LEFT + .5, height);
  context.moveTo(0, TOP + .5);
  context.lineTo(width, TOP + .5);
  context.stroke();
  context.save();
  context.beginPath();
  context.rect(LEFT + 1, 0, width - LEFT - 1, TOP);
  context.clip();
  context.font = "600 11px ui-sans-serif,system-ui,sans-serif";
  context.fillStyle = "#345867";
  context.textAlign = "left";
  context.textBaseline = "middle";
  for (let index = firstColumn; index < lastColumn; index++) {
    const x = LEFT + index * size - scrollX + size / 2;
    context.save();
    context.translate(x, TOP - 12);
    context.rotate(-Math.PI / 2);
    context.fillText(truncate(context, dataset.targets[columns[index]].name, TOP - 25), 0, 0);
    context.restore();
  }
  context.restore();
  context.save();
  context.beginPath();
  context.rect(0, TOP + 1, LEFT, height - TOP - 1);
  context.clip();
  context.textAlign = "left";
  context.textBaseline = "middle";
  for (let index = firstRow; index < lastRow; index++) {
    const disease = dataset.diseases[rows[index]];
    const y = TOP + index * size - scrollY;
    context.fillStyle = areaColor(areaId(disease));
    context.fillRect(0, y + 1, 5, size - 2);
    context.fillStyle = "#3e5965";
    context.font = "600 11px ui-sans-serif,system-ui,sans-serif";
    context.fillText(truncate(context, `${disease.flagged ? "⚠ " : ""}${disease.name}`, LEFT - 20), 12, y + size / 2 - 6);
    context.fillStyle = "#7b929c";
    context.font = "9px ui-sans-serif,system-ui,sans-serif";
    context.fillText(truncate(context, areaName(areaId(disease)), LEFT - 20), 12, y + size / 2 + 8);
    context.strokeStyle = "#e4edef";
    context.beginPath();
    context.moveTo(0, Math.round(y + size) + .5);
    context.lineTo(LEFT, Math.round(y + size) + .5);
    context.stroke();
  }
  context.restore();
  context.fillStyle = "#eff6f7";
  context.fillRect(0, 0, LEFT, TOP);
  context.fillStyle = "#496a78";
  context.font = "700 11px ui-sans-serif,system-ui,sans-serif";
  context.textAlign = "left";
  context.fillText("TARGET →", 13, 42);
  context.fillText("↓ DISEASE / THERAPEUTIC AREA", 13, 65);
}

function cellAt(event) {
  const rect = elements["matrix-canvas"].getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (x < LEFT || y < TOP) return null;
  const columnIndex = Math.floor((x - LEFT + elements["matrix-viewport"].scrollLeft) / CELL_SIZE);
  const rowIndex = Math.floor((y - TOP + elements["matrix-viewport"].scrollTop) / CELL_SIZE);
  if (columnIndex < 0 || rowIndex < 0 || columnIndex >= columns.length || rowIndex >= rows.length) return null;
  return cellMap.get(pairKey(columns[columnIndex], rows[rowIndex])) || null;
}

function showTooltip(view, x, y) {
  const tooltip = elements["matrix-tooltip"];
  tooltip.replaceChildren();
  tooltip.append(node("strong", "", `${dataset.targets[view.pair.targetIndex].name} × ${dataset.diseases[view.pair.diseaseIndex].name}`));
  tooltip.append(node("span", "", `${formatNumber(view.articles)} articles · ${formatNumber(view.probeCount)} probes · phase ${phaseLabel(view.pair.phase)}`));
  if (dataset.diseases[view.pair.diseaseIndex].flagged) tooltip.append(node("span", "", " · flagged source term"));
  tooltip.hidden = false;
  tooltip.style.left = `${clamp(x + 14, 8, innerWidth - 280)}px`;
  tooltip.style.top = `${clamp(y + 15, 8, innerHeight - 75)}px`;
}

function openDetail(view) {
  detailReturnFocus = document.activeElement;
  selectedPair = view.pair;
  elements["detail-panel"].hidden = false;
  renderDetail(view);
  elements["close-detail"].focus();
  scheduleDraw();
}
function closeDetail(restoreFocus = true) {
  selectedPair = null;
  elements["detail-panel"].hidden = true;
  if (restoreFocus && detailReturnFocus instanceof HTMLElement && detailReturnFocus.isConnected) detailReturnFocus.focus();
  detailReturnFocus = null;
  scheduleDraw();
}
function sortedArticleIds(articleIds) {
  return [...articleIds].sort((first, second) => first.localeCompare(second, "en", { numeric: true }));
}
function articleURL(identifier) {
  if (/^[0-9]+$/.test(identifier)) return `https://pubmed.ncbi.nlm.nih.gov/${identifier}/`;
  if (/^PMC[0-9]+$/.test(identifier)) return `https://europepmc.org/articles/${identifier}`;
  if (/^PPR[0-9]+$/.test(identifier)) return `https://europepmc.org/article/PPR/${identifier}`;
  return `https://europepmc.org/search?query=${encodeURIComponent(identifier)}`;
}
function renderDetail(view) {
  const container = elements["detail-content"];
  container.replaceChildren();
  const target = dataset.targets[view.pair.targetIndex];
  const disease = dataset.diseases[view.pair.diseaseIndex];
  container.append(node("h2", "", `${target.name} × ${disease.name}`));
  container.append(node("p", "detail-subtitle", `${target.id} · ${disease.id}`));
  if (disease.flagged) container.append(node("p", "filter-note", "⚠ This disease term appears in the source blacklist of potential NER false positives. Review its articles before interpreting the association."));
  const stats = node("div", "detail-stats");
  for (const [value, label] of [[formatNumber(view.articles), "distinct articles"], [formatNumber(view.probeCount), "distinct probes"], [phaseLabel(view.pair.phase), "clinical phase"]]) {
    const box = node("div");
    box.append(node("strong", "", value), node("span", "", label));
    stats.append(box);
  }
  container.append(stats);
  if (state.probes.size) container.append(node("p", "detail-subtitle", "Counts reflect selected probes. Clinical phase is a target–disease property."));
  const meta = node("section", "detail-section");
  meta.append(node("h3", "", "Therapeutic area"), node("p", "", areaName(areaId(disease))));
  const links = node("p");
  for (const [label, href] of [["Target in Open Targets", `https://platform.opentargets.org/target/${encodeURIComponent(target.id)}`], ["Disease in Open Targets", `https://platform.opentargets.org/disease/${encodeURIComponent(disease.id)}`], ["Source dataset", dataset.meta.record]]) {
    const link = node("a", "", label);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    if (links.childNodes.length) links.append(document.createTextNode(" · "));
    links.append(link);
  }
  meta.append(links);
  container.append(meta);
  const probeSection = node("section", "detail-section");
  probeSection.append(node("h3", "", "Chemical probes"));
  const probeList = node("ul", "probe-list");
  for (const [index, articleIds] of view.groups) {
    const probe = dataset.probes[index];
    const item = node("li");
    if (probeImagePaths.has(probe.id)) {
      const imageURL = `./assets/probes/${encodeURIComponent(probeImagePaths.get(probe.id))}`;
      const imageLink = node("a", "probe-image-link");
      imageLink.href = imageURL;
      imageLink.target = "_blank";
      imageLink.rel = "noopener noreferrer";
      imageLink.setAttribute("aria-label", `Open structure image for ${probe.name}`);
      const image = node("img", "probe-structure");
      image.src = imageURL;
      image.alt = `2D chemical structure of ${probe.name}`;
      image.loading = "lazy";
      image.decoding = "async";
      image.width = 96;
      image.height = 96;
      imageLink.append(image);
      item.append(imageLink);
    } else {
      item.append(node("span", "probe-structure-placeholder", "Structure unavailable"));
    }
    const information = node("div", "probe-copy");
    const link = node("a", "", probe.name);
    link.href = `https://www.ebi.ac.uk/chembl/compound_report_card/${encodeURIComponent(probe.id)}/`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    information.append(link, node("small", "", probe.id), node("small", "", `${formatNumber(articleIds.length)} article ID${articleIds.length === 1 ? "" : "s"}`));
    item.append(information);
    probeList.append(item);
  }
  probeSection.append(probeList);
  container.append(probeSection);
  const articleSection = node("section", "detail-section");
  articleSection.append(node("h3", "", `Articles (${formatNumber(view.articleIds.size)} IDs)`));
  const articleList = node("ul", "pmid-list");
  const articleIds = sortedArticleIds(view.articleIds);
  let shown = 0;
  function addArticleIds(limit) {
    const next = Math.min(articleIds.length, shown + limit);
    for (; shown < next; shown++) {
      const item = node("li");
      const link = node("a", "", articleIds[shown]);
      link.href = articleURL(articleIds[shown]);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      item.append(link);
      articleList.append(item);
    }
  }
  addArticleIds(30);
  articleSection.append(articleList);
  if (articleIds.length > shown) {
    const more = node("button", "detail-more", `Show more article IDs (${formatNumber(articleIds.length - shown)} remaining)`);
    more.type = "button";
    more.addEventListener("click", () => {
      addArticleIds(100);
      if (shown === articleIds.length) more.remove();
      else more.textContent = `Show more article IDs (${formatNumber(articleIds.length - shown)} remaining)`;
    });
    articleSection.append(more);
  }
  container.append(articleSection);
}

function renderTable() {
  const body = elements["results-body"];
  body.replaceChildren();
  const start = page * PAGE_SIZE;
  for (const view of viewPairs.slice(start, start + PAGE_SIZE)) {
    const target = dataset.targets[view.pair.targetIndex];
    const disease = dataset.diseases[view.pair.diseaseIndex];
    const row = node("tr");
    for (const value of [target.name, `${disease.flagged ? "⚠ " : ""}${disease.name}`, areaName(areaId(disease)), String(view.probeCount), formatNumber(view.articles), phaseLabel(view.pair.phase)]) row.append(node("td", "", value));
    const action = node("td");
    const button = node("button", "mini-button", "View evidence");
    button.type = "button";
    button.setAttribute("aria-label", `View evidence for ${target.name} and ${disease.name}`);
    button.addEventListener("click", () => openDetail(view));
    action.append(button);
    row.append(action);
    body.append(row);
  }
  if (!viewPairs.length) {
    const row = node("tr");
    const cell = node("td", "empty-state", "No matching pairs.");
    cell.colSpan = 7;
    row.append(cell);
    body.append(row);
  }
  elements["page-status"].textContent = viewPairs.length
    ? `Showing ${formatNumber(start + 1)}–${formatNumber(Math.min(start + PAGE_SIZE, viewPairs.length))} of ${formatNumber(viewPairs.length)}`
    : "0 pairs";
  elements["page-prev"].disabled = page === 0;
  elements["page-next"].disabled = start + PAGE_SIZE >= viewPairs.length;
}

function csvValue(value) {
  const string = String(value ?? "");
  const safe = /^[=+@-]/.test(string) ? `'${string}` : string;
  return `"${safe.replaceAll('"', '""')}"`;
}
function downloadCSV() {
  const header = ["targetId", "geneName", "diseaseId", "diseaseName", "therapeuticAreaId", "therapeuticArea", "distinctProbes", "distinctArticles", "maxClinicalPhase", "probeIds", "articleIds"];
  const lines = [header.map(csvValue).join(",")];
  for (const view of viewPairs) {
    const target = dataset.targets[view.pair.targetIndex];
    const disease = dataset.diseases[view.pair.diseaseIndex];
    const values = [target.id, target.name, disease.id, disease.name, areaId(disease), areaName(areaId(disease)), view.probeCount, view.articles, view.pair.phase ?? "", view.groups.map(([index]) => dataset.probes[index].id).join(";"), sortedArticleIds(view.articleIds).join(";")];
    lines.push(values.map(csvValue).join(","));
  }
  const url = URL.createObjectURL(new Blob([lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" }));
  const link = node("a");
  link.href = url;
  link.download = "chemical-probe-evidence-filtered.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bindControls() {
  elements["min-articles"].addEventListener("input", (event) => { state.minArticles = Math.max(1, Number.parseInt(event.target.value, 10) || 1); applyFilters(); });
  elements["hide-flagged"].addEventListener("change", (event) => { state.hideFlagged = event.target.checked; applyFilters(); });
  elements["row-sort"].addEventListener("change", (event) => { state.rowSort = event.target.value; applyFilters(); });
  elements["col-sort"].addEventListener("change", (event) => { state.colSort = event.target.value; applyFilters(); });
  elements["show-empty"].addEventListener("change", (event) => { state.showEmpty = event.target.checked; applyFilters(); });
  elements["reset-filters"].addEventListener("click", () => {
    state.query = "";
    for (const key of ["targets", "diseases", "areas", "probes", "phases"]) state[key].clear();
    state.minArticles = 1;
    state.hideFlagged = false;
    state.rowSort = "area";
    state.colSort = "name";
    state.showEmpty = false;
    syncSimpleControls();
    applyFilters();
  });
  elements["page-prev"].addEventListener("click", () => { page--; renderTable(); });
  elements["page-next"].addEventListener("click", () => { page++; renderTable(); });
  elements["download-csv"].addEventListener("click", downloadCSV);
  elements["close-detail"].addEventListener("click", closeDetail);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && selectedPair) closeDetail(); });
  elements["matrix-viewport"].addEventListener("scroll", scheduleDraw);
  elements["matrix-canvas"].addEventListener("mousemove", (event) => {
    const view = cellAt(event);
    hoveredPair = view?.pair || null;
    elements["matrix-canvas"].style.cursor = view ? "pointer" : "default";
    if (view) showTooltip(view, event.clientX, event.clientY);
    else elements["matrix-tooltip"].hidden = true;
  });
  elements["matrix-canvas"].addEventListener("mouseleave", () => { hoveredPair = null; elements["matrix-tooltip"].hidden = true; });
  elements["matrix-canvas"].addEventListener("click", (event) => { const view = cellAt(event); if (view) openDetail(view); });
  elements["matrix-viewport"].addEventListener("keydown", (event) => {
    const movement = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[event.key];
    if (movement && rows.length && columns.length) {
      event.preventDefault();
      keyboardCell = keyboardCell || { row: 0, column: 0 };
      keyboardCell.row = clamp(keyboardCell.row + movement[0], 0, rows.length - 1);
      keyboardCell.column = clamp(keyboardCell.column + movement[1], 0, columns.length - 1);
      const viewport = elements["matrix-viewport"];
      const x = LEFT + keyboardCell.column * CELL_SIZE;
      const y = TOP + keyboardCell.row * CELL_SIZE;
      if (x - viewport.scrollLeft < LEFT) viewport.scrollLeft = x - LEFT;
      if (x + CELL_SIZE - viewport.scrollLeft > viewport.clientWidth) viewport.scrollLeft = x + CELL_SIZE - viewport.clientWidth;
      if (y - viewport.scrollTop < TOP) viewport.scrollTop = y - TOP;
      if (y + CELL_SIZE - viewport.scrollTop > viewport.clientHeight) viewport.scrollTop = y + CELL_SIZE - viewport.clientHeight;
      const target = dataset.targets[columns[keyboardCell.column]];
      const disease = dataset.diseases[rows[keyboardCell.row]];
      const view = cellMap.get(pairKey(columns[keyboardCell.column], rows[keyboardCell.row]));
      viewport.setAttribute("aria-label", `${target.name} and ${disease.name}: ${view ? `${view.articles} articles, ${view.probeCount} probes` : "no observed pair"}. Arrow keys navigate; Enter opens details.`);
      scheduleDraw();
    } else if (event.key === "Enter" && keyboardCell) {
      const view = cellMap.get(pairKey(columns[keyboardCell.column], rows[keyboardCell.row]));
      if (view) openDetail(view);
    }
  });
  resizeObserver = new ResizeObserver(resizeMatrix);
  resizeObserver.observe(elements["matrix-viewport"]);
  window.addEventListener("popstate", () => { readURL(); syncSimpleControls(); applyFilters(); });
}

async function start() {
  readURL();
  elements["global-search"].value = state.query;
  elements["global-search"].addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    if (dataset) {
      elements["matrix-viewport"].scrollTo(0, 0);
      applyFilters();
    }
  });
  try {
    const [response, imageResponse] = await Promise.all([
      fetch("./data/dataset.json"),
      fetch("./assets/probes/manifest.json"),
    ]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dataset = await response.json();
    if (imageResponse.ok) {
      const imageManifest = await imageResponse.json();
      probeImagePaths = new Map(Object.entries(imageManifest.files)
        .filter(([probeId, details]) => [`.svg`, `.png`].some((extension) => details.path === `${probeId}${extension}`))
        .map(([probeId, details]) => [probeId, details.path]));
    }
    dataset.maxArticles = Math.max(...dataset.pairs.map((pair) => pair.articleCount));
    renderFilterControls();
    bindControls();
    applyFilters();
  } catch (error) {
    elements["matrix-status"].textContent = `Could not load the dataset (${error.message}). Serve this folder with a local static server.`;
  }
}

start();
