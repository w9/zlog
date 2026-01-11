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

const state = {
  logs: [],
  filteredCount: 0,
  selectedId: null,
  paused: false,
  autoScroll: true,
  wrap: false,
  showPlain: true,
  minLevel: "all",
  search: "",
  fieldKey: "",
  fieldValue: "",
  filterKey: "",
  newSincePause: 0,
  clientMax: 5000,
  statusMeta: "",
};

const dom = {};

function init() {
  cacheDom();
  bindEvents();
  updateStatus("connecting", "waiting for stream");
  loadConfig();
  loadInitialLogs().finally(connectStream);
}

function cacheDom() {
  dom.logList = document.getElementById("logList");
  dom.searchInput = document.getElementById("searchInput");
  dom.levelSelect = document.getElementById("levelSelect");
  dom.fieldKey = document.getElementById("fieldKey");
  dom.fieldValue = document.getElementById("fieldValue");
  dom.toggleAuto = document.getElementById("toggleAuto");
  dom.toggleWrap = document.getElementById("toggleWrap");
  dom.togglePlain = document.getElementById("togglePlain");
  dom.pauseBtn = document.getElementById("pauseBtn");
  dom.clearBtn = document.getElementById("clearBtn");
  dom.copyBtn = document.getElementById("copyBtn");
  dom.countTotal = document.getElementById("countTotal");
  dom.countFiltered = document.getElementById("countFiltered");
  dom.newCount = document.getElementById("newCount");
  dom.statusDot = document.getElementById("statusDot");
  dom.statusText = document.getElementById("statusText");
  dom.statusMeta = document.getElementById("statusMeta");
  dom.detailMeta = document.getElementById("detailMeta");
  dom.detailBody = document.getElementById("detailBody");
}

function bindEvents() {
  let searchTimer = null;
  dom.searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = dom.searchInput.value.trim().toLowerCase();
      renderAll();
    }, 150);
  });

  dom.levelSelect.addEventListener("change", () => {
    state.minLevel = dom.levelSelect.value;
    renderAll();
  });

  dom.fieldKey.addEventListener("input", () => {
    state.fieldKey = dom.fieldKey.value.trim();
    renderAll();
  });

  dom.fieldValue.addEventListener("input", () => {
    state.fieldValue = dom.fieldValue.value.trim().toLowerCase();
    renderAll();
  });

  dom.toggleAuto.addEventListener("change", () => {
    state.autoScroll = dom.toggleAuto.checked;
    if (state.autoScroll) {
      scrollToBottom();
    }
  });

  dom.toggleWrap.addEventListener("change", () => {
    state.wrap = dom.toggleWrap.checked;
    dom.logList.classList.toggle("wrap", state.wrap);
  });

  dom.togglePlain.addEventListener("change", () => {
    state.showPlain = dom.togglePlain.checked;
    renderAll();
  });

  dom.pauseBtn.addEventListener("click", () => {
    setPaused(!state.paused);
  });

  dom.clearBtn.addEventListener("click", () => {
    state.logs = [];
    state.filteredCount = 0;
    state.selectedId = null;
    state.newSincePause = 0;
    dom.detailMeta.textContent = "Select a log line to inspect fields.";
    dom.detailBody.textContent = "{}";
    renderAll();
  });

  dom.copyBtn.addEventListener("click", () => {
    copyDetails();
  });
}

