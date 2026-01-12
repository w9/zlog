const levelRank = {
  all: 0,
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  plain: 0,
  unknown: 0,
};

const levelOrder = ["trace", "debug", "info", "warn", "error", "fatal"];
const levelLabels = {
  trace: "Trace",
  debug: "Debug",
  info: "Info",
  warn: "Warn",
  error: "Error",
  fatal: "Fatal",
};

const CHANNEL_ALL = "__all__";
const CHANNEL_UNSPECIFIED = "__unspecified__";

const state = {
  logs: [],
  filteredCount: 0,
  selectedId: null,
  selectedIds: new Set(),
  anchorId: null,
  paused: false,
  autoScroll: true,
  wrap: false,
  showPlain: true,
  showChannel: false,
  darkMode: false,
  showTags: false,
  minLevel: "all",
  maxLevel: "all",
  filters: [],
  nextFilterId: 1,
  draftFilter: null,
  draftFilterRaw: "",
  filterKey: "",
  newSincePause: 0,
  clientMax: 10000,
  altRows: false,
  statusText: "",
  statusMeta: "",
  latencyMeta: "",
  debugLatency: false,
  stickToBottom: true,
  channelOptions: new Set(),
  hasUnspecifiedChannel: false,
  selectedChannels: new Set(),
};

const dom = {};
const statusClassNames = ["status-green", "status-orange", "status-red", "status-blue"];
const filterInputDelay = 150;
let filterInputTimer = null;
let pendingFilterRaw = "";
let pendingFilterExpression = null;
let isUserTyping = false;
const filterStorageKey = "zlog-filters";
const prefsStorageKey = "zlog-prefs";
const latencyStats = {
  samples: [],
  maxSamples: 200,
  lastUpdate: 0,
  updateEveryMs: 1000,
};

function init() {
  cacheDom();
  initLevelRange();
  initTheme();
  initLatencyDebug();
  loadStoredPreferences();
  loadStoredFilters();
  syncToggleButtons();
  bindEvents();
  updateStatus("connecting", "waiting for stream");
  loadConfig();
  loadInitialLogs().finally(connectStream);
  dom.logList.classList.toggle("wrap", state.wrap);
  dom.logList.classList.toggle("alt", state.altRows);
  dom.logList.classList.toggle("tags-on", state.showTags);
  dom.logList.classList.toggle("channel-on", state.showChannel);
  renderFilterTags();
  updateExportButton();
}

function cacheDom() {
  dom.shell = document.getElementById("shell");
  dom.logPanel = document.getElementById("logPanel");
  dom.logList = document.getElementById("logList");
  dom.levelRange = document.getElementById("levelRange");
  dom.levelMinRange = document.getElementById("levelMinRange");
  dom.levelMaxRange = document.getElementById("levelMaxRange");
  dom.levelRangeFill = document.getElementById("levelRangeFill");
  dom.levelMinLabel = document.getElementById("levelMinLabel");
  dom.levelMaxLabel = document.getElementById("levelMaxLabel");
  dom.channelButtons = document.getElementById("channelButtons");
  dom.filterInput = document.getElementById("filterInput");
  dom.toggleAuto = document.getElementById("toggleAuto");
  dom.toggleWrap = document.getElementById("toggleWrap");
  dom.toggleAlt = document.getElementById("toggleAlt");
  dom.togglePlain = document.getElementById("togglePlain");
  dom.toggleChannel = document.getElementById("toggleChannel");
  dom.toggleDark = document.getElementById("toggleDark");
  dom.toggleTags = document.getElementById("toggleTags");
  dom.pauseBtn = document.getElementById("pauseBtn");
  dom.exportBtn = document.getElementById("exportBtn");
  dom.clearBtn = document.getElementById("clearBtn");
  dom.pauseBtnFloat = document.getElementById("pauseBtnFloat");
  dom.exportBtnFloat = document.getElementById("exportBtnFloat");
  dom.clearBtnFloat = document.getElementById("clearBtnFloat");
  dom.pauseBtnFloatLabel = dom.pauseBtnFloat
    ? dom.pauseBtnFloat.querySelector(".log-action-label")
    : null;
  dom.closeBtn = document.getElementById("closeBtn");
  dom.countTotal = document.getElementById("countTotal");
  dom.countFiltered = document.getElementById("countFiltered");
  dom.newCount = document.getElementById("newCount");
  dom.countSelected = document.getElementById("countSelected");
  dom.selectedCount = document.getElementById("selectedCount");
  dom.selectedSep = document.getElementById("selectedSep");
  dom.statusText = document.getElementById("statusText");
  dom.detailPanel = document.querySelector(".detail-panel");
  dom.detailEmpty = document.getElementById("detailEmpty");
  dom.detailLevel = document.getElementById("detailLevel");
  dom.detailTime = document.getElementById("detailTime");
  dom.detailIngested = document.getElementById("detailIngested");
  dom.detailChannel = document.getElementById("detailChannel");
  dom.detailMessage = document.getElementById("detailMessage");
  dom.detailParseError = document.getElementById("detailParseError");
  dom.detailFields = document.getElementById("detailFields");
  dom.detailRaw = document.getElementById("detailRaw");
  dom.copyRawBtn = document.getElementById("copyRawBtn");
  dom.scrollBottomBtn = document.getElementById("scrollBottomBtn");
  dom.logFilters = document.getElementById("logFilters");
  dom.filterInputTag = document.getElementById("filterInputTag");
}

function bindEvents() {
  dom.levelMinRange.addEventListener("input", () => {
    handleLevelRangeInput("min", false);
  });

  dom.levelMaxRange.addEventListener("input", () => {
    handleLevelRangeInput("max", false);
  });

  dom.levelMinRange.addEventListener("change", () => {
    handleLevelRangeInput("min", true);
  });

  dom.levelMaxRange.addEventListener("change", () => {
    handleLevelRangeInput("max", true);
  });

  dom.levelMinRange.addEventListener("pointerdown", () => {
    setActiveLevelRange("min");
  });

  dom.levelMaxRange.addEventListener("pointerdown", () => {
    setActiveLevelRange("max");
  });

  bindRangeLabelDrag(dom.levelMinLabel, "min");
  bindRangeLabelDrag(dom.levelMaxLabel, "max");

  dom.channelButtons.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !dom.channelButtons.contains(button)) {
      return;
    }
    const value = button.dataset.channel || "";
    if (!value) {
      return;
    }
    if (value === CHANNEL_ALL) {
      state.selectedChannels.clear();
    } else if (state.selectedChannels.has(value)) {
      state.selectedChannels.delete(value);
    } else {
      state.selectedChannels.add(value);
    }
    renderChannelOptions();
    renderAll();
    persistPreferences();
  });

  dom.filterInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addFilterFromInput();
    }
  });
  dom.filterInput.addEventListener("input", () => {
    dom.filterInput.setCustomValidity("");
    isUserTyping = true;
    clearTimeout(filterInputTimer);
    filterInputTimer = setTimeout(() => {
      isUserTyping = false;
      handleFilterInputChange();
    }, filterInputDelay);
  });

  dom.toggleAuto.addEventListener("click", () => {
    state.autoScroll = !state.autoScroll;
    setToggleButtonState(dom.toggleAuto, state.autoScroll);
    if (state.autoScroll) {
      state.stickToBottom = true;
      scrollToBottom();
    }
    updateBottomUI();
    persistPreferences();
  });

  dom.toggleWrap.addEventListener("click", () => {
    state.wrap = !state.wrap;
    setToggleButtonState(dom.toggleWrap, state.wrap);
    dom.logList.classList.toggle("wrap", state.wrap);
    persistPreferences();
  });

  dom.toggleAlt.addEventListener("click", () => {
    state.altRows = !state.altRows;
    setToggleButtonState(dom.toggleAlt, state.altRows);
    dom.logList.classList.toggle("alt", state.altRows);
    persistPreferences();
  });

  dom.togglePlain.addEventListener("click", () => {
    state.showPlain = !state.showPlain;
    setToggleButtonState(dom.togglePlain, state.showPlain);
    renderAll();
    persistPreferences();
  });

  dom.toggleChannel.addEventListener("click", () => {
    state.showChannel = !state.showChannel;
    setToggleButtonState(dom.toggleChannel, state.showChannel);
    dom.logList.classList.toggle("channel-on", state.showChannel);
    renderAll();
    persistPreferences();
  });

  dom.toggleDark.addEventListener("click", () => {
    setTheme(!state.darkMode);
  });

  dom.toggleTags.addEventListener("click", () => {
    state.showTags = !state.showTags;
    setToggleButtonState(dom.toggleTags, state.showTags);
    dom.logList.classList.toggle("tags-on", state.showTags);
    renderAll();
    persistPreferences();
  });

  const handlePause = () => {
    setPaused(!state.paused);
  };
  dom.pauseBtn.addEventListener("click", handlePause);
  if (dom.pauseBtnFloat) {
    dom.pauseBtnFloat.addEventListener("click", handlePause);
  }

  const handleExport = () => {
    exportSelected();
  };
  dom.exportBtn.addEventListener("click", handleExport);
  if (dom.exportBtnFloat) {
    dom.exportBtnFloat.addEventListener("click", handleExport);
  }

  const handleClear = () => {
    state.logs = [];
    state.filteredCount = 0;
    state.newSincePause = 0;
    clearSelection();
    renderAll();
  };
  dom.clearBtn.addEventListener("click", handleClear);
  if (dom.clearBtnFloat) {
    dom.clearBtnFloat.addEventListener("click", handleClear);
  }

  dom.closeBtn.addEventListener("click", () => {
    clearSelection();
  });

  dom.copyRawBtn.addEventListener("click", () => {
    copyRaw();
  });

  dom.scrollBottomBtn.addEventListener("click", () => {
    scrollToBottom();
  });

  dom.logList.addEventListener("scroll", () => {
    setStickToBottom(isAtBottom());
  });

  document.addEventListener("keydown", handleKeydown);
}

