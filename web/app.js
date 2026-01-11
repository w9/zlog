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

const CHANNEL_UNSPECIFIED = "__unspecified__";

const state = {
  logs: [],
  filteredCount: 0,
  selectedId: null,
  paused: false,
  autoScroll: true,
  wrap: false,
  showPlain: true,
  showChannel: false,
  darkMode: false,
  showTags: false,
  minLevel: "all",
  channel: "all",
  search: "",
  fieldKey: "",
  fieldValue: "",
  filterKey: "",
  newSincePause: 0,
  clientMax: 5000,
  altRows: false,
  statusText: "",
  statusMeta: "",
  stickToBottom: true,
  channelOptions: new Set(),
  hasUnspecifiedChannel: false,
};

const dom = {};
const statusClassNames = ["status-green", "status-orange", "status-red", "status-blue"];

function init() {
  cacheDom();
  initTheme();
  bindEvents();
  updateStatus("connecting", "waiting for stream");
  loadConfig();
  loadInitialLogs().finally(connectStream);
  dom.logList.classList.toggle("wrap", state.wrap);
  dom.logList.classList.toggle("alt", state.altRows);
  dom.logList.classList.toggle("tags-on", state.showTags);
  dom.logList.classList.toggle("channel-on", state.showChannel);
}

function cacheDom() {
  dom.shell = document.getElementById("shell");
  dom.logList = document.getElementById("logList");
  dom.searchInput = document.getElementById("searchInput");
  dom.levelSelect = document.getElementById("levelSelect");
  dom.channelSelect = document.getElementById("channelSelect");
  dom.fieldKey = document.getElementById("fieldKey");
  dom.fieldValue = document.getElementById("fieldValue");
  dom.toggleAuto = document.getElementById("toggleAuto");
  dom.toggleWrap = document.getElementById("toggleWrap");
  dom.toggleAlt = document.getElementById("toggleAlt");
  dom.togglePlain = document.getElementById("togglePlain");
  dom.toggleChannel = document.getElementById("toggleChannel");
  dom.toggleDark = document.getElementById("toggleDark");
  dom.toggleTags = document.getElementById("toggleTags");
  dom.pauseBtn = document.getElementById("pauseBtn");
  dom.clearBtn = document.getElementById("clearBtn");
  dom.closeBtn = document.getElementById("closeBtn");
  dom.countTotal = document.getElementById("countTotal");
  dom.countFiltered = document.getElementById("countFiltered");
  dom.newCount = document.getElementById("newCount");
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
  dom.bottomIndicator = document.getElementById("bottomIndicator");
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

  dom.channelSelect.addEventListener("change", () => {
    state.channel = dom.channelSelect.value;
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
      state.stickToBottom = true;
      scrollToBottom();
    }
  });

  dom.toggleWrap.addEventListener("change", () => {
    state.wrap = dom.toggleWrap.checked;
    dom.logList.classList.toggle("wrap", state.wrap);
  });

  dom.toggleAlt.addEventListener("change", () => {
    state.altRows = dom.toggleAlt.checked;
    dom.logList.classList.toggle("alt", state.altRows);
  });

  dom.togglePlain.addEventListener("change", () => {
    state.showPlain = dom.togglePlain.checked;
    renderAll();
  });

  dom.toggleChannel.addEventListener("change", () => {
    state.showChannel = dom.toggleChannel.checked;
    dom.logList.classList.toggle("channel-on", state.showChannel);
    renderAll();
  });

  dom.toggleDark.addEventListener("change", () => {
    setTheme(dom.toggleDark.checked);
  });

  dom.toggleTags.addEventListener("change", () => {
    state.showTags = dom.toggleTags.checked;
    dom.logList.classList.toggle("tags-on", state.showTags);
    renderAll();
  });

  dom.pauseBtn.addEventListener("click", () => {
    setPaused(!state.paused);
  });

  dom.clearBtn.addEventListener("click", () => {
    state.logs = [];
    state.filteredCount = 0;
    state.newSincePause = 0;
    clearSelection();
    renderAll();
  });

  dom.closeBtn.addEventListener("click", () => {
    clearSelection();
  });

  dom.copyRawBtn.addEventListener("click", () => {
    copyRaw();
  });

  dom.bottomIndicator.addEventListener("click", () => {
    if (!state.stickToBottom) {
      scrollToBottom();
    }
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
  if (dom.toggleDark) {
    dom.toggleDark.checked = state.darkMode;
  }
  if (persist) {
    try {
      localStorage.setItem("zlog-theme", state.darkMode ? "dark" : "light");
    } catch (err) {
      // Ignore storage failures.
    }
  }
}

function setPaused(paused) {
  state.paused = paused;
  dom.pauseBtn.textContent = paused ? "Resume" : "Pause";
  updateStatus();
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
  maybeAddChannelOption(entry);
  if (state.logs.length > state.clientMax) {
    const extra = state.logs.length - state.clientMax;
    state.logs.splice(0, extra);
    renderAll();
    return;
  }

  const matchesFilters = passesFilters(entry);
  if (state.paused) {
    if (matchesFilters) {
      state.newSincePause += 1;
    }
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

function renderAll() {
  state.filteredCount = 0;
  dom.logList.innerHTML = "";
  rebuildChannelOptions();
  state.filterKey = filterKey();

  const fragment = document.createDocumentFragment();
  for (const entry of state.logs) {
    if (passesFilters(entry)) {
      fragment.appendChild(buildRow(entry));
      state.filteredCount += 1;
    }
  }

  dom.logList.appendChild(fragment);
  updateCounts();
  if (state.autoScroll && state.stickToBottom && !state.paused) {
    scrollToBottom();
  }
  setStickToBottom(isAtBottom());
}

function filterKey() {
  return [
    state.minLevel,
    state.channel,
    state.search,
    state.fieldKey,
    state.fieldValue,
    state.showPlain,
    state.showChannel,
    state.showTags,
  ].join("|");
}

function passesFilters(entry) {
  const level = normalizeLevel(entry.level);
  const isPlain = Boolean(entry.parseError) || level === "plain";

  if (!state.showPlain && isPlain) {
    return false;
  }

  if (state.channel !== "all") {
    const channelValue = getChannelValue(entry);
    if (state.channel === CHANNEL_UNSPECIFIED) {
      if (isChannelSpecified(channelValue)) {
        return false;
      }
    } else {
      if (!isChannelSpecified(channelValue)) {
        return false;
      }
      if (String(channelValue).trim() !== state.channel) {
        return false;
      }
    }
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
  if (state.selectedId === entry.id) {
    row.classList.add("selected");
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
  const selected = dom.channelSelect.value || state.channel || "all";
  const options = Array.from(state.channelOptions);
  options.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  dom.channelSelect.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All";
  dom.channelSelect.appendChild(allOption);

  const unspecifiedOption = document.createElement("option");
  unspecifiedOption.value = CHANNEL_UNSPECIFIED;
  unspecifiedOption.textContent = "Unspecified";
  dom.channelSelect.appendChild(unspecifiedOption);

  for (const option of options) {
    const opt = document.createElement("option");
    opt.value = option;
    opt.textContent = option;
    dom.channelSelect.appendChild(opt);
  }

  let nextValue = "all";
  if (selected === CHANNEL_UNSPECIFIED || selected === "all") {
    nextValue = selected;
  } else if (state.channelOptions.has(selected)) {
    nextValue = selected;
  }
  dom.channelSelect.value = nextValue;
  state.channel = nextValue;
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
  dom.shell.classList.remove("detail-open");
  if (dom.detailPanel) {
    dom.detailPanel.classList.add("empty");
  }
  const previous = dom.logList.querySelector(".log-row.selected");
  if (previous) {
    previous.classList.remove("selected");
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
  if (dom.bottomIndicator) {
    dom.bottomIndicator.textContent = atBottom ? "at bottom" : "scrolled";
    dom.bottomIndicator.classList.toggle("is-link", !atBottom);
    dom.bottomIndicator.disabled = atBottom;
    setStatusClass(dom.bottomIndicator, atBottom ? "status-green" : "status-orange");
  }
}

function handleKeydown(event) {
  if (event.defaultPrevented || isTypingTarget(event.target)) {
    return;
  }

  switch (event.key) {
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

  selectEntry(id);
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
