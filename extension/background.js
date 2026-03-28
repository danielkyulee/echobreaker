// EchoBreaker — Background Service Worker
// Manages the survey queue and API communication.
// Uses chrome.storage.session to push state to the side panel reliably.

const API_BASE = "http://localhost:8080";

// ---------------------------------------------------------------------------
// Queue state
// ---------------------------------------------------------------------------
let surveyQueue = [];
let isProcessing = false;
let currentSurvey = null;

// ---------------------------------------------------------------------------
// State sync via chrome.storage.session
// Side panel listens to onChanged — much more reliable than sendMessage in MV3.
// ---------------------------------------------------------------------------
async function setState(patch) {
  const { surveyState = {} } = await chrome.storage.session.get("surveyState");
  await chrome.storage.session.set({
    surveyState: { ...surveyState, ...patch, queueLength: surveyQueue.length },
  });
}

// ---------------------------------------------------------------------------
// Message router (side panel → background only)
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "ANALYZE_TWEET":
      enqueueSurvey(message.data);
      sendResponse({ queued: true, queueLength: surveyQueue.length });
      break;

    case "GET_HISTORY":
      getHistory().then(sendResponse);
      return true;

    case "GET_STATE":
      sendResponse({ currentSurvey, queueLength: surveyQueue.length, isProcessing });
      break;

    default:
      break;
  }
  return false;
});

// Open side panel when toolbar icon clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// ---------------------------------------------------------------------------
// Queue management
// ---------------------------------------------------------------------------
function enqueueSurvey(tweetData) {
  surveyQueue.push(tweetData);
  setState({ status: "queued", queueLength: surveyQueue.length });

  if (!isProcessing) processNext();
}

async function processNext() {
  if (surveyQueue.length === 0) {
    isProcessing = false;
    currentSurvey = null;
    return;
  }

  isProcessing = true;
  const tweetData = surveyQueue.shift();
  currentSurvey = { tweetData, status: "running", startedAt: Date.now() };

  // Open the side panel on the active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) await chrome.sidePanel.open({ tabId: tab.id });
  } catch (_) {}

  // Push "started" state — side panel will show loading view
  await setState({
    status: "started",
    tweetData,
    progress: { completed: 0, total: 500 },
    record: null,
    error: null,
  });

  try {
    await runSurvey(tweetData);
  } catch (err) {
    await setState({ status: "error", error: err.message });
  }

  processNext();
}

// ---------------------------------------------------------------------------
// Survey execution
// ---------------------------------------------------------------------------
async function runSurvey(tweetData) {
  const createRes = await fetch(`${API_BASE}/api/survey`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: tweetData.text,
      url: tweetData.url,
      author_name: tweetData.author_name,
      author_handle: tweetData.author_handle,
      replying_to: tweetData.replying_to || null,
      parent_tweet: tweetData.parent_tweet || null,
      persona_count: 500,
    }),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Backend error ${createRes.status}: ${body}`);
  }

  const { survey_id: surveyId } = await createRes.json();
  await streamResults(surveyId, tweetData);
}

async function streamResults(surveyId, tweetData) {
  const res = await fetch(`${API_BASE}/api/survey/${surveyId}/stream`);
  if (!res.ok) throw new Error(`Stream error: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEventType = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEventType = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));

        if (currentEventType === "classified") {
          await setState({ tweetType: data.tweet_type, disclaimer: data.disclaimer });

        } else if (currentEventType === "progress") {
          await setState({ status: "progress", progress: data });

        } else if (currentEventType === "skip") {
          await setState({ status: "skip", error: data.message });

        } else if (currentEventType === "complete") {
          const record = {
            id: surveyId,
            tweetText: tweetData.text,
            tweetUrl: tweetData.url,
            authorName: tweetData.author_name,
            authorHandle: tweetData.author_handle,
            replyingTo: tweetData.replying_to || null,
            parentTweet: tweetData.parent_tweet || null,
            completedAt: Date.now(),
            results: data,
          };
          await saveToHistory(record);
          await setState({ status: "complete", record });

        } else if (currentEventType === "error") {
          throw new Error(data.message || "Unknown backend error");
        }

        currentEventType = null;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// History (chrome.storage.local, max 200 entries)
// ---------------------------------------------------------------------------
async function saveToHistory(record) {
  const { surveyHistory = [] } = await chrome.storage.local.get("surveyHistory");
  surveyHistory.unshift(record);
  if (surveyHistory.length > 200) surveyHistory.splice(200);
  await chrome.storage.local.set({ surveyHistory });
}

async function getHistory() {
  const { surveyHistory = [] } = await chrome.storage.local.get("surveyHistory");
  return surveyHistory;
}