function initTheme() {
  let initial = "";
  try {
    initial = localStorage.getItem("zlog-theme") || "";
  } catch (err) {
    initial = "";
  }
  if (initial !== "dark" && initial !== "light") {
    const prefersDark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    initial = prefersDark ? "dark" : "light";
  }
  setTheme(initial === "dark", false);
}

function setTheme(isDark, persist = true) {
  state.darkMode = Boolean(isDark);
  document.body.classList.toggle("theme-dark", state.darkMode);
  setToggleButtonState(dom.toggleDark, state.darkMode);
  if (persist) {
    try {
      localStorage.setItem("zlog-theme", state.darkMode ? "dark" : "light");
    } catch (err) {
      // Ignore storage failures.
    }
  }
}

function initLatencyDebug() {
  const params = new URLSearchParams(window.location.search);
  const debugParam = String(params.get("debug") || "").toLowerCase();
  const latencyParam = String(params.get("latency") || "").toLowerCase();
  const hasLatencyParam = params.has("latency");
  const latencyEnabled =
    hasLatencyParam && latencyParam !== "0" && latencyParam !== "false" && latencyParam !== "off";
  state.debugLatency = debugParam === "latency" || latencyEnabled;
  if (!state.debugLatency) {
    state.latencyMeta = "";
  }
}

function syncToggleButtons() {
  setToggleButtonState(dom.toggleAuto, state.autoScroll);
  setToggleButtonState(dom.toggleWrap, state.wrap);
  setToggleButtonState(dom.toggleAlt, state.altRows);
  setToggleButtonState(dom.togglePlain, state.showPlain);
  setToggleButtonState(dom.toggleChannel, state.showChannel);
  setToggleButtonState(dom.toggleDark, state.darkMode);
  setToggleButtonState(dom.toggleTags, state.showTags);
}

function setToggleButtonState(button, isOn) {
  if (!button) {
    return;
  }
  button.dataset.state = isOn ? "on" : "off";
  button.setAttribute("aria-pressed", isOn ? "true" : "false");
}

function loadStoredFilters() {
  let stored = "";
  try {
    stored = localStorage.getItem(filterStorageKey) || "";
  } catch (err) {
    stored = "";
  }
  if (!stored) {
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(stored);
  } catch (err) {
    return;
  }
  if (!Array.isArray(parsed)) {
    return;
  }
  const nextFilters = [];
  for (const rawValue of parsed) {
    if (typeof rawValue !== "string") {
      continue;
    }
    const value = rawValue.trim();
    if (!value) {
      continue;
    }
    const result = parseFilterExpression(value);
    if (!result.ok) {
      continue;
    }
    nextFilters.push({
      id: state.nextFilterId++,
      raw: value,
      expression: result.expression,
    });
  }
  state.filters = nextFilters;
}

function loadStoredPreferences() {
  let stored = "";
  try {
    stored = localStorage.getItem(prefsStorageKey) || "";
  } catch (err) {
    return;
  }
  if (!stored) {
    return;
  }
  let prefs;
  try {
    prefs = JSON.parse(stored);
  } catch (err) {
    return;
  }
  if (typeof prefs !== "object" || prefs === null) {
    return;
  }
  
  // Restore boolean preferences
  if (typeof prefs.autoScroll === "boolean") state.autoScroll = prefs.autoScroll;
  if (typeof prefs.wrap === "boolean") state.wrap = prefs.wrap;
  if (typeof prefs.altRows === "boolean") state.altRows = prefs.altRows;
  if (typeof prefs.showPlain === "boolean") state.showPlain = prefs.showPlain;
  if (typeof prefs.showChannel === "boolean") state.showChannel = prefs.showChannel;
  if (typeof prefs.showTags === "boolean") state.showTags = prefs.showTags;
  
  // Restore level range
  if (typeof prefs.minLevel === "string") state.minLevel = prefs.minLevel;
  if (typeof prefs.maxLevel === "string") state.maxLevel = prefs.maxLevel;
  
  // Restore selected channels
  if (Array.isArray(prefs.selectedChannels)) {
    state.selectedChannels = new Set(prefs.selectedChannels);
  }
  
  // Apply CSS classes based on loaded preferences
  if (dom.logList) {
    dom.logList.classList.toggle("wrap", state.wrap);
    dom.logList.classList.toggle("alt", state.altRows);
    dom.logList.classList.toggle("tags-on", state.showTags);
    dom.logList.classList.toggle("channel-on", state.showChannel);
  }
  
  // Restore level range UI
  if (dom.levelMinRange && dom.levelMaxRange && state.minLevel !== "all" && state.maxLevel !== "all") {
    const minIndex = levelOrder.indexOf(state.minLevel);
    const maxIndex = levelOrder.indexOf(state.maxLevel);
    if (minIndex >= 0 && maxIndex >= 0) {
      dom.levelMinRange.value = String(minIndex);
      dom.levelMaxRange.value = String(maxIndex);
      updateLevelRangeUI(minIndex, maxIndex);
    }
  }
}

function persistPreferences() {
  try {
    const prefs = {
      autoScroll: state.autoScroll,
      wrap: state.wrap,
      altRows: state.altRows,
      showPlain: state.showPlain,
      showChannel: state.showChannel,
      showTags: state.showTags,
      minLevel: state.minLevel,
      maxLevel: state.maxLevel,
      selectedChannels: Array.from(state.selectedChannels),
    };
    localStorage.setItem(prefsStorageKey, JSON.stringify(prefs));
  } catch (err) {
    // Ignore storage failures.
  }
}

function persistFilters() {
  try {
    const payload = state.filters.map((filter) => filter.raw);
    localStorage.setItem(filterStorageKey, JSON.stringify(payload));
  } catch (err) {
    // Ignore storage failures.
  }
}

function setPaused(paused) {
  state.paused = paused;
  dom.pauseBtn.dataset.state = paused ? "on" : "off";
  dom.pauseBtn.setAttribute("aria-pressed", paused ? "true" : "false");
  if (dom.pauseBtnFloat) {
    dom.pauseBtnFloat.dataset.paused = paused ? "true" : "false";
  }
  if (dom.pauseBtnFloatLabel) {
    const label = paused ? "Resume" : "Pause";
    dom.pauseBtnFloatLabel.textContent = label;
  }
  updateStatus();
  if (!paused) {
    state.newSincePause = 0;
    renderAll();
  }
  updateCounts();
  updateBottomUI();
}