function setPaused(paused) {
  state.paused = paused;
  dom.pauseBtn.textContent = paused ? "Resume" : "Pause";
  updateStatus(dom.statusText.textContent);
  if (!paused) {
    state.newSincePause = 0;
    renderAll();
  }
  updateCounts();
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

function handleEntry(entry) {
  state.logs.push(entry);
  if (state.logs.length > state.clientMax) {
    const extra = state.logs.length - state.clientMax;
    state.logs.splice(0, extra);
    renderAll();
    return;
  }

  if (state.paused) {
    state.newSincePause += 1;
    updateCounts();
    return;
  }

  const currentKey = filterKey();
  if (currentKey !== state.filterKey) {
    renderAll();
    return;
  }

  if (passesFilters(entry)) {
    const row = buildRow(entry);
    dom.logList.appendChild(row);
    state.filteredCount += 1;
    if (state.autoScroll) {
      scrollToBottom();
    }
  }

  updateCounts();
}

function renderAll() {
  state.filterKey = filterKey();
  state.filteredCount = 0;
  dom.logList.innerHTML = "";

  const fragment = document.createDocumentFragment();
  for (const entry of state.logs) {
    if (passesFilters(entry)) {
      fragment.appendChild(buildRow(entry));
      state.filteredCount += 1;
    }
  }

  dom.logList.appendChild(fragment);
  updateCounts();
  if (state.autoScroll && !state.paused) {
    scrollToBottom();
  }
}

function filterKey() {
  return [
    state.minLevel,
    state.search,
    state.fieldKey,
    state.fieldValue,
    state.showPlain,
  ].join("|");
}

function passesFilters(entry) {
  const level = normalizeLevel(entry.level);
  const isPlain = Boolean(entry.parseError) || level === "plain";

  if (!state.showPlain && isPlain) {
    return false;
  }

  if (state.minLevel !== "all") {
    const minRank = levelRank[state.minLevel] || 0;
    const entryRank = levelRank[level] || 0;
    if (entryRank < minRank) {
      return false;
    }
  }

  if (state.search) {
    const haystack = String(entry.raw || "").toLowerCase();
    if (!haystack.includes(state.search)) {
      return false;
    }
  }

  if (state.fieldKey) {
    const fieldValue = getFieldValue(entry, state.fieldKey);
    if (fieldValue === undefined) {
      return false;
    }
    if (state.fieldValue) {
      const normalized = String(fieldValue).toLowerCase();
      if (!normalized.includes(state.fieldValue)) {
        return false;
      }
    }
  } else if (state.fieldValue) {
    const haystack = String(entry.raw || "").toLowerCase();
    if (!haystack.includes(state.fieldValue)) {
      return false;
    }
  }

  return true;
}

function buildRow(entry) {
  const level = normalizeLevel(entry.level);
  const row = document.createElement("div");
  row.className = `log-row level-${level}`;
  row.dataset.id = entry.id;
  row.tabIndex = 0;

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
  msgCell.className = "cell";
  const message = document.createElement("div");
  message.className = "message";
  message.textContent = entry.msg || entry.raw || "";
  msgCell.appendChild(message);

  const meta = buildMeta(entry);
  if (meta.childNodes.length > 0) {
    msgCell.appendChild(meta);
  }

  row.append(timeCell, levelCell, msgCell);

  row.addEventListener("click", () => selectEntry(entry.id));
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      selectEntry(entry.id);
    }
  });

  row.classList.add("new");
  setTimeout(() => row.classList.remove("new"), 400);

  return row;
}

function buildMeta(entry) {
  const meta = document.createElement("div");
  meta.className = "meta";

  const fields = entry.fields || {};
  const picks = [];

  const add = (key, label) => {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      const value = formatValue(fields[key]);
      if (value !== "") {
        picks.push(`${label || key}:${value}`);
      }
    }
  };

  add("channel");
  add("action");
  add("basePath", "path");
  add("term");
  add("hostname", "host");
  add("pid");

  for (const text of picks.slice(0, 4)) {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = text;
    meta.appendChild(pill);
  }

  return meta;
}

function formatValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return "[object]";
  }
  return String(value);
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

function selectEntry(id) {
  state.selectedId = id;
  const entry = state.logs.find((log) => log.id === id);
  if (!entry) {
    return;
  }

  const previous = dom.logList.querySelector(".log-row.selected");
  if (previous) {
    previous.classList.remove("selected");
  }

  const row = dom.logList.querySelector(`[data-id="${id}"]`);
  if (row) {
    row.classList.add("selected");
  }

  const detail = {
    id: entry.id,
    level: entry.level || "unknown",
    time: entry.time || null,
    ingested: entry.ingested || null,
    msg: entry.msg || "",
    raw: entry.raw || "",
    fields: entry.fields || null,
    parseError: entry.parseError || null,
  };

  dom.detailMeta.textContent = `${(entry.level || "unknown").toUpperCase()} - ${entry.time || entry.ingested || ""}`;
  dom.detailBody.textContent = JSON.stringify(detail, null, 2);
}

function copyDetails() {
  const text = dom.detailBody.textContent || "";
  if (!text || text === "{}") {
    return;
  }

  const reset = () => {
    dom.copyBtn.textContent = "Copy JSON";
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      dom.copyBtn.textContent = "Copied";
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
  dom.copyBtn.textContent = "Copied";
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
  dom.countTotal.textContent = state.logs.length;
  dom.countFiltered.textContent = state.filteredCount;
  dom.newCount.textContent = state.paused ? state.newSincePause : 0;
}

function scrollToBottom() {
  dom.logList.scrollTop = dom.logList.scrollHeight;
}

function updateStatus(text, meta) {
  dom.statusText.textContent = text;
  if (typeof meta === "string") {
    state.statusMeta = meta;
  }
  dom.statusMeta.textContent = state.paused ? "paused" : state.statusMeta;

  let color = "#facc15";
  if (text === "connected") {
    color = "#22c55e";
  } else if (text === "reconnecting") {
    color = "#f59e0b";
  } else if (text === "error") {
    color = "#ef4444";
  }

  dom.statusDot.style.background = color;
  dom.statusDot.style.boxShadow = `0 0 10px ${color}66`;
}

document.addEventListener("DOMContentLoaded", init);
