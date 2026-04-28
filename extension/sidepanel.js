// EchoBreaker — Side Panel
// Reacts to chrome.storage.session changes pushed by the background service worker.
// This is more reliable than chrome.runtime.sendMessage in MV3.

const $ = (id) => document.getElementById(id);

const views = {
  idle:       $("view-idle"),
  settings:   $("view-settings"),
  confirm:    $("view-confirm"),
  preSurvey:  $("view-pre-survey"),
  loading:    $("view-loading"),
  results:    $("view-results"),
  debrief:    $("view-debrief"),
  error:      $("view-error"),
};

// Research mode state
let researchMode = false;
let participantName = "";
let currentPreSurveyData = null; // holds pre-survey answers + tweetData for debrief

const DIMENSION_LABELS = {
  by_age:        "Age",
  by_gender:     "Gender",
  by_region:     "Region",
  by_urbanicity: "Urbanicity",
  by_education:  "Education",
  by_income:     "Income",
  by_race:       "Race / Ethnicity",
  by_politics:   "Political Affiliation",
};

const SCALE_LABELS = {
  opinion: {
    strongly_agree:    "Strongly Agree",
    somewhat_agree:    "Somewhat Agree",
    neutral:           "Neutral",
    somewhat_disagree: "Somewhat Disagree",
    strongly_disagree: "Strongly Disagree",
    no_opinion:        "No Opinion",
  },
  general: {
    very_positive:     "Very Positive",
    somewhat_positive: "Somewhat Positive",
    neutral:           "Neutral",
    somewhat_negative: "Somewhat Negative",
    very_negative:     "Very Negative",
    no_opinion:        "No Opinion",
  },
};

const BAR_CLASSES = {
  strongly_agree:    "bar-strongly-agree",
  somewhat_agree:    "bar-somewhat-agree",
  neutral:           "bar-neutral",
  somewhat_disagree: "bar-somewhat-disagree",
  strongly_disagree: "bar-strongly-disagree",
  no_opinion:        "bar-no-opinion",
  very_positive:     "bar-strongly-agree",
  somewhat_positive: "bar-somewhat-agree",
  somewhat_negative: "bar-somewhat-disagree",
  very_negative:     "bar-strongly-disagree",
};

// ---------------------------------------------------------------------------
// View switching
// ---------------------------------------------------------------------------
function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle("active", key === name);
  });
}

// ---------------------------------------------------------------------------
// Storage change listener — primary update mechanism
// ---------------------------------------------------------------------------
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.surveyState) {
    handleState(changes.surveyState.newValue);
  }
});

