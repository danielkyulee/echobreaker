// EchoBreaker — Content Script
// Runs on Twitter/X. Detects tweets, extracts full context, injects hover button.
//
// Button is attached to document.body with position:fixed to avoid being
// clipped by tweet cards that use overflow:hidden.

const HOVER_SHOW_DELAY = 800;
const HOVER_HIDE_DELAY = 350;

let hoverTimer = null;
let hideTimer = null;
let activeButton = null;
let activeTweetEl = null;

// ---------------------------------------------------------------------------
// Button creation
// ---------------------------------------------------------------------------
function createButton() {
  const btn = document.createElement("button");
  btn.className = "echobreaker-btn";
  btn.title = "Analyze with EchoBreaker";
  btn.setAttribute("aria-label", "Analyze this tweet with EchoBreaker");
  btn.innerHTML = `
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1 8h2l2-5 3 10 2-7 1 2h4" stroke="white" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  return btn;
}

// ---------------------------------------------------------------------------
// Positioning — fixed to viewport so overflow:hidden on tweet cards is bypassed
// ---------------------------------------------------------------------------
function positionButton(btn, tweetEl) {
  const rect = tweetEl.getBoundingClientRect();
  btn.style.top  = `${rect.bottom - 44}px`;
  btn.style.left = `${rect.right  - 44}px`;
}

// ---------------------------------------------------------------------------
// Tweet data extraction
// ---------------------------------------------------------------------------

function extractAuthor(tweetEl) {
  const userNameEl = tweetEl.querySelector('[data-testid="User-Name"]');
  if (!userNameEl) return { name: "", handle: "" };

  const spans = userNameEl.querySelectorAll("span");
  let name = "";
  let handle = "";

  spans.forEach((span) => {
    const text = span.innerText.trim();
    if (text.startsWith("@") && !handle) handle = text;
    else if (text && !text.startsWith("@") && !name) name = text;
  });

  // Fallback: first line = name, second line = handle
  if (!name || !handle) {
    const lines = userNameEl.innerText.split("\n").map((l) => l.trim()).filter(Boolean);
    name = name || lines[0] || "";
    handle = handle || lines[1] || "";
  }

  return { name, handle };
}

function extractTweetText(tweetEl) {
  const textEl = tweetEl.querySelector('[data-testid="tweetText"]');
  if (!textEl) return "";

  // Attempt to expand "Show more" if present
  const showMore = tweetEl.querySelector('[data-testid="tweet-text-show-more-link"]');
  if (showMore) showMore.click();

  return textEl.innerText.trim();
}

function extractReplyingTo(tweetEl) {
  // Twitter renders "Replying to @handle" in a specific structure
  const replyEl = tweetEl.querySelector('[data-testid="reply-to"]');
  if (replyEl) return replyEl.innerText.replace("Replying to", "").trim();

  // Fallback: scan for the text pattern
  const walker = document.createTreeWalker(tweetEl, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.textContent.trim() === "Replying to") {
      // The @handle is typically in a sibling/nearby element
      const container = node.parentElement?.parentElement;
      if (container) {
        const handleEl = container.querySelector('a[href*="/"]');
        if (handleEl) return handleEl.innerText.trim();
      }
    }
  }
  return null;
}

function extractParentTweet(tweetEl) {
  // On thread/detail pages, the parent tweet is a sibling article above
  // Walk up through cellInnerDiv containers to find the previous tweet article
  const cell = tweetEl.closest('[data-testid="cellInnerDiv"]');
  if (!cell) return null;

  let prev = cell.previousElementSibling;
  let depth = 0;
  while (prev && depth < 5) {
    const parentArticle = prev.querySelector('article[data-testid="tweet"]');
    if (parentArticle) {
      const author = extractAuthor(parentArticle);
      const text = extractTweetText(parentArticle);
      if (text) return { author_name: author.name, author_handle: author.handle, text };
    }
    prev = prev.previousElementSibling;
    depth++;
  }
  return null;
}

function extractTweetData(tweetEl) {
  const author = extractAuthor(tweetEl);
  const text = extractTweetText(tweetEl);

  const timeEl = tweetEl.querySelector("time");
  const url = timeEl?.closest("a")?.href || window.location.href;

  const replyingTo = extractReplyingTo(tweetEl);
  const parentTweet = replyingTo ? extractParentTweet(tweetEl) : null;

  return {
    text,
    url,
    author_name: author.name,
    author_handle: author.handle,
    replying_to: replyingTo,
    parent_tweet: parentTweet,
  };
}

// ---------------------------------------------------------------------------
// Show / hide
// ---------------------------------------------------------------------------
function showButton(tweetEl) {
  removeActiveButton();

  const btn = createButton();
  positionButton(btn, tweetEl);
  document.body.appendChild(btn);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => btn.classList.add("visible"));
  });

  btn.addEventListener("click", onButtonClick);
  btn.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  btn.addEventListener("mouseleave", () => scheduleHide());

  activeButton = btn;
  activeTweetEl = tweetEl;
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(removeActiveButton, HOVER_HIDE_DELAY);
}

function removeActiveButton() {
  if (activeButton) {
    activeButton.remove();
    activeButton = null;
    activeTweetEl = null;
  }
}

window.addEventListener("scroll", () => {
  if (activeButton && activeTweetEl) {
    positionButton(activeButton, activeTweetEl);
  }
}, { passive: true });

// ---------------------------------------------------------------------------
// Click handler
// ---------------------------------------------------------------------------
function onButtonClick(e) {
  e.stopPropagation();
  e.preventDefault();

  if (!activeTweetEl) return;

  const tweetData = extractTweetData(activeTweetEl);
  if (!tweetData.text) return;

  const btn = e.currentTarget;
  btn.classList.add("pulsing", "queued");
  btn.removeEventListener("click", onButtonClick);
  setTimeout(() => btn.classList.remove("pulsing"), 400);

  chrome.runtime.sendMessage({ type: "ANALYZE_TWEET", data: tweetData });
}

// ---------------------------------------------------------------------------
// Attach hover listeners to each tweet article
// ---------------------------------------------------------------------------
function attachListeners(tweetEl) {
  if (tweetEl.dataset.ebAttached) return;
  tweetEl.dataset.ebAttached = "1";

  tweetEl.addEventListener("mouseenter", () => {
    clearTimeout(hideTimer);
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => showButton(tweetEl), HOVER_SHOW_DELAY);
  });

  tweetEl.addEventListener("mouseleave", () => {
    clearTimeout(hoverTimer);
    scheduleHide();
  });
}

// ---------------------------------------------------------------------------
// DOM scanning
// ---------------------------------------------------------------------------
function scanTweets() {
  document.querySelectorAll('article[data-testid="tweet"]').forEach(attachListeners);
}

scanTweets();

const observer = new MutationObserver(scanTweets);
observer.observe(document.body, { childList: true, subtree: true });