function loadConfig() {
  fetch("/config")
    .then((response) => (response.ok ? response.json() : null))
    .then((config) => {
      if (config && Number.isFinite(config.maxEntries)) {
        state.clientMax = config.maxEntries;
      }
    })
    .catch(() => {});
}

function loadInitialLogs() {
  return fetch("/logs")
    .then((response) => response.json())
    .then((data) => {
      if (Array.isArray(data)) {
        state.logs = data;
      }
      renderAll();
    })
    .catch(() => {
      renderAll();
    });
}

function connectStream() {
  const source = new EventSource("/events");

  source.onopen = () => {
    updateStatus("connected", "streaming");
  };

  source.onerror = () => {
    updateStatus("reconnecting", "retrying");
  };

  source.onmessage = (event) => {
    try {
      const entry = JSON.parse(event.data);
      handleEntry(entry);
    } catch (err) {
      updateStatus("error", "invalid payload");
    }
  };
}

function recordLatency(entry) {
  if (!state.debugLatency) {
    return;
  }
  const sentMs = extractSentMs(entry);
  if (!Number.isFinite(sentMs)) {
    return;
  }
  const now = Date.now();
  const latency = now - sentMs;
  if (!Number.isFinite(latency)) {
    return;
  }
  latencyStats.samples.push(latency);
  if (latencyStats.samples.length > latencyStats.maxSamples) {
    latencyStats.samples.shift();
  }
  if (now - latencyStats.lastUpdate < latencyStats.updateEveryMs) {
    return;
  }
  latencyStats.lastUpdate = now;
  updateLatencyMeta();
}

function updateLatencyMeta() {
  const samples = latencyStats.samples.slice().sort((a, b) => a - b);
  if (!samples.length) {
    return;
  }
  const p50 = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  const avg =
    samples.reduce((total, value) => total + value, 0) / samples.length;
  state.latencyMeta = `lag p50 ${formatMs(p50)} p95 ${formatMs(p95)} avg ${formatMs(avg)}`;
  updateStatus();
}

function percentile(sorted, quantile) {
  if (!sorted.length) {
    return 0;
  }
  const index = Math.round((sorted.length - 1) * quantile);
  return sorted[index];
}