function handleState(state) {
  if (!state) return;

  updateQueueBadge(state.queueLength || 0);

  switch (state.status) {
    case "queued":
      // A survey is queued but not started yet — just update badge
      break;

    case "checking":
      showCheckingView(state.tweetData);
      break;

    case "confirm":
      showConfirmView(state.tweetData, state.warnings || []);
      break;

    case "cancelled":
      showView("idle");
      loadHistory();
      break;

    case "ready_for_pre_survey":
      if (researchMode) {
        showPreSurvey(state.tweetData, state.tweetType || "opinion");
      }
      break;

    case "started":
      debriefSubmitted = false;
      debriefInitialized = false;
      $("btn-debrief").disabled = false;
      $("btn-debrief").textContent = "Debrief";
      $("btn-debrief").classList.remove("btn-disabled");
      startLoadingView(state.tweetData, state.warnings || []);
      break;

    case "progress":
      updateProgress(state.progress.completed, state.progress.total);
      break;

    case "complete":
      if (state.record) {
        if (currentPreSurveyData) currentPreSurveyData.record = state.record;
        renderResults(state.record);
        $("btn-debrief").classList.toggle("hidden", !researchMode);
      }
      break;

    case "skip":
      showError(state.error || "This tweet doesn't contain a surveyable topic.");
      break;

    case "error":
      showError(state.error || "Something went wrong.");
      break;

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Checking view (while /api/classify runs)
// ---------------------------------------------------------------------------
function showCheckingView(tweetData) {
  showView("loading");
  let preview = "";
  if (tweetData.author_name || tweetData.author_handle) {
    preview += [tweetData.author_name, tweetData.author_handle].filter(Boolean).join(" ") + "\n";
  }
  preview += `"${tweetData.text}"`;
  $("loading-tweet-preview").textContent = preview;
  $("progress-bar").style.width = "0%";
  $("progress-count").textContent = "";
  $("progress-label").textContent = "Analyzing tweet…";
}

// ---------------------------------------------------------------------------
// Confirm view
// ---------------------------------------------------------------------------
function showConfirmView(tweetData, warnings) {
  showView("confirm");
  renderTweetPreviewText($("confirm-tweet-preview"), tweetData);

  const container = $("confirm-warnings");
  container.innerHTML = warnings
    .map((w) => `<div class="context-warning-item">⚠ ${w}</div>`)
    .join("");
}

// ---------------------------------------------------------------------------
// Loading view
// ---------------------------------------------------------------------------
function startLoadingView(tweetData, warnings) {
  showView("loading");

  let preview = "";
  if (tweetData.author_name || tweetData.author_handle) {
    preview += [tweetData.author_name, tweetData.author_handle].filter(Boolean).join(" ") + "\n";
  }
  if (tweetData.replying_to) {
    preview += `↩ Replying to ${tweetData.replying_to}\n`;
  }
  preview += `"${tweetData.text}"`;

  $("loading-tweet-preview").textContent = preview;
  $("progress-bar").style.width = "0%";
  $("progress-count").textContent = "0 / 5000";
  $("progress-label").textContent = "Simulating respondents…";
}

function updateProgress(completed, total) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  $("progress-bar").style.width = `${pct}%`;
  $("progress-count").textContent = `${completed} / ${total}`;
  $("progress-label").textContent = `Simulating respondents… ${pct}%`;
}

// ---------------------------------------------------------------------------
// Results view
// ---------------------------------------------------------------------------
function renderResults(record) {
  showView("results");

  const results = record.results;
  const tweetType = results.tweet_type || "opinion";
  const labels = SCALE_LABELS[tweetType] || SCALE_LABELS.opinion;
  const keys = Object.keys(labels);

  renderTweetPreview($("results-tweet-preview"), record);
  renderWarnings($("results-warnings"), record.warnings || []);

  $("poll-question-label").textContent = tweetType === "opinion"
    ? "Do people agree?"
    : "How do people feel about this?";

  renderLikertChart($("overall-chart"), results.overall, labels);
  populateDimensionSelect(results, labels, keys);
}

function renderTweetPreviewText(container, tweetData) {
  container.innerHTML = "";
  if (tweetData.author_name || tweetData.author_handle) {
    const author = document.createElement("div");
    author.className = "preview-author";
    author.textContent = [tweetData.author_name, tweetData.author_handle].filter(Boolean).join(" · ");
    container.appendChild(author);
  }
  if (tweetData.replying_to) {
    const tag = document.createElement("div");
    tag.className = "preview-reply-label";
    tag.textContent = `↩ Replying to ${tweetData.replying_to}`;
    container.appendChild(tag);
  }
  const text = document.createElement("div");
  text.className = "preview-text";
  text.textContent = `"${tweetData.text}"`;
  container.appendChild(text);
  if (tweetData.quote_tweet?.text) {
    const qt = document.createElement("div");
    qt.className = "preview-parent";
    const who = tweetData.quote_tweet.author_handle || tweetData.quote_tweet.author_name || "";
    qt.innerHTML = `<span class="preview-reply-label">↪ ${who}</span> "${tweetData.quote_tweet.text}"`;
    container.appendChild(qt);
  }
}

function renderTweetPreview(container, record) {
  container.innerHTML = "";

  if (record.authorName || record.authorHandle) {
    const author = document.createElement("div");
    author.className = "preview-author";
    author.textContent = [record.authorName, record.authorHandle].filter(Boolean).join(" · ");
    container.appendChild(author);
  }

  if (record.parentTweet?.text) {
    const parent = document.createElement("div");
    parent.className = "preview-parent";
    const who = record.parentTweet.author_handle || record.parentTweet.author_name || record.replyingTo || "";
    parent.innerHTML = `<span class="preview-reply-label">↩ ${who}</span> "${record.parentTweet.text}"`;
    container.appendChild(parent);
  } else if (record.replyingTo) {
    const tag = document.createElement("div");
    tag.className = "preview-reply-label";
    tag.textContent = `↩ Replying to ${record.replyingTo}`;
    container.appendChild(tag);
  }

  if (record.quoteTweet?.text) {
    const qt = document.createElement("div");
    qt.className = "preview-parent";
    const who = record.quoteTweet.author_handle || record.quoteTweet.author_name || "";
    qt.innerHTML = `<span class="preview-reply-label">↪ ${who}</span> "${record.quoteTweet.text}"`;
    container.appendChild(qt);
  }

  const text = document.createElement("div");
  text.className = "preview-text";
  text.textContent = `"${record.tweetText}"`;
  container.appendChild(text);
}

function renderWarnings(container, warnings) {
  if (!warnings?.length) {
    container.classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");
  container.innerHTML = warnings
    .map((w) => `<div class="context-warning-item">⚠ ${w}</div>`)
    .join("");
}

function populateDimensionSelect(results, labels, keys) {
  const select = $("dimension-select");
  select.innerHTML = "";

  Object.keys(DIMENSION_LABELS).forEach((key) => {
    if (results[key]) {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = DIMENSION_LABELS[key];
      select.appendChild(opt);
    }
  });

  renderBreakdown(results, select.value, labels, keys);
  select.onchange = () => renderBreakdown(results, select.value, labels, keys);
}

// Preferred display order for dimensions that need explicit ordering
const DIMENSION_ORDER = {
  by_education: ["No college", "Some college", "Bachelor's degree", "Graduate degree"],
  by_income:    ["Under $30K", "$30K-$60K", "$60K-$100K", "Over $100K"],
  by_race:      ["Asian", "Black", "Hispanic", "White", "Other"],
  by_politics:  ["Far Left Democrat", "Left Democrat", "Lean Democrat", "Moderate", "Moderate Republican", "Right Republican", "Far Right Republican", "Independent"],
};

function renderBreakdown(results, dimensionKey, labels, keys) {
  const container = $("breakdown-chart");
  container.innerHTML = "";

  const groups = results[dimensionKey];
  if (!groups) return;

  // Use explicit order if defined, otherwise use the order from the data
  const order = DIMENSION_ORDER[dimensionKey];
  const entries = order
    ? order.filter((name) => groups[name]).map((name) => [name, groups[name]])
    : Object.entries(groups);

  entries.forEach(([groupName, dist]) => {
    const group = document.createElement("div");
    group.className = "breakdown-group";

    const label = document.createElement("div");
    label.className = "breakdown-group-label";
    label.textContent = groupName;
    group.appendChild(label);

    const chart = document.createElement("div");
    chart.className = "breakdown-likert";
    keys.forEach((key) => {
      const pct = ((dist[key] || 0) * 100).toFixed(1);
      const row = document.createElement("div");
      row.className = "likert-row likert-row-sm";
      row.innerHTML = `
        <div class="likert-label">${labels[key]}</div>
        <div class="likert-bar-track">
          <div class="likert-bar-fill ${BAR_CLASSES[key] || "bar-neutral"}" style="width:${pct}%"></div>
        </div>
        <div class="likert-pct">${pct}%</div>
      `;
      chart.appendChild(row);
    });
    group.appendChild(chart);
    container.appendChild(group);
  });
}

function renderLikertChart(container, dist, labels) {
  container.innerHTML = "";
  Object.entries(labels).forEach(([key, label]) => {
    const pct = ((dist[key] || 0) * 100).toFixed(1);
    const row = document.createElement("div");
    row.className = "likert-row";
    row.innerHTML = `
      <div class="likert-label">${label}</div>
      <div class="likert-bar-track">
        <div class="likert-bar-fill ${BAR_CLASSES[key] || "bar-neutral"}" style="width:${pct}%"></div>
      </div>
      <div class="likert-pct">${pct}%</div>
    `;
    container.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Queue badge
// ---------------------------------------------------------------------------
function updateQueueBadge(queueLength) {
  const el = $("queue-info");
  if (queueLength > 0) {
    el.textContent = `${queueLength} queued`;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------
// Error view
// ---------------------------------------------------------------------------
function showError(message) {
  showView("error");
  $("error-message").textContent = message;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
$("btn-settings").addEventListener("click", () => showView("settings"));
$("btn-settings-back").addEventListener("click", () => { showView("idle"); loadHistory(); });

$("toggle-research").addEventListener("change", async (e) => {
  researchMode = e.target.checked;
  await chrome.storage.local.set({ researchMode });
  $("research-name-row").classList.toggle("hidden", !researchMode);
});

$("input-participant-name").addEventListener("input", async (e) => {
  participantName = e.target.value.trim();
  await chrome.storage.local.set({ participantName });
});

// ---------------------------------------------------------------------------
// Pre-survey (research mode)
// ---------------------------------------------------------------------------
function showPreSurvey(tweetData, tweetType) {
  showView("preSurvey");
  renderTweetPreviewText($("pre-survey-tweet-preview"), tweetData);

  const labels = SCALE_LABELS[tweetType] || SCALE_LABELS.opinion;
  const container = $("pre-survey-sliders");
  container.innerHTML = "";

  Object.entries(labels).forEach(([key, label]) => {
    const row = document.createElement("div");
    row.className = "estimate-row";
    row.innerHTML = `
      <label>${label}</label>
      <input type="range" min="0" max="100" value="0" data-key="${key}" class="est-slider" />
      <input type="number" min="0" max="100" value="0" data-key="${key}" class="est-number" />
    `;
    container.appendChild(row);
  });

  // Sync sliders and number inputs, cap at 100% total
  function clampValue(el) {
    const others = [...container.querySelectorAll(`.est-number:not([data-key="${el.dataset.key}"])`)];
    const othersTotal = others.reduce((s, e) => s + (parseInt(e.value) || 0), 0);
    const max = 100 - othersTotal;
    const clamped = Math.min(Math.max(parseInt(el.value) || 0, 0), max);
    return clamped;
  }

  container.querySelectorAll(".est-slider").forEach((slider) => {
    slider.addEventListener("input", () => {
      const num = container.querySelector(`.est-number[data-key="${slider.dataset.key}"]`);
      const clamped = clampValue({ value: slider.value, dataset: slider.dataset });
      slider.value = clamped;
      num.value = clamped;
      updateEstimateTotal();
    });
  });
  container.querySelectorAll(".est-number").forEach((num) => {
    num.addEventListener("input", () => {
      const slider = container.querySelector(`.est-slider[data-key="${num.dataset.key}"]`);
      const clamped = clampValue(num);
      num.value = clamped;
      slider.value = clamped;
      updateEstimateTotal();
    });
  });

  currentPreSurveyData = { tweetData, tweetType };
  updateEstimateTotal();
}

function updateEstimateTotal() {
  const nums = [...document.querySelectorAll("#pre-survey-sliders .est-number")];
  const total = nums.reduce((s, el) => s + (parseInt(el.value) || 0), 0);
  const el = $("pre-survey-total");
  el.textContent = `Total: ${total}%`;
  el.className = "estimate-total " + (total === 100 ? "valid" : "invalid");
  $("btn-pre-survey-submit").disabled = total !== 100;
}

$("btn-pre-survey-submit").addEventListener("click", () => {
  const estimates = {};
  document.querySelectorAll("#pre-survey-sliders .est-number").forEach((el) => {
    estimates[el.dataset.key] = parseInt(el.value) || 0;
  });
  const cues = $("pre-survey-cues").value.trim();

  currentPreSurveyData.preSurvey = { estimates, cues };

  // Tell background to proceed with the survey
  chrome.runtime.sendMessage({
    type: "PROCEED_AFTER_PRE_SURVEY",
    data: { estimates, cues, participantName },
  });
});

// ---------------------------------------------------------------------------
// Debrief (research mode)
// ---------------------------------------------------------------------------
$("debrief-surprise").addEventListener("input", (e) => {
  $("debrief-surprise-val").textContent = e.target.value;
});

let debriefSubmitted = false;
let debriefInitialized = false;

$("btn-debrief").addEventListener("click", () => {
  showView("debrief");
  if (!debriefInitialized) {
    debriefInitialized = true;
    $("debrief-surprise").value = 5;
    $("debrief-surprise-val").textContent = "5";
    $("debrief-trust").value = "";
    $("debrief-changed").value = "";
    $("debrief-other").value = "";
  }
  if (debriefSubmitted) {
    $("btn-debrief-submit").disabled = true;
    $("btn-debrief-submit").textContent = "Submitted";
  } else {
    $("btn-debrief-submit").disabled = false;
    $("btn-debrief-submit").textContent = "Submit";
  }
  renderDebriefComparison();
});

function renderDebriefComparison() {
  const container = $("debrief-comparison");
  container.innerHTML = "";

  const pre = currentPreSurveyData?.preSurvey;
  const record = currentPreSurveyData?.record;
  if (!pre?.estimates || !record?.results?.overall) return;

  const tweetType = record.results.tweet_type || "opinion";
  const labels = SCALE_LABELS[tweetType] || SCALE_LABELS.opinion;

  const table = document.createElement("div");
  table.className = "comparison-table";
  table.innerHTML = `<div class="comparison-header">
    <div></div><div>Your Estimate</div><div>EchoBreaker</div>
  </div>`;

  Object.entries(labels).forEach(([key, label]) => {
    const userPct = pre.estimates[key] || 0;
    const actualPct = ((record.results.overall[key] || 0) * 100).toFixed(1);
    const row = document.createElement("div");
    row.className = "comparison-row";
    row.innerHTML = `
      <div class="comparison-label">${label}</div>
      <div class="comparison-val">${userPct}%</div>
      <div class="comparison-val">${actualPct}%</div>
    `;
    table.appendChild(row);
  });

  container.appendChild(table);
}

function submitDebrief(postSurvey) {
  if (debriefSubmitted) return;
  debriefSubmitted = true;

  chrome.runtime.sendMessage({
    type: "SUBMIT_DEBRIEF",
    data: {
      postSurvey,
      preSurvey: currentPreSurveyData?.preSurvey || null,
      participantName,
    },
  });
}

$("btn-debrief-submit").addEventListener("click", () => {
  if (debriefSubmitted) return;
  if (!confirm("Are you sure? This is your final answer and cannot be changed.")) return;

  const postSurvey = {
    surprise: parseInt($("debrief-surprise").value),
    trust: $("debrief-trust").value.trim(),
    changed_belief: $("debrief-changed").value.trim(),
    open_response: $("debrief-other").value.trim(),
  };

  submitDebrief(postSurvey);
  debriefSubmitted = true;
  $("btn-debrief").disabled = true;
  $("btn-debrief").textContent = "Submitted";
  $("btn-debrief").classList.add("btn-disabled");
  showView("results");
});

$("btn-debrief-back").addEventListener("click", () => showView("results"));

// ---------------------------------------------------------------------------
// Confirm / dismiss / back buttons
// ---------------------------------------------------------------------------
$("btn-confirm-yes").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CONFIRM_SURVEY" });
});
$("btn-confirm-no").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CANCEL_SURVEY" });
});
$("btn-dismiss").addEventListener("click", () => { showView("idle"); loadHistory(); });
$("btn-back").addEventListener("click", () => { showView("idle"); loadHistory(); });

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
async function loadHistory() {
  const surveyHistory = await chrome.runtime.sendMessage({ type: "GET_HISTORY" });
  const section = $("history-section");
  const list = $("history-list");
  list.innerHTML = "";

  if (!surveyHistory?.length) { section.classList.add("hidden"); return; }
  section.classList.remove("hidden");

  surveyHistory.forEach((record) => {
    const item = document.createElement("div");
    item.className = "history-item";
    const who = [record.authorName, record.authorHandle].filter(Boolean).join(" ");
    const date = new Date(record.completedAt).toLocaleString([], {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    item.innerHTML = `
      <div class="history-item-statement">"${record.tweetText}"</div>
      <div class="history-item-meta">${[who, date].filter(Boolean).join(" · ")}</div>
    `;
    item.addEventListener("click", () => renderResults(record));
    list.appendChild(item);
  });
}

// ---------------------------------------------------------------------------
// Init — read current state from storage and load history
// ---------------------------------------------------------------------------
async function init() {
  // Load research mode settings
  const stored = await chrome.storage.local.get(["researchMode", "participantName"]);
  researchMode = stored.researchMode || false;
  participantName = stored.participantName || "";
  $("toggle-research").checked = researchMode;
  $("research-name-row").classList.toggle("hidden", !researchMode);
  $("input-participant-name").value = participantName;

  await loadHistory();

  // Restore current state if a survey is in progress or just completed
  const { surveyState } = await chrome.storage.session.get("surveyState");
  if (surveyState) {
    handleState(surveyState);
  } else {
    const surveyHistory = await chrome.runtime.sendMessage({ type: "GET_HISTORY" });
    if (surveyHistory?.length) {
      renderResults(surveyHistory[0]);
    }
  }
}

init();
