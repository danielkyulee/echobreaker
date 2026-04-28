# EchoBreaker

EchoBreaker is a Chrome extension that generates real-time synthetic public-opinion estimates for posts on Twitter/X (and Reddit). When a user clicks the EchoBreaker button on a post, the extension simulates personas using a large language model (Claude) and aggregates their responses into a Likert-scale "poll" with overall and demographic breakdowns. The goal is to help users see past their own echo chamber by showing how a representative cross-section of the U.S. public would likely respond to a given post.

---

## Table of Contents
1. [Repository Layout](#repository-layout)
2. [Milestone Documents](#milestone-documents)
3. [Build and Run](#build-and-run)
4. [Deploying to Production](#deploying-to-production)
5. [External Software & Libraries](#external-software--libraries)
6. [Evaluation](#evaluation)
7. [AI Tool Usage Disclosure](#ai-tool-usage-disclosure)
8. [Documentation for Future Maintainers](#documentation-for-future-maintainers)

---

## Repository Layout

```
echobreak/
├── README.md                       # this file
├── backend/                        # FastAPI backend, deployed to Google Cloud Run
│   ├── main.py                     # API entry: /api/survey, /api/classify, /api/research/session, SSE stream
│   ├── config.py                   # env-driven config (model, batch sizes, ports, …)
│   ├── persona_generator.py        # stratified sampling of 500 personas from Census/Pew distributions
│   ├── tweet_classifier.py         # pre-survey LLM call: opinion vs. general vs. skip + thread detection
│   ├── political_characterizer.py  # 8 parallel LLM calls characterizing each political subgroup's likely view
│   ├── simulation_runner.py        # batched LLM survey execution (25 personas/batch, 5 concurrent)
│   ├── aggregator.py               # raw responses → overall + 8 demographic breakdowns
│   ├── research_store.py           # Firestore integration for research-mode sessions and usage logging
│   ├── requirements.txt            # Python deps
│   ├── Dockerfile                  # used by Cloud Run / Cloud Build
│   └── .env.example                # template for required environment variables
│
├── extension/                      # Chrome MV3 extension
│   ├── manifest.json               # MV3 manifest (sidePanel, storage, host permissions)
│   ├── background.js               # service worker: queue, API client, SSE consumer, state sync
│   ├── content_script.js           # Twitter/X DOM scraper + per-tweet "EchoBreaker" button injection
│   ├── reddit_content_script.js    # Reddit DOM scraper + per-post button injection
│   ├── content_script.css          # styles for the injected buttons
│   ├── sidepanel.html              # side-panel UI (idle / confirm / pre-survey / loading / results / debrief)
│   ├── sidepanel.js                # side-panel state machine + chart rendering
│   ├── sidepanel.css               # side-panel styles
│   ├── icons/                      # toolbar + side-panel icons
│   └── create_icons.py             # one-shot icon generator (Pillow)
│
├── milestonedocs/                  # required milestone deliverables (see below)
└── extension.zip                   # pre-packaged extension drop, identical to extension/
```

---

## Milestone Documents

All required milestone deliverables are included in [`milestonedocs/`](milestonedocs/):

| Milestone | File |
|---|---|
| Original Project Proposal | `milestonedocs/Original Project Proposal (Not EchoBreaker).pdf` |
| Revised Project Proposal (pivot to EchoBreaker) | `milestonedocs/Revised Project Proposal (EchoBreaker).pdf` |
| Progress Report | `milestonedocs/6156 Progress Report EchoBreaker.pdf` |
| Final Report | `milestonedocs/EchoBreaker_Final_Report.pdf` |
| Final Presentation (includes demo link) | `milestonedocs/EchoBreaker Presentation (includes link to demo).pdf` but will also add here: https://www.loom.com/share/d5e5b020c8cb4cda8385083a3f869482  |

The original project proposal was for a different idea; the project pivoted with the instructor's permission. The revised proposal documents the scope of the EchoBreaker project that was actually built.

---

## Build and Run

EchoBreaker has two components — a Python backend and a Chrome extension — that must both be running for the system to work end-to-end. The fastest path is local backend + locally-loaded extension. However, the backend was deployed to a cloud service, but author makes no guarantee it will still be up. 

### Prerequisites

- Python 3.12+
- Google Chrome (or any Chromium-based browser supporting MV3 + sidePanel)
- An Anthropic API key (the project currently targets Claude Sonnet 4.6; any modern Claude model works)
- (Optional, only for research-mode persistence) A Google Cloud project with Firestore enabled and `gcloud auth application-default login` set up

### 1. Backend — local development

```bash
cd backend/
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# then edit .env and set ANTHROPIC_API_KEY=<your key>

python main.py
# Server starts on http://localhost:8080
```

Health check:
```bash
curl http://localhost:8080/api/health
# → {"status":"ok","model":"claude-sonnet-4-6"}
```

Configurable environment variables (see `backend/.env.example` and `backend/config.py`):

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | *(required)* | Claude API key |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Swap in Opus or Haiku for accuracy/cost trade-offs |
| `TEMPERATURE` | `0.7` | Sampling temperature for persona simulation |
| `PERSONA_COUNT` | `500` | Default number of personas per survey |
| `BATCH_SIZE` | `25` | Personas per LLM call |
| `MAX_CONCURRENT_BATCHES` | `5` | How many batches run in parallel |
| `BATCH_MAX_TOKENS` | `1000` | Token cap per batch response |
| `ENABLE_CHARACTERIZER` | `true` | Whether to run the 8-group political pre-characterization step |
| `PORT` | `8080` | HTTP port |

### 2. Extension — local install

1. Open `chrome://extensions` and enable **Developer mode** (top-right toggle).
2. Click **Load unpacked** and select the `extension/` directory.
3. Make sure the backend is running at `http://localhost:8080`. For local development you must also temporarily change `API_BASE` in `extension/background.js` from the Cloud Run URL to `http://localhost:8080`, then click the "reload" icon on the EchoBreaker entry in `chrome://extensions`.
4. Visit `https://x.com` (or `https://www.reddit.com`) and hover over a post — an EchoBreaker button will appear next to the post's actions. Clicking it opens the Chrome side panel and starts the survey.

---

## Deploying to Production

The backend runs on **Google Cloud Run**. The reference deployment lives at:
```
https://echobreaker-git-263264146690.us-central1.run.app
```

### Deploy steps

```bash
# from the repo root
gcloud auth login
gcloud config set project <your-gcp-project>

# Build and push image
gcloud builds submit ./backend --tag gcr.io/<your-gcp-project>/echobreaker-api

# Deploy to Cloud Run, with the API key sourced from Secret Manager
gcloud run deploy echobreaker-api \
  --image gcr.io/<your-gcp-project>/echobreaker-api \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 1 \
  --set-secrets ANTHROPIC_API_KEY=anthropic-api-key:latest
```

Notes:
- `--min-instances 1` is recommended to avoid cold-start latency on the first survey of the day.
- Firestore (used by `research_store.py`) is auto-authenticated when running on Cloud Run via the default service account. Locally, run `gcloud auth application-default login`. If Firestore is not available, the survey endpoints still work — only research-mode session persistence will fail with a logged warning.
- After deploying, update `API_BASE` in `extension/background.js` to your Cloud Run URL, and add that URL to `host_permissions` in `extension/manifest.json`.

### Distribution

EchoBreaker is currently **privately distributed** as an unpacked extension (or via the bundled `extension.zip`). It has not been submitted to the Chrome Web Store. To install on another machine, share the `extension/` directory and follow the "Extension — local install" steps above.

---

## External Software & Libraries

EchoBreaker is built on the following third-party software (anything beyond the language standard library):

**Backend (Python):**
- [FastAPI](https://fastapi.tiangolo.com/) — HTTP framework
- [Uvicorn](https://www.uvicorn.org/) — ASGI server
- [Anthropic Python SDK](https://github.com/anthropics/anthropic-sdk-python) — Claude API client (the LLM that powers persona simulation, classification, and political characterization)
- [Pydantic](https://docs.pydantic.dev/) — request/response validation
- [NumPy](https://numpy.org/) — weighted random sampling for persona generation
- [google-cloud-firestore](https://cloud.google.com/python/docs/reference/firestore/latest) — research-mode session storage
- [python-dotenv](https://github.com/theskumar/python-dotenv) — local `.env` loading

**Extension (JavaScript):**
- Chrome Manifest V3 platform APIs only (`chrome.storage`, `chrome.sidePanel`, `chrome.runtime`, `chrome.tabs`). No bundler, no npm dependencies — the extension is plain JS/HTML/CSS.

**External services:**
- **Anthropic Claude API** (Sonnet 4.6 by default) — the core simulation engine.
- **Google Cloud Run** — backend hosting.
- **Google Cloud Firestore** — research-session persistence (optional).

**Reference data:**
- The persona distributions in `backend/persona_generator.py` are derived from the U.S. Census Bureau (2023) and Pew Research Center (2023) demographic and political-typology data. The numeric distributions are hard-coded in the file; no external data fetch is performed at runtime.

---

## Evaluation

The primary evaluation of EchoBreaker is a **user study** that measures how participants perceive, respond to, and update their beliefs based on the tool. A secondary evaluation compares EchoBreaker's synthetic survey output against real human polling data. Full methodology, results, and discussion are in **`milestonedocs/EchoBreaker_Final_Report.pdf`**. This section summarizes how to replicate each.

### 1. User study (primary)

The central question of this project is whether EchoBreaker actually changes how users see public opinion — not whether the underlying LLM-generated poll is numerically perfect. To measure this, participants were asked, for a fixed set of opinion tweets, to first *guess* the U.S. public-opinion distribution before seeing EchoBreaker's output, then run the EchoBreaker survey, then complete a debrief asking how surprising the result was, whether they trusted the model or their gut more, and whether their belief shifted. The extension's **research mode** captures this entire workflow end-to-end (pre-survey → survey result → post-survey debrief) and writes it to Firestore.

This evaluation is the centerpiece of the project. The participants' pre-survey guesses serve as a human baseline (the "alternative system" — your gut intuition vs. EchoBreaker), and the debrief responses measure the tool's actual effect on how people think about a tweet.

**How to replicate the user study:**

1. **Deploy or run the backend** (see [Build and Run](#build-and-run)). Firestore must be configured for research data to persist; otherwise, sessions are simulated but not stored.
2. **Install the extension** and open the side panel.
3. Click the gear icon (⚙) → **enable "Research Version"** and enter a participant name.
4. Visit Twitter/X and run EchoBreaker on the evaluation tweet set (the full list of tweets used in the study is in `milestonedocs/EchoBreaker_Final_Report.pdf`).
5. For each tweet the participant will:
   - See the tweet preview, then guess the percentage breakdown across response options (sliders that must sum to 100%) and write a free-text rationale (the **pre-survey**).
   - Watch the survey run.
   - Fill in a 4-question **debrief** (1–10 surprise scale, trust comparison, belief change, free-text comments).
6. Each completed session is written to the `research_sessions` collection in Firestore with the schema defined in `backend/research_store.py`: pre-survey estimates, full survey results, and post-survey responses, all keyed by participant.
7. Export the data from Firestore (e.g. via `gcloud firestore export` or the Firebase console) to analyze in your tool of choice.

### 2. Synthetic survey accuracy (secondary)

As a sanity check on whether EchoBreaker's synthetic survey is at least directionally reliable, we compared its output against real human polling data from the **NPR/PBS News/Marist Poll, October 2025** ([https://maristpoll.marist.edu/polls/the-1st-amendment-in-the-u-s-october-2025/](https://maristpoll.marist.edu/polls/the-1st-amendment-in-the-u-s-october-2025/); n=1,477; conducted Sept 22–26, 2025). Two statements from the Marist poll were posted as tweets and surveyed through EchoBreaker, each run with both 500 and 1,000 personas. Full results are in the final report.

The two tweet statements were:

1. "It is more important to control gun violence than it is to protect gun rights"
2. "We should deploy the National Guard into local communities to help reduce crime."

**How to replicate:**

1. Deploy or run the backend (see [Build and Run](#build-and-run)).
2. Install the extension and open Twitter/X.
3. Find or post tweets containing the exact statements above, then click the EchoBreaker button on each.
4. To run with 1,000 personas instead of the default 500, raise the cap in `backend/main.py` and update the `persona_count` field sent in `extension/background.js`.
5. Compare the resulting Likert distribution to the Marist topline at the link above.



---

## AI Tool Usage Disclosure

AI generation was used substantially throughout the project. This section documents which tools were used for what.

### Tools used

- **Claude Code (Anthropic)** — Used as the primary coding assistant during development. 
- **ChatGPT / GPT-4** — Used occasionally for brainstorming alternate UI copy, and quick syntax lookups. 

### How AI was used vs. not used

- **Code:** Most application code was AI-assisted (Claude Code), then manually reviewed, tested, and edited. I also worked with AI to make  architectural decisions.
- **Evaluation data:** Participant pre-/post-survey responses are real human responses, not synthetic. The survey results that EchoBreaker produces *are* synthetic (that is the point of the system) — those are LLM-generated by design, and that fact is disclosed in the side-panel results UI.
- **Writing:** Milestone documents (proposal, progress report, final report) were drafted by the human author with AI assistance for editing and formatting only. There was maybe 1 or 2 figure captions in the final report that I had AI write for me. Every other piece of content written on the final report was done solely by me, a human.
- **This README:** This README was mostly written by AI. I, the human, reviewed it afterwards.

---

## Documentation for Future Maintainers

This section is intended for a third party picking up the project.

### Hand-off checklist

1. **Read the final report first** — `milestonedocs/EchoBreaker_Final_Report.pdf` — it contains the motivation, design decisions, evaluation results, and known limitations.
2. **Get an Anthropic API key** with access to Claude Sonnet 4.6 (or any Claude model you want to swap in via `ANTHROPIC_MODEL`).
3. **Get a Google Cloud project** if you want research-mode persistence and a hosted backend; otherwise local-only development is fully supported.
4. **Follow the [Build and Run](#build-and-run) instructions** to bring the system up locally.

### Architecture in one paragraph

A user clicks the EchoBreaker button on a tweet → the content script (`content_script.js`) scrapes the tweet's text, author, parent/quote tweet, and media flags from the DOM and sends them to the background service worker (`background.js`) → the worker calls `POST /api/classify` (cheap LLM call) to detect tweet type and thread status, optionally shows a confirmation prompt, then queues a survey → for each queued survey it calls `POST /api/survey` and opens an SSE stream on `GET /api/survey/{id}/stream` → on the backend, `main.py` classifies the tweet, generates 500 personas via `persona_generator.py`, pre-characterizes the 8 political subgroups in parallel via `political_characterizer.py`, then runs the batched simulation via `simulation_runner.py` (25 personas/batch, 5 concurrent), streaming `progress` events as batches complete and a final `complete` event with the aggregated result from `aggregator.py` → the side panel renders progressive progress and a final stacked-bar Likert chart with switchable demographic breakdowns.

### Where to look for common tasks

| Task | File(s) |
|---|---|
| Change the default LLM model | `backend/.env` (`ANTHROPIC_MODEL`) |
| Change persona count, batch size, or concurrency | `backend/.env` and/or `backend/config.py` |
| Edit demographic distributions | `backend/persona_generator.py` (`DISTRIBUTIONS`) |
| Edit political subgroups | `backend/persona_generator.py` (`DISTRIBUTIONS["politics"]`) **and** `backend/political_characterizer.py` (`POLITICAL_GROUPS`) — these must stay in sync |
| Edit the prompt for persona simulation | `backend/simulation_runner.py` (`SYSTEM_PROMPT`, `_build_batch_prompt`) |
| Edit the prompt for tweet classification | `backend/tweet_classifier.py` |
| Add a new social-media site | Add a new content script next to `content_script.js` / `reddit_content_script.js`, register it in `extension/manifest.json`, and add the host to `host_permissions` |
| Change the deployed API URL | `extension/background.js` (`API_BASE`) **and** `extension/manifest.json` (`host_permissions`) |
| Change UI / styling | `extension/sidepanel.html`, `extension/sidepanel.css`, `extension/sidepanel.js` |
| Change the research-mode survey schema | `backend/research_store.py`, `extension/sidepanel.html` (research-mode views), `extension/sidepanel.js`, and `extension/background.js` (`SUBMIT_DEBRIEF` handler) |

### Known limitations / future work

These are documented in detail in the final report:
- The single-instance in-memory survey queue (`_surveys` dict in `main.py`) does not survive a Cloud Run instance restart; for multi-instance scaling this should move to Redis.
- No real-time grounding from current polls 
- No confidence intervals on the aggregated distribution — only point estimates.
- No image or video understanding — multimodal context is currently flagged via warning rather than analyzed.
- No support for non-U.S. demographics — distributions are U.S.-specific.

### Contact

This project was built by Daniel Lee (`danielkyulee@gmail.com`) for CS 6156 at Cornell Tech. For questions about the implementation, read the final report first, then contact the author.
