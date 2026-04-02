// EchoBreaker — Side Panel
// Reacts to chrome.storage.session changes pushed by the background service worker.
// This is more reliable than chrome.runtime.sendMessage in MV3.

const $ = (id) => document.getElementById(id);

const views = {
  idle:    $("view-idle"),
  confirm: $("view-confirm"),
  loading: $("view-loading"),
  results: $("view-results"),
  error:   $("view-error"),
};

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

    case "started":
      startLoadingView(state.tweetData, state.warnings || []);
      break;

    case "progress":
      updateProgress(state.progress.completed, state.progress.total);
      break;

    case "complete":
      if (state.record) renderResults(state.record);
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
  $("progress-count").textContent = "0 / 500";
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
    ? "Do Americans agree with this?"
    : "How do Americans feel about this?";

  renderLikertChart($("overall-chart"), results.overall, labels);
  populateDimensionSelect(results, labels, keys);
  renderTopList($("top-agreeing"), results.top_agreeing, "positive");
  renderTopList($("top-disagreeing"), results.top_disagreeing, "negative");
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

function renderBreakdown(results, dimensionKey, labels, keys) {
  const container = $("breakdown-chart");
  container.innerHTML = "";

  const groups = results[dimensionKey];
  if (!groups) return;

  Object.entries(groups).forEach(([groupName, dist]) => {
    const agreePct = ((dist[keys[0]] || 0) + (dist[keys[1]] || 0)) * 100;
    const disagreePct = ((dist[keys[3]] || 0) + (dist[keys[4]] || 0)) * 100;

    const agreeWord = labels[keys[0]].split(" ")[0];
    const disagreeWord = labels[keys[4]].split(" ").slice(-1)[0];

    const group = document.createElement("div");
    group.className = "breakdown-group";
    group.innerHTML = `
      <div class="breakdown-group-label">${groupName}</div>
      <div class="breakdown-bar-row">
        <div class="agree-pill">${agreeWord} ${agreePct.toFixed(0)}%</div>
        <div class="disagree-pill">${disagreeWord} ${disagreePct.toFixed(0)}%</div>
      </div>
    `;
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

function renderTopList(container, segments, type) {
  container.innerHTML = "";
  if (!segments?.length) { container.textContent = "—"; return; }

  segments.forEach((seg) => {
    const pct = type === "positive"
      ? (seg.agree_pct * 100).toFixed(0)
      : (seg.disagree_pct * 100).toFixed(0);
    const dimLabel = DIMENSION_LABELS["by_" + seg.dimension] || seg.dimension;
    const item = document.createElement("div");
    item.className = "top-item";
    item.innerHTML = `
      <span class="top-item-label">${dimLabel}: ${seg.group}</span>
      <span class="top-item-pct">${pct}%</span>
    `;
    container.appendChild(item);
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