function formatMs(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}s`;
  }
  return `${Math.round(value)}ms`;
}

function extractSentMs(entry) {
  const direct = coerceTimestamp(entry.sentMs);
  if (Number.isFinite(direct)) {
    return normalizeEpochMs(direct);
  }
  const fields = entry.fields || {};
  const candidates = [fields.sent_ms, fields.sentMs, fields.sent];
  for (const candidate of candidates) {
    const ts = coerceTimestamp(candidate);
    if (Number.isFinite(ts)) {
      return normalizeEpochMs(ts);
    }
  }
  return null;
}

function coerceTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeEpochMs(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  if (value > 0 && value < 1e11) {
    return value * 1000;
  }
  return value;
}

function handleEntry(entry) {
  state.logs.push(entry);
  recordLatency(entry);
  maybeAddChannelOption(entry);
  const extra = state.logs.length - state.clientMax;
  if (extra > 0) {
    trimOverflow(extra);
  }

  const matchesFilters = passesFilters(entry);
  
  if (state.paused) {
    if (matchesFilters) {
      state.newSincePause += 1;

      console.log("New log while paused:", entry);
    }
    updateCounts();
    return;
  }

  // Skip expensive operations while user is typing
  if (isUserTyping) {
    state.newSincePause += 1;
    updateCounts();
    return;
  }

  const currentKey = filterKey();
  if (currentKey !== state.filterKey) {
    renderAll();
    return;
  }

  if (matchesFilters) {
    const shouldStick = state.autoScroll && state.stickToBottom;
    const row = buildRow(entry);
    dom.logList.appendChild(row);
    state.filteredCount += 1;
    if (shouldStick) {
      scrollToBottom();
    } else {
      state.newSincePause += 1;
    }
  }

  updateCounts();
  setStickToBottom(isAtBottom());
}

function trimOverflow(extra) {
  if (extra <= 0) {
    return;
  }
  const wasAtBottom = isAtBottom();
  const beforeHeight = dom.logList.scrollHeight;
  const removed = state.logs.splice(0, extra);
  let removedVisible = 0;
  let selectionChanged = false;

  for (const entry of removed) {
    const row = dom.logList.querySelector(`[data-id="${entry.id}"]`);
    if (row) {
      row.remove();
      removedVisible += 1;
    }
    if (state.selectedIds.delete(entry.id)) {
      selectionChanged = true;
    }
    if (state.selectedId === entry.id) {
      state.selectedId = null;
      selectionChanged = true;
    }
    if (state.anchorId === entry.id) {
      state.anchorId = null;
    }
  }

  if (removedVisible) {
    state.filteredCount = Math.max(0, state.filteredCount - removedVisible);
  }

  if (selectionChanged) {
    updateRowSelectionUI();
    updateExportButton();
    if (!state.selectedId) {
      clearDetailPanel();
    }
  }

  if (!wasAtBottom) {
    const afterHeight = dom.logList.scrollHeight;
    const delta = beforeHeight - afterHeight;
    if (delta > 0) {
      dom.logList.scrollTop = Math.max(0, dom.logList.scrollTop - delta);
    }
  }
}

function renderAll() {
  state.filteredCount = 0;
  dom.logList.innerHTML = "";
  rebuildChannelOptions();
  state.filterKey = filterKey();

  const fragment = document.createDocumentFragment();
  const visibleIds = [];
  for (const entry of state.logs) {
    if (passesFilters(entry)) {
      fragment.appendChild(buildRow(entry));
      visibleIds.push(entry.id);
      state.filteredCount += 1;
    }
  }

  dom.logList.appendChild(fragment);
  syncSelectionWithVisible(visibleIds);
  updateCounts();
  if (state.autoScroll && state.stickToBottom && !state.paused) {
    scrollToBottom();
  }
  setStickToBottom(isAtBottom());
}

function filterKey() {
  return [
    state.minLevel,
    state.maxLevel,
    channelKey(),
    state.showPlain,
    state.showChannel,
    state.showTags,
    state.filters.map((filter) => filter.raw).join(","),
    state.draftFilterRaw,
  ].join("|");
}

function channelKey() {
  if (!state.selectedChannels.size) {
    return "all";
  }
  return Array.from(state.selectedChannels).sort().join(",");
}

function initLevelRange() {
  if (!dom.levelMinRange || !dom.levelMaxRange) {
    return;
  }
  const maxIndex = levelOrder.length - 1;
  dom.levelMinRange.value = "0";
  dom.levelMaxRange.value = String(maxIndex);
  setActiveLevelRange("max");
  updateLevelRangeUI(0, maxIndex);
  updateLevelRangeState(0, maxIndex);
}

function handleLevelRangeInput(active, commit) {
  if (!dom.levelMinRange || !dom.levelMaxRange) {
    return;
  }
  let minIndex = Number(dom.levelMinRange.value);
  let maxIndex = Number(dom.levelMaxRange.value);
  if (!Number.isFinite(minIndex) || !Number.isFinite(maxIndex)) {
    return;
  }
  if (minIndex > maxIndex) {
    if (active === "min") {
      maxIndex = minIndex;
      dom.levelMaxRange.value = String(maxIndex);
    } else {
      minIndex = maxIndex;
      dom.levelMinRange.value = String(minIndex);
    }
  }
  updateLevelRangeUI(minIndex, maxIndex);
  if (commit && updateLevelRangeState(minIndex, maxIndex)) {
    renderAll();
    persistPreferences();
  }
}

function setActiveLevelRange(active) {
  if (!dom.levelMinRange || !dom.levelMaxRange) {
    return;
  }
  if (active === "min") {
    dom.levelMinRange.style.zIndex = "4";
    dom.levelMaxRange.style.zIndex = "3";
  } else {
    dom.levelMinRange.style.zIndex = "3";
    dom.levelMaxRange.style.zIndex = "4";
  }
}

function updateLevelRangeUI(minIndex, maxIndex) {
  const maxValue = levelOrder.length - 1;
  const minPercent = maxValue > 0 ? (minIndex / maxValue) * 100 : 0;
  const maxPercent = maxValue > 0 ? (maxIndex / maxValue) * 100 : 100;

  if (dom.levelRangeFill) {
    dom.levelRangeFill.style.left = `${Math.min(100, Math.max(0, minPercent))}%`;
    dom.levelRangeFill.style.right = `${Math.min(100, Math.max(0, 100 - maxPercent))}%`;
  }
  const slider = dom.levelRange;
  const padding = slider ? getRangePadding(slider) : { left: 0, right: 0 };
  const sliderWidth = slider ? slider.clientWidth : 0;
  const trackWidth = Math.max(0, sliderWidth - padding.left - padding.right);
  const minLeft = padding.left + trackWidth * (minPercent / 100);
  const maxLeft = padding.left + trackWidth * (maxPercent / 100);

  if (dom.levelMinLabel) {
    dom.levelMinLabel.textContent = levelLabelForIndex(minIndex);
    dom.levelMinLabel.style.left = `${minLeft}px`;
  }
  if (dom.levelMaxLabel) {
    dom.levelMaxLabel.textContent = levelLabelForIndex(maxIndex);
    dom.levelMaxLabel.style.left = `${maxLeft}px`;
  }
}

function bindRangeLabelDrag(label, active) {
  if (!label) {
    return;
  }
  label.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    setActiveLevelRange(active);
    label.setPointerCapture(event.pointerId);
    updateRangeFromPointer(event, active, false);

    const handleMove = (moveEvent) => {
      updateRangeFromPointer(moveEvent, active, false);
    };

    const handleEnd = (endEvent) => {
      updateRangeFromPointer(endEvent, active, true);
      label.removeEventListener("pointermove", handleMove);
      label.removeEventListener("pointerup", handleEnd);
      label.removeEventListener("pointercancel", handleEnd);
      if (label.hasPointerCapture(event.pointerId)) {
        label.releasePointerCapture(event.pointerId);
      }
    };

    label.addEventListener("pointermove", handleMove);
    label.addEventListener("pointerup", handleEnd);
    label.addEventListener("pointercancel", handleEnd);
  });
}

function updateRangeFromPointer(event, active, commit) {
  if (!dom.levelRange || !dom.levelMinRange || !dom.levelMaxRange) {
    return;
  }
  const rect = dom.levelRange.getBoundingClientRect();
  const padding = getRangePadding(dom.levelRange);
  const left = rect.left + padding.left;
  const right = rect.right - padding.right;
  const width = Math.max(1, right - left);
  const clamped = Math.min(right, Math.max(left, event.clientX));
  const percent = (clamped - left) / width;
  const maxIndex = levelOrder.length - 1;
  const index = Math.round(percent * maxIndex);

  if (active === "min") {
    dom.levelMinRange.value = String(index);
  } else {
    dom.levelMaxRange.value = String(index);
  }
  handleLevelRangeInput(active, commit);
}

function getRangePadding(slider) {
  const styles = window.getComputedStyle(slider);
  const left = Number.parseFloat(styles.paddingLeft) || 0;
  const right = Number.parseFloat(styles.paddingRight) || left;
  return { left, right };
}

function updateLevelRangeState(minIndex, maxIndex) {
  const lastIndex = levelOrder.length - 1;
  let nextMin = "all";
  let nextMax = "all";
  if (!(minIndex === 0 && maxIndex === lastIndex)) {
    nextMin = levelOrder[minIndex] || "all";
    nextMax = levelOrder[maxIndex] || "all";
  }
  const changed = nextMin !== state.minLevel || nextMax !== state.maxLevel;
  state.minLevel = nextMin;
  state.maxLevel = nextMax;
  return changed;
}

function levelLabelForIndex(index) {
  const level = levelOrder[index];
  if (!level) {
    return "";
  }
  return levelLabels[level] || level.toUpperCase();
}

function passesFilters(entry) {
  const level = normalizeLevel(entry.level);
  const isPlain = Boolean(entry.parseError) || level === "plain";

  if (!state.showPlain && isPlain) {
    return false;
  }

  if (state.selectedChannels.size) {
    const channelValue = getChannelValue(entry);
    if (!isChannelSpecified(channelValue)) {
      if (!state.selectedChannels.has(CHANNEL_UNSPECIFIED)) {
        return false;
      }
    } else {
      const label = String(channelValue).trim();
      if (!state.selectedChannels.has(label)) {
        return false;
      }
    }
  }

  if (!isPlain && state.minLevel !== "all") {
    const minRank = levelRank[state.minLevel] || 0;
    const entryRank = levelRank[level] || 0;
    if (entryRank < minRank) {
      return false;
    }
  }

  if (!isPlain && state.maxLevel !== "all") {
    const maxRank = levelRank[state.maxLevel] || 0;
    const entryRank = levelRank[level] || 0;
    if (entryRank > maxRank) {
      return false;
    }
  }

  if (state.filters.length || state.draftFilter) {
    const scope = buildFilterScope(entry);
    for (const filter of state.filters) {
      if (!evaluateFilterExpression(filter.expression, scope)) {
        return false;
      }
    }
    if (state.draftFilter && !evaluateFilterExpression(state.draftFilter, scope)) {
      return false;
    }
  }

  return true;
}

function handleFilterInputChange() {
  if (!dom.filterInput) {
    return;
  }
  const raw = dom.filterInput.value.trim();
  if (!raw) {
    setFilterInputState("neutral");
    clearDraftFilter();
    return;
  }
  const parsed = parseFilterExpression(raw);
  if (!parsed.ok) {
    setFilterInputState("invalid");
    clearDraftFilter();
    return;
  }
  setFilterInputState("neutral");
  scheduleDraftFilterUpdate(raw, parsed.expression);
}

function updateDraftFilter(raw, expression) {
  if (state.draftFilterRaw === raw) {
    state.draftFilter = expression;
    return;
  }
  state.draftFilterRaw = raw;
  state.draftFilter = expression;
  renderAll();
}

function clearDraftFilter(shouldRender = true) {
  clearPendingFilterUpdate();
  if (!state.draftFilterRaw) {
    state.draftFilter = null;
    return;
  }
  state.draftFilter = null;
  state.draftFilterRaw = "";
  if (shouldRender) {
    renderAll();
  }
}

function scheduleDraftFilterUpdate(raw, expression) {
  state.draftFilterRaw = raw;
  state.draftFilter = expression;
  renderAll();
}

function clearPendingFilterUpdate() {
  if (filterInputTimer) {
    clearTimeout(filterInputTimer);
    filterInputTimer = null;
  }
  pendingFilterRaw = "";
  pendingFilterExpression = null;
}

function setFilterInputState(stateName) {
  if (!dom.filterInputTag) {
    return;
  }
  dom.filterInputTag.classList.toggle("invalid", stateName === "invalid");
}

function addFilterFromInput() {
  const raw = dom.filterInput.value.trim();
  if (!raw) {
    return;
  }
  const parsed =
    state.draftFilterRaw === raw && state.draftFilter
      ? { ok: true, expression: state.draftFilter }
      : parseFilterExpression(raw);
  if (!parsed.ok) {
    dom.filterInput.setCustomValidity(parsed.error);
    dom.filterInput.reportValidity();
    return;
  }
  dom.filterInput.setCustomValidity("");
  clearPendingFilterUpdate();
  state.filters.push({
    id: state.nextFilterId++,
    raw,
    expression: parsed.expression,
  });
  persistFilters();
  dom.filterInput.value = "";
  setFilterInputState("neutral");
  clearDraftFilter(false);
  renderFilterTags();
  renderAll();
}

function renderFilterTags() {
  if (!dom.logFilters) {
    return;
  }
  dom.logFilters.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const filter of state.filters) {
    const tag = document.createElement("div");
    tag.className = "filter-tag";
    const text = document.createElement("span");
    text.className = "filter-tag-text";
    text.textContent = filter.raw;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "filter-remove";
    remove.textContent = "x";
    remove.addEventListener("click", () => removeFilter(filter.id));
    tag.append(text, remove);
    fragment.appendChild(tag);
  }
  dom.logFilters.appendChild(fragment);
  if (dom.filterInputTag) {
    dom.logFilters.appendChild(dom.filterInputTag);
  }
}

function removeFilter(id) {
  state.filters = state.filters.filter((filter) => filter.id !== id);
  persistFilters();
  renderFilterTags();
  renderAll();
}

function parseFilterExpression(input) {
  const raw = input.trim();
  if (!raw) {
    return { ok: false, error: "Filter is empty." };
  }
  if (/^select\s*\(/i.test(raw)) {
    return { ok: false, error: "Select syntax is not supported." };
  }
  const shorthand = parseMessageContainsShorthand(raw);
  if (shorthand) {
    return { ok: true, expression: shorthand };
  }
  const regexResult = parseRegexShorthand(raw);
  if (regexResult) {
    return regexResult;
  }
  const pathResult = parsePathExpression(raw);
  if (!pathResult.ok) {
    return pathResult;
  }
  let rest = pathResult.rest.trim();
  if (rest.startsWith("?")) {
    rest = rest.slice(1).trim();
  }
  if (!rest) {
    return { ok: true, expression: { type: "exists", path: pathResult.path } };
  }
  const opResult = parseOperatorAndValue(rest);
  if (!opResult.ok) {
    return opResult;
  }
  return {
    ok: true,
    expression: {
      type: "compare",
      path: pathResult.path,
      operator: opResult.operator,
      value: opResult.value,
    },
  };
}

function parseMessageContainsShorthand(expr) {
  const trimmed = expr.trim();
  if (!trimmed || trimmed.startsWith(".") || trimmed.startsWith("/")) {
    return null;
  }
  let value = trimmed;
  if (
    (value.startsWith("\"") && value.endsWith("\"") && value.length > 1) ||
    (value.startsWith("'") && value.endsWith("'") && value.length > 1)
  ) {
    value = value.slice(1, -1);
  }
  return {
    type: "compare",
    path: ["message"],
    operator: "contains",
    value,
  };
}

function parseRegexShorthand(expr) {
  const trimmed = expr.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  if (trimmed === "/") {
    return { ok: false, error: "Regex pattern is empty." };
  }
  let pattern = trimmed.slice(1);
  let flags = "";
  const lastSlash = findLastUnescapedSlash(trimmed);
  if (lastSlash > 0) {
    const tail = trimmed.slice(lastSlash + 1);
    if (/^[gimsuy]*$/.test(tail)) {
      pattern = trimmed.slice(1, lastSlash);
      flags = tail;
    }
  }
  if (!pattern) {
    return { ok: false, error: "Regex pattern is empty." };
  }
  try {
    const regex = new RegExp(pattern, flags);
    return {
      ok: true,
      expression: {
        type: "regex",
        path: ["message"],
        regex,
      },
    };
  } catch (err) {
    return { ok: false, error: "Invalid regex." };
  }
}

function findLastUnescapedSlash(input) {
  for (let i = input.length - 1; i >= 0; i -= 1) {
    if (input[i] === "/" && input[i - 1] !== "\\") {
      return i;
    }
  }
  return -1;
}

function parsePathExpression(input) {
  if (!input.startsWith(".")) {
    return { ok: false, error: "Filters must start with a '.' path." };
  }
  let i = 1;
  const path = [];
  const len = input.length;

  while (i < len) {
    if (input[i] === ".") {
      i += 1;
    }
    if (i >= len) {
      break;
    }
    if (input[i] === "[") {
      const result = parseBracketSegment(input, i);
      if (!result.ok) {
        return result;
      }
      path.push(result.value);
      i = result.nextIndex;
    } else if (input[i] === "\"" || input[i] === "'") {
      const result = parseQuotedString(input, i);
      if (!result.ok) {
        return result;
      }
      path.push(result.value);
      i = result.nextIndex;
    } else if (isIdentifierChar(input[i])) {
      const start = i;
      while (i < len && isIdentifierChar(input[i])) {
        i += 1;
      }
      path.push(input.slice(start, i));
    } else {
      break;
    }

    if (input[i] === "?") {
      i += 1;
    }

    if (i >= len) {
      break;
    }
    if (input[i] === "." || input[i] === "[") {
      continue;
    }
    if (isOperatorStart(input[i]) || isWhitespace(input[i])) {
      break;
    }
    return { ok: false, error: "Unexpected token in path." };
  }

  return { ok: true, path, rest: input.slice(i) };
}

function parseBracketSegment(input, index) {
  let i = index + 1;
  const len = input.length;
  while (i < len && isWhitespace(input[i])) {
    i += 1;
  }
  if (i >= len) {
    return { ok: false, error: "Unclosed bracket in path." };
  }
  let value;
  if (input[i] === "\"" || input[i] === "'") {
    const result = parseQuotedString(input, i);
    if (!result.ok) {
      return result;
    }
    value = result.value;
    i = result.nextIndex;
  } else {
    const start = i;
    while (i < len && !isWhitespace(input[i]) && input[i] !== "]") {
      i += 1;
    }
    const token = input.slice(start, i);
    if (!token) {
      return { ok: false, error: "Empty bracket segment." };
    }
    if (/^-?\d+$/.test(token)) {
      value = Number(token);
    } else {
      value = token;
    }
  }
  while (i < len && isWhitespace(input[i])) {
    i += 1;
  }
  if (input[i] !== "]") {
    return { ok: false, error: "Unclosed bracket in path." };
  }
  return { ok: true, value, nextIndex: i + 1 };
}

function parseOperatorAndValue(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: "Missing operator." };
  }
  const wordMatch = trimmed.match(/^(contains|startswith|endswith)\b/i);
  if (wordMatch) {
    const operator = wordMatch[1].toLowerCase();
    const rest = trimmed.slice(wordMatch[0].length).trim();
    const value = parseValueLiteral(rest);
    if (!value.ok) {
      return value;
    }
    return { ok: true, operator, value: value.value };
  }
  const symbolMatch = trimmed.match(/^(==|!=|>=|<=|>|<)/);
  if (!symbolMatch) {
    return { ok: false, error: "Expected an operator." };
  }
  const operator = symbolMatch[1];
  const rest = trimmed.slice(symbolMatch[0].length).trim();
  const value = parseValueLiteral(rest);
  if (!value.ok) {
    return value;
  }
  return { ok: true, operator, value: value.value };
}

function parseValueLiteral(input) {
  if (!input) {
    return { ok: false, error: "Missing value." };
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: "Missing value." };
  }
  if (trimmed[0] === "\"" || trimmed[0] === "'") {
    const result = parseQuotedString(trimmed, 0);
    if (!result.ok) {
      return result;
    }
    const rest = trimmed.slice(result.nextIndex).trim();
    if (rest) {
      return { ok: false, error: "Unexpected token after quoted value." };
    }
    return { ok: true, value: result.value };
  }

  const token = trimmed.split(/\s+/)[0];
  const rest = trimmed.slice(token.length).trim();
  if (rest) {
    return { ok: false, error: "Unexpected token after value." };
  }
  return { ok: true, value: coerceLiteral(token) };
}

function parseQuotedString(input, index) {
  const quote = input[index];
  let i = index + 1;
  let value = "";
  while (i < input.length) {
    const ch = input[i];
    if (ch === "\\") {
      const next = input[i + 1];
      if (next) {
        value += next;
        i += 2;
        continue;
      }
    }
    if (ch === quote) {
      return { ok: true, value, nextIndex: i + 1 };
    }
    value += ch;
    i += 1;
  }
  return { ok: false, error: "Unterminated string." };
}

function coerceLiteral(value) {
  const lower = value.toLowerCase();
  if (lower === "true") {
    return true;
  }
  if (lower === "false") {
    return false;
  }
  if (lower === "null") {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function evaluateFilterExpression(expression, scope) {
  if (expression.type === "regex") {
    const value = getValueAtPath(scope, expression.path);
    if (value === undefined || value === null) {
      return false;
    }
    return expression.regex.test(String(value));
  }
  const value = getValueAtPath(scope, expression.path);
  if (expression.type === "exists") {
    return value !== undefined && value !== null;
  }
  if (value === undefined || value === null) {
    return false;
  }
  return compareValues(value, expression.operator, expression.value);
}

function getValueAtPath(scope, path) {
  let current = scope;
  for (const segment of path) {
    if (current === undefined || current === null) {
      return undefined;
    }
    if (typeof segment === "number") {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[segment];
    } else if (Object.prototype.hasOwnProperty.call(current, segment)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function compareValues(actual, operator, expected) {
  if (operator === "contains") {
    if (Array.isArray(actual)) {
      return actual.some((item) => valuesEqual(item, expected));
    }
    return String(actual).includes(String(expected));
  }
  if (operator === "startswith") {
    return String(actual).startsWith(String(expected));
  }
  if (operator === "endswith") {
    return String(actual).endsWith(String(expected));
  }

  const leftNum = coerceNumber(actual);
  const rightNum = coerceNumber(expected);
  if (leftNum !== null && rightNum !== null) {
    switch (operator) {
      case "==":
        return leftNum === rightNum;
      case "!=":
        return leftNum !== rightNum;
      case ">":
        return leftNum > rightNum;
      case "<":
        return leftNum < rightNum;
      case ">=":
        return leftNum >= rightNum;
      case "<=":
        return leftNum <= rightNum;
      default:
        return false;
    }
  }

  const leftStr = String(actual);
  const rightStr = String(expected);
  switch (operator) {
    case "==":
      return leftStr === rightStr;
    case "!=":
      return leftStr !== rightStr;
    case ">":
      return leftStr > rightStr;
    case "<":
      return leftStr < rightStr;
    case ">=":
      return leftStr >= rightStr;
    case "<=":
      return leftStr <= rightStr;
    default:
      return false;
  }
}

function valuesEqual(actual, expected) {
  const leftNum = coerceNumber(actual);
  const rightNum = coerceNumber(expected);
  if (leftNum !== null && rightNum !== null) {
    return leftNum === rightNum;
  }
  if (typeof actual === "boolean" && typeof expected === "boolean") {
    return actual === expected;
  }
  return String(actual) === String(expected);
}

function coerceNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed && /^-?\d+(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }
  }
  return null;
}

function buildFilterScope(entry) {
  const scope = entry.fields ? { ...entry.fields } : {};
  assignIfMissing(scope, "level", entry.level);
  assignIfMissing(scope, "time", entry.time);
  assignIfMissing(scope, "ingested", entry.ingested);
  assignIfMissing(scope, "msg", entry.msg);
  assignIfMissing(scope, "message", entry.msg);
  assignIfMissing(scope, "raw", entry.raw);
  assignIfMissing(scope, "parseError", entry.parseError);
  const channelValue = getChannelValue(entry);
  if (channelValue !== undefined && channelValue !== null) {
    assignIfMissing(scope, "channel", channelValue);
    assignIfMissing(scope, "chanel", channelValue);
  }
  return scope;
}

function assignIfMissing(target, key, value) {
  if (!Object.prototype.hasOwnProperty.call(target, key)) {
    target[key] = value;
  }
}

function isIdentifierChar(char) {
  return /[A-Za-z0-9_@-]/.test(char);
}

function isOperatorStart(char) {
  return char === "=" || char === "!" || char === ">" || char === "<";
}

function isWhitespace(char) {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function buildRow(entry) {
  const level = normalizeLevel(entry.level);
  const row = document.createElement("div");
  row.className = `log-row level-${level}`;
  row.dataset.id = entry.id;
  row.tabIndex = 0;
  if (state.selectedIds.has(entry.id)) {
    row.classList.add("selected");
  }
  if (state.selectedId === entry.id) {
    row.classList.add("active");
  }

  const timeCell = document.createElement("div");
  timeCell.className = "cell";
  const timeText = document.createElement("div");
  timeText.className = "time";
  timeText.textContent = entry.time || entry.ingested || "";
  timeCell.appendChild(timeText);

  const levelCell = document.createElement("div");
  levelCell.className = "cell";
  const levelText = document.createElement("div");
  levelText.className = "level";
  levelText.textContent = level.toUpperCase();
  levelCell.appendChild(levelText);

  const msgCell = document.createElement("div");
  msgCell.className = "cell message-cell";
  const message = document.createElement("div");
  message.className = "message";
  message.textContent = sanitizeMessage(entry.msg || entry.raw || "");
  msgCell.appendChild(message);

  let channelCell = null;
  if (state.showChannel) {
    channelCell = document.createElement("div");
    channelCell.className = "cell";
    const channelText = document.createElement("div");
    channelText.className = "channel";
    channelText.textContent = formatChannelDisplay(getChannelValue(entry));
    channelCell.appendChild(channelText);
  }

  if (state.showTags) {
    const tagsCell = document.createElement("div");
    tagsCell.className = "cell tags-cell";
    const tags = buildTags(entry);
    if (tags.childNodes.length > 0) {
      tagsCell.appendChild(tags);
    }
    if (channelCell) {
      row.append(timeCell, levelCell, channelCell, msgCell, tagsCell);
    } else {
      row.append(timeCell, levelCell, msgCell, tagsCell);
    }
  } else {
    if (channelCell) {
      row.append(timeCell, levelCell, channelCell, msgCell);
    } else {
      row.append(timeCell, levelCell, msgCell);
    }
  }

  row.addEventListener("mousedown", (event) => {
    if (event.shiftKey && event.button === 0) {
      event.preventDefault();
    }
  });
  row.addEventListener("click", (event) => handleRowClick(event, entry.id));
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      handleRowClick(event, entry.id);
    }
  });

  row.classList.add("new");
  setTimeout(() => row.classList.remove("new"), 400);

  return row;
}

function buildTags(entry) {
  const container = document.createElement("div");
  container.className = "tags";
  if (!entry.fields) {
    return container;
  }

  const exclude = new Set([
    "msg",
    "message",
    "event",
    "error",
    "err",
    "level",
    "severity",
    "lvl",
    "level_name",
    "time",
    "timestamp",
    "ts",
    "@timestamp",
    "channel",
    "chanel",
  ]);

  for (const [key, value] of Object.entries(entry.fields)) {
    if (exclude.has(key)) {
      continue;
    }
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = formatTag(key, value);
    container.appendChild(tag);
  }

  return container;
}


function formatTag(key, value) {
  if (value === undefined || value === null) {
    return key;
  }
  if (typeof value === "object") {
    return `${key}=${JSON.stringify(value)}`;
  }
  return `${key}=${String(value)}`;
}

function formatChannel(value) {
  if (!isChannelSpecified(value)) {
    return "unspecified";
  }
  return String(value);
}

function formatChannelDisplay(value) {
  if (!isChannelSpecified(value)) {
    return "";
  }
  return String(value);
}

function renderDetailFields(entry) {
  dom.detailFields.innerHTML = "";
  const fields = entry && entry.fields ? entry.fields : null;
  if (!fields || Object.keys(fields).length === 0) {
    const empty = document.createElement("div");
    empty.className = "detail-empty-row";
    empty.textContent = "No extra fields.";
    dom.detailFields.appendChild(empty);
    return;
  }

  const exclude = getUsedFieldKeys(entry);
  const keys = Object.keys(fields)
    .filter((key) => !exclude.has(key.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  if (keys.length === 0) {
    const empty = document.createElement("div");
    empty.className = "detail-empty-row";
    empty.textContent = "No extra fields.";
    dom.detailFields.appendChild(empty);
    return;
  }

  for (const key of keys) {
    const row = document.createElement("div");
    row.className = "detail-row";
    const label = document.createElement("div");
    label.className = "detail-key";
    label.textContent = key;
    const value = document.createElement("div");
    value.className = "detail-value";
    value.textContent = formatDetailValue(fields[key]);
    row.append(label, value);
    dom.detailFields.appendChild(row);
  }
}

function formatDetailValue(value) {
  if (value === undefined || value === null) {
    return "-";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function getUsedFieldKeys(entry) {
  const used = new Set();
  if (!entry || !entry.fields) {
    return used;
  }
  const fields = entry.fields;

  const messageKey = pickMessageKey(fields);
  if (messageKey) {
    used.add(messageKey.toLowerCase());
  }

  const levelKey = findFirstFieldKey(fields, ["level", "severity", "lvl", "level_name"]);
  if (levelKey) {
    used.add(levelKey.toLowerCase());
  }

  const timeKey = pickTimeKey(fields);
  if (timeKey) {
    used.add(timeKey.toLowerCase());
  }

  const channelKey = findFirstFieldKey(fields, ["channel", "chanel"]);
  if (channelKey) {
    used.add(channelKey.toLowerCase());
  }

  const parseErrorKey = findFieldKey(fields, "parseError");
  if (parseErrorKey) {
    used.add(parseErrorKey.toLowerCase());
  }

  return used;
}

function pickMessageKey(fields) {
  const keys = ["msg", "message", "event", "error", "err"];
  for (const key of keys) {
    const found = findFieldKey(fields, key);
    if (!found) {
      continue;
    }
    const value = fields[found];
    if (typeof value === "string") {
      if (value.trim() !== "") {
        return found;
      }
      continue;
    }
    if (value !== undefined && value !== null) {
      return found;
    }
  }
  return "";
}

function pickTimeKey(fields) {
  const keys = ["time", "timestamp", "ts", "@timestamp"];
  for (const key of keys) {
    const found = findFieldKey(fields, key);
    if (!found) {
      continue;
    }
    if (formatTimeValue(fields[found]) !== "") {
      return found;
    }
  }
  return "";
}

function formatTimeValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return isValidTimeNumber(value) ? "time" : "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return isValidTimeNumber(numeric) ? trimmed : "";
    }
    return trimmed;
  }
  return "";
}

function isValidTimeNumber(num) {
  return num > 1e9;
}

function findFirstFieldKey(fields, keys) {
  for (const key of keys) {
    const found = findFieldKey(fields, key);
    if (found) {
      return found;
    }
  }
  return "";
}

function findFieldKey(fields, key) {
  if (!fields) {
    return "";
  }
  if (Object.prototype.hasOwnProperty.call(fields, key)) {
    return key;
  }
  const target = key.toLowerCase();
  for (const fieldKey of Object.keys(fields)) {
    if (fieldKey.toLowerCase() === target) {
      return fieldKey;
    }
  }
  return "";
}

function getFieldValue(entry, key) {
  if (!entry.fields) {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(entry.fields, key)) {
    return entry.fields[key];
  }
  const target = key.toLowerCase();
  for (const fieldKey of Object.keys(entry.fields)) {
    if (fieldKey.toLowerCase() === target) {
      return entry.fields[fieldKey];
    }
  }
  return undefined;
}

function rebuildChannelOptions() {
  state.channelOptions = new Set();
  state.hasUnspecifiedChannel = false;
  for (const entry of state.logs) {
    addChannelValue(getChannelValue(entry));
  }
  renderChannelOptions();
}

function maybeAddChannelOption(entry) {
  addChannelValue(getChannelValue(entry), true);
}

function addChannelValue(value, incremental) {
  if (!isChannelSpecified(value)) {
    if (!state.hasUnspecifiedChannel) {
      state.hasUnspecifiedChannel = true;
      if (incremental) {
        renderChannelOptions();
      }
    }
    return;
  }
  const label = String(value).trim();
  if (!state.channelOptions.has(label)) {
    state.channelOptions.add(label);
    if (incremental) {
      renderChannelOptions();
    }
  }
}

function renderChannelOptions() {
  if (!dom.channelButtons) {
    return;
  }
  const options = new Set(state.channelOptions);
  for (const selected of state.selectedChannels) {
    if (selected !== CHANNEL_UNSPECIFIED) {
      options.add(selected);
    }
  }
  const sorted = Array.from(options);
  sorted.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  dom.channelButtons.innerHTML = "";
  dom.channelButtons.appendChild(
    buildChannelButton("All", CHANNEL_ALL, state.selectedChannels.size === 0),
  );
  dom.channelButtons.appendChild(
    buildChannelButton(
      "Unspecified",
      CHANNEL_UNSPECIFIED,
      state.selectedChannels.has(CHANNEL_UNSPECIFIED),
    ),
  );

  for (const option of sorted) {
    dom.channelButtons.appendChild(
      buildChannelButton(option, option, state.selectedChannels.has(option)),
    );
  }
}

function buildChannelButton(label, value, isActive) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button-group-button";
  button.dataset.channel = value;
  button.setAttribute("aria-pressed", String(Boolean(isActive)));
  button.setAttribute("data-state", isActive ? "on" : "off");
  button.textContent = label;
  return button;
}

function getChannelValue(entry) {
  let value = getFieldValue(entry, "channel");
  if (value === undefined) {
    value = getFieldValue(entry, "chanel");
  }
  return value;
}

function isChannelSpecified(value) {
  if (value === undefined || value === null) {
    return false;
  }
  return String(value).trim() !== "";
}

function handleRowClick(event, id) {
  const isShift = Boolean(event.shiftKey);
  const isToggle = Boolean(event.metaKey || event.ctrlKey);
  const anchor = state.anchorId ?? state.selectedId ?? id;

  if (isShift) {
    const rangeIds = getRangeIds(anchor, id);
    if (!rangeIds.length) {
      setSingleSelection(id);
      return;
    }
    if (isToggle) {
      for (const rangeId of rangeIds) {
        state.selectedIds.add(rangeId);
      }
    } else {
      state.selectedIds.clear();
      for (const rangeId of rangeIds) {
        state.selectedIds.add(rangeId);
      }
    }
    if (state.anchorId === null) {
      state.anchorId = anchor;
    }
    state.selectedId = id;
    state.selectedIds.add(id);
    updateRowSelectionUI();
    selectEntry(id);
    updateExportButton();
    return;
  }

  if (!isToggle) {
    setSingleSelection(id);
    return;
  }

  state.selectedIds.add(id);
  state.selectedId = id;
  state.anchorId = id;
  updateRowSelectionUI();
  selectEntry(id);
  updateExportButton();
}

function setSingleSelection(id) {
  state.selectedIds.clear();
  state.selectedIds.add(id);
  state.selectedId = id;
  state.anchorId = id;
  updateRowSelectionUI();
  selectEntry(id);
  updateExportButton();
}

function getVisibleRowIds() {
  const rows = Array.from(dom.logList.querySelectorAll(".log-row"));
  const ids = [];
  for (const row of rows) {
    const id = Number(row.dataset.id);
    if (Number.isFinite(id)) {
      ids.push(id);
    }
  }
  return ids;
}

function getRangeIds(anchorId, targetId) {
  const ids = getVisibleRowIds();
  const anchorIndex = ids.indexOf(anchorId);
  const targetIndex = ids.indexOf(targetId);
  if (anchorIndex === -1 || targetIndex === -1) {
    return [];
  }
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return ids.slice(start, end + 1);
}

function updateRowSelectionUI() {
  const rows = Array.from(dom.logList.querySelectorAll(".log-row"));
  for (const row of rows) {
    const id = Number(row.dataset.id);
    if (!Number.isFinite(id)) {
      continue;
    }
    row.classList.toggle("selected", state.selectedIds.has(id));
    row.classList.toggle("active", state.selectedId === id);
  }
}

function syncSelectionWithVisible(visibleIds) {
  const visibleSet = new Set(visibleIds);
  let changed = false;

  for (const id of Array.from(state.selectedIds)) {
    if (!visibleSet.has(id)) {
      state.selectedIds.delete(id);
      changed = true;
    }
  }

  if (state.selectedId !== null && !visibleSet.has(state.selectedId)) {
    state.selectedId = null;
    changed = true;
  }

  if (state.anchorId !== null && !visibleSet.has(state.anchorId)) {
    state.anchorId = null;
  }

  if (changed) {
    updateRowSelectionUI();
    if (!state.selectedId) {
      clearDetailPanel();
    }
  }
  updateExportButton();
}

function updateExportButton() {
  // Export button is always enabled (exports all if nothing selected)
  // Update selected count display
  const count = state.selectedIds.size;
  if (count > 0) {
    dom.countSelected.textContent = count;
    dom.selectedCount.style.display = "";
    dom.selectedSep.style.display = "";
  } else {
    dom.selectedCount.style.display = "none";
    dom.selectedSep.style.display = "none";
  }
}

function exportSelected() {
  let entriesToExport;
  
  if (state.selectedIds.size === 0) {
    // Export all logs
    if (state.logs.length > 1000) {
      const confirmed = confirm(`Export all ${state.logs.length} logs?`);
      if (!confirmed) {
        return;
      }
    }
    entriesToExport = state.logs;
  } else {
    // Export selected logs
    const ids = getVisibleRowIds();
    entriesToExport = [];
    for (const id of ids) {
      if (state.selectedIds.has(id)) {
        const entry = state.logs.find((log) => log.id === id);
        if (entry) {
          entriesToExport.push(entry);
        }
      }
    }
  }
  
  if (!entriesToExport.length) {
    return;
  }
  
  const lines = entriesToExport.map(entry => formatExportLine(entry));
  const content = `${lines.join("\n")}\n`;
  const blob = new Blob([content], { type: "application/jsonl" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFilename();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatExportLine(entry) {
  if (isPlainEntry(entry)) {
    return String(entry.raw || "");
  }
  if (typeof entry.raw === "string" && entry.raw.trim() !== "") {
    return entry.raw;
  }
  return JSON.stringify(entry.fields || {});
}

function exportFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `zlog-export-${stamp}.jsonl`;
}

function isPlainEntry(entry) {
  const level = normalizeLevel(entry.level);
  return level === "plain" || Boolean(entry.parseError);
}

function selectEntry(id) {
  state.selectedId = id;
  const entry = state.logs.find((log) => log.id === id);
  if (!entry) {
    clearDetailPanel();
    return;
  }

  dom.shell.classList.add("detail-open");
  dom.detailPanel.classList.remove("empty");

  dom.detailLevel.textContent = (entry.level || "unknown").toUpperCase();
  dom.detailTime.textContent = entry.time || "-";
  dom.detailIngested.textContent = entry.ingested || "-";
  dom.detailChannel.textContent = formatChannel(getChannelValue(entry));
  dom.detailMessage.textContent = entry.msg || entry.raw || "-";
  dom.detailParseError.textContent = entry.parseError || "-";
  dom.detailRaw.textContent = entry.raw || "";
  renderDetailFields(entry);
}

function clearSelection() {
  state.selectedId = null;
  state.selectedIds.clear();
  state.anchorId = null;
  updateRowSelectionUI();
  updateExportButton();
  clearDetailPanel();
}

function clearDetailPanel() {
  dom.shell.classList.remove("detail-open");
  if (dom.detailPanel) {
    dom.detailPanel.classList.add("empty");
  }
  dom.detailLevel.textContent = "-";
  dom.detailTime.textContent = "-";
  dom.detailIngested.textContent = "-";
  dom.detailChannel.textContent = "-";
  dom.detailMessage.textContent = "-";
  dom.detailParseError.textContent = "-";
  dom.detailRaw.textContent = "";
  dom.detailFields.innerHTML = "";
  if (dom.detailEmpty) {
    dom.detailEmpty.textContent = "Select a log line to inspect fields.";
  }
}

function sanitizeMessage(value) {
  return String(value).replace(/[\r\n]+/g, " ");
}

function copyRaw() {
  const text = dom.detailRaw.textContent || "";
  if (!text) {
    return;
  }
  copyText(text, dom.copyRawBtn, "COPY");
}

function copyText(text, button, label) {
  const reset = () => {
    button.textContent = label;
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      button.textContent = "Copied";
      setTimeout(reset, 1200);
    });
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
  button.textContent = "Copied";
  setTimeout(reset, 1200);
}

function normalizeLevel(level) {
  const raw = String(level || "unknown").toLowerCase();
  switch (raw) {
    case "warning":
      return "warn";
    case "err":
      return "error";
    case "critical":
    case "panic":
      return "fatal";
    default:
      return raw;
  }
}

function updateCounts() {
  if (isUserTyping) {
    return; // Skip updates while typing to prevent layout thrashing
  }
  dom.countTotal.textContent = state.logs.length;
  dom.countFiltered.textContent = state.filteredCount;
  dom.newCount.textContent = state.newSincePause;
}

function scrollToBottom() {
  dom.logList.scrollTop = dom.logList.scrollHeight;
  setStickToBottom(true);
}

function isAtBottom() {
  const threshold = 6;
  const { scrollTop, scrollHeight, clientHeight } = dom.logList;
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

function setStickToBottom(atBottom) {
  state.stickToBottom = atBottom;
  if (atBottom && !state.paused && state.newSincePause) {
    state.newSincePause = 0;
    updateCounts();
  }
  updateBottomUI(atBottom);
}

function updateBottomUI(forceAtBottom) {
  const atBottom = typeof forceAtBottom === "boolean" ? forceAtBottom : isAtBottom();
  const showButton = !atBottom;
  if (dom.scrollBottomBtn) {
    dom.scrollBottomBtn.tabIndex = showButton ? 0 : -1;
    dom.scrollBottomBtn.setAttribute("aria-hidden", showButton ? "false" : "true");
    if (!showButton && document.activeElement === dom.scrollBottomBtn) {
      dom.scrollBottomBtn.blur();
    }
  }
  if (dom.logPanel) {
    dom.logPanel.classList.toggle("show-scroll-button", showButton);
    dom.logPanel.classList.toggle(
      "auto-scroll-active",
      state.autoScroll && atBottom,
    );
  }
}

function handleKeydown(event) {
  if (event.defaultPrevented || isTypingTarget(event.target)) {
    return;
  }

  switch (event.key) {
    case "Escape":
      event.preventDefault();
      clearSelection();
      break;
    case "j":
    case "ArrowDown":
      event.preventDefault();
      selectRelative(1);
      break;
    case "k":
    case "ArrowUp":
      event.preventDefault();
      selectRelative(-1);
      break;
    case " ":
    case "Spacebar":
    case "u":
    case "PageUp":
      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        scrollToBottom();
        break;
      }
      event.preventDefault();
      scrollByPage(-1);
      break;
    case "d":
    case "PageDown":
      event.preventDefault();
      scrollByPage(1);
      break;
    default:
      break;
  }
}

function isTypingTarget(target) {
  if (!target) {
    return false;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  return target.isContentEditable;
}

function selectRelative(delta) {
  const rows = Array.from(dom.logList.querySelectorAll(".log-row"));
  if (!rows.length) {
    return;
  }

  let index = rows.findIndex((row) => Number(row.dataset.id) === state.selectedId);
  if (index === -1) {
    index = delta > 0 ? 0 : rows.length - 1;
  } else {
    index = Math.min(rows.length - 1, Math.max(0, index + delta));
  }

  const row = rows[index];
  const id = Number(row.dataset.id);
  if (!Number.isFinite(id)) {
    return;
  }

  setSingleSelection(id);
  row.scrollIntoView({ block: "nearest" });
  setStickToBottom(isAtBottom());
}

function scrollByPage(direction) {
  const offset = dom.logList.clientHeight * 0.9 * direction;
  dom.logList.scrollTop += offset;
  setStickToBottom(isAtBottom());
}

function updateStatus(text, meta) {
  if (typeof text === "string") {
    state.statusText = text;
  }
  if (typeof meta === "string") {
    state.statusMeta = meta;
  }

  const parts = [];
  if (state.statusText) {
    parts.push(state.statusText);
  }
  if (state.paused) {
    parts.push("paused");
  } else if (state.statusMeta) {
    parts.push(state.statusMeta);
  }
  if (state.latencyMeta) {
    parts.push(state.latencyMeta);
  }

  dom.statusText.textContent = parts.join(" ").trim();
  setStatusClass(dom.statusText, statusTextClass(state.statusText));
}

function statusTextClass(text) {
  switch (text) {
    case "connected":
      return "status-green";
    case "reconnecting":
      return "status-orange";
    case "error":
      return "status-red";
    case "connecting":
    default:
      return "status-blue";
  }
}

function setStatusClass(element, className) {
  if (!element) {
    return;
  }
  statusClassNames.forEach((name) => element.classList.remove(name));
  if (className) {
    element.classList.add(className);
  }
}

document.addEventListener("DOMContentLoaded", init);
