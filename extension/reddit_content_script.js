// EchoBreaker — Reddit Content Script
// Works on reddit.com. Detects shreddit-post and shreddit-comment web components,
// injects a hover button, and extracts the full context chain.
//
// Context chain:
//   Post        → analyze post text alone
//   Comment     → text + post as background context
//   Reply       → text + parent comment + post as background context

const HOVER_SHOW_DELAY = 600;
const HOVER_HIDE_DELAY = 350;

let hoverTimer = null;
let hideTimer = null;
let activeButton = null;
let activeEl = null;

// ---------------------------------------------------------------------------
// Button (same SVG / CSS class as Twitter button — reuses content_script.css)
// ---------------------------------------------------------------------------
function createButton() {
  const btn = document.createElement("button");
  btn.className = "echobreaker-btn";
  btn.title = "Analyze with EchoBreaker";
  btn.setAttribute("aria-label", "Analyze with EchoBreaker");
  btn.innerHTML = `
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1 8h2l2-5 3 10 2-7 1 2h4" stroke="white" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  return btn;
}

function positionButton(btn, el) {
  const rect = el.getBoundingClientRect();
  btn.style.top  = `${rect.top  + 10}px`;
  btn.style.left = `${rect.right - 40}px`;
}

// ---------------------------------------------------------------------------
// Post extraction
// ---------------------------------------------------------------------------
function extractPostText(postEl) {
  const titleEl =
    postEl.querySelector('[slot="title"]') ||
    postEl.querySelector('h1') ||
    postEl.querySelector('[data-adclicklocation="title"]');
  const title = titleEl?.innerText?.trim() || "";

  const bodyEl =
    postEl.querySelector('[slot="text-body"]') ||
    postEl.querySelector('.text-neutral-content') ||
    postEl.querySelector('[data-click-id="text"]');
  const body = bodyEl?.innerText?.trim() || "";

  return body ? `${title}\n\n${body}` : title;
}

function extractPostAuthor(postEl) {
  const el =
    postEl.querySelector('[data-testid="post_author_link"]') ||
    postEl.querySelector('a[href*="/user/"]');
  if (!el) return "";
  const raw = el.innerText?.trim() || "";
  return raw.startsWith("u/") ? raw : `u/${raw}`;
}

function extractPostMedia(postEl) {
  const has_image = !!(
    postEl.querySelector('img[src*="preview.redd.it"]') ||
    postEl.querySelector('img[src*="i.redd.it"]') ||
    postEl.querySelector('[slot="thumbnail"] img') ||
    postEl.querySelector('[data-testid="post-image"] img')
  );
  const has_video = !!(
    postEl.querySelector('video') ||
    postEl.querySelector('shreddit-player') ||
    postEl.querySelector('a[href*="v.redd.it"]')
  );
  return { has_image, has_video };
}

// ---------------------------------------------------------------------------
// Comment extraction
// ---------------------------------------------------------------------------
function extractCommentText(commentEl) {
  // id^="comment-rtjson-content" is unique per comment and comes before
  // any nested shreddit-comment children, so the first match is correct.
  const rtjson = commentEl.querySelector('[id^="comment-rtjson-content"]');
  if (rtjson) return rtjson.innerText?.trim() || "";

  // Fallback: clone, strip nested comments, grab remaining text
  const clone = commentEl.cloneNode(true);
  clone.querySelectorAll("shreddit-comment").forEach((c) => c.remove());
  return (
    clone.querySelector(".md")?.innerText?.trim() ||
    clone.querySelector("p")?.innerText?.trim() ||
    ""
  );
}

function extractCommentAuthor(commentEl) {
  const el =
    commentEl.querySelector('a[data-testid="comment_author_link"]') ||
    commentEl.querySelector('a[href*="/user/"]');
  if (!el) return "";
  const raw = el.innerText?.trim() || "";
  return raw.startsWith("u/") ? raw : `u/${raw}`;
}

// ---------------------------------------------------------------------------
// Build the tweetData payload for background.js
// ---------------------------------------------------------------------------
function buildRedditData(el) {
  const tag = el.tagName;

  // ── Post ──────────────────────────────────────────────────────────────────
  if (tag === "SHREDDIT-POST") {
    const text = extractPostText(el);
    const author_handle = extractPostAuthor(el);
    const { has_image, has_video } = extractPostMedia(el);
    return {
      text,
      url: window.location.href,
      author_name: "",
      author_handle,
      replying_to: null,
      parent_tweet: null,
      quote_tweet: null,
      has_image,
      has_video,
    };
  }

  // ── Comment / Reply ───────────────────────────────────────────────────────
  if (tag === "SHREDDIT-COMMENT") {
    const text = extractCommentText(el);
    const author_handle = extractCommentAuthor(el);
    const depth = parseInt(el.getAttribute("depth") || "0", 10);

    // Post is always the root context on a post detail page
    const postEl = document.querySelector("shreddit-post");
    const postText = postEl ? extractPostText(postEl) : "";
    const postAuthor = postEl ? extractPostAuthor(postEl) : "";
    // Warn about post media even when analyzing a comment —
    // the post image/video can't be included as context
    const { has_image, has_video } = postEl
      ? extractPostMedia(postEl)
      : { has_image: false, has_video: false };

    let parent_tweet = null;
    let replying_to = null;

    if (depth === 0) {
      // Top-level comment → include post as context
      if (postText) {
        parent_tweet = { text: postText, author_name: "", author_handle: postAuthor };
        replying_to = postAuthor || "post";
      }
    } else {
      // Reply to a comment → include parent comment + post as context
      const parentCommentEl = el.parentElement?.closest("shreddit-comment");
      const parentText   = parentCommentEl ? extractCommentText(parentCommentEl)  : "";
      const parentAuthor = parentCommentEl ? extractCommentAuthor(parentCommentEl) : "";

      let contextText = "";
      if (postText)   contextText += `[Post by ${postAuthor}]\n${postText}\n\n`;
      if (parentText) contextText += `[Comment by ${parentAuthor}]\n${parentText}`;

      if (contextText) {
        parent_tweet = { text: contextText.trim(), author_name: "", author_handle: postAuthor };
        replying_to = parentAuthor || "comment";
      }
    }

    return {
      text,
      url: window.location.href,
      author_name: "",
      author_handle,
      replying_to,
      parent_tweet,
      quote_tweet: null,
      has_image,
      has_video,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Show / hide button
// ---------------------------------------------------------------------------
function showButton(el) {
  removeActiveButton();
  const btn = createButton();
  positionButton(btn, el);
  document.body.appendChild(btn);
  requestAnimationFrame(() => requestAnimationFrame(() => btn.classList.add("visible")));
  btn.addEventListener("click", (e) => onButtonClick(e, el));
  btn.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  btn.addEventListener("mouseleave", () => scheduleHide());
  activeButton = btn;
  activeEl = el;
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(removeActiveButton, HOVER_HIDE_DELAY);
}

function removeActiveButton() {
  if (activeButton) {
    activeButton.remove();
    activeButton = null;
    activeEl = null;
  }
}

window.addEventListener("scroll", () => {
  if (activeButton && activeEl) positionButton(activeButton, activeEl);
}, { passive: true });

// ---------------------------------------------------------------------------
// Click handler
// ---------------------------------------------------------------------------
function onButtonClick(e, el) {
  e.stopPropagation();
  e.preventDefault();

  const data = buildRedditData(el);
  if (!data?.text) return;

  const btn = e.currentTarget;
  btn.classList.add("pulsing", "queued");
  btn.removeEventListener("click", onButtonClick);
  setTimeout(() => btn.classList.remove("pulsing"), 400);

  if (!chrome.runtime?.sendMessage) {
    alert("EchoBreaker lost its connection. Please refresh the page.");
    return;
  }
  chrome.runtime.sendMessage({ type: "ANALYZE_TWEET", data });
}

// ---------------------------------------------------------------------------
// DOM scanning
// ---------------------------------------------------------------------------
function scan() {
  document.querySelectorAll("shreddit-post, shreddit-comment").forEach((el) => {
    if (el.dataset.ebAttached) return;
    el.dataset.ebAttached = "1";

    el.addEventListener("mouseenter", () => {
      clearTimeout(hideTimer);
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => showButton(el), HOVER_SHOW_DELAY);
    });
    el.addEventListener("mouseleave", () => {
      clearTimeout(hoverTimer);
      scheduleHide();
    });
  });
}

scan();
const observer = new MutationObserver(scan);
observer.observe(document.body, { childList: true, subtree: true });
