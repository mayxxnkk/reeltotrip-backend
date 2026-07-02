## Reel‑to‑Trip Backend

A TypeScript/Node.js backend that turns an Instagram reel into a structured, multi‑agent travel planning pipeline:

1. **Reel Interpretation** – Understands the reel and infers destination, vibe and key activities.
2. **Destination Research** – Enriches the destination with nearby attractions and recommended trip length.
3. **Trip Planning** – Builds a day‑wise itinerary.
4. **Budget Reasoning** – Scrapes the web to estimate budget ranges for hotels and activities.
5. **Orchestrator + Conversation** – Orchestrates all agents and produces a human‑friendly summary, with follow‑up refinement based on user messages.

The backend is **local‑only**, uses **Gemini** for reasoning, and **public web sources** for research and pricing.

---

## Tech Stack & Architecture

### Core stack

- **Language**: TypeScript  
- **Runtime**: Node.js (20+ recommended)  
- **Framework**: Express  
- **Entry**: `src/server.ts` → `src/app.ts`

### High‑level architecture

- **`src/server.ts`**
  - Boots the Express app on port **3000**.
  - Loads environment variables via `dotenv`.

- **`src/app.ts`**
  - Creates the Express app.
  - Registers all REST routes:
    - `GET /health`
    - `POST /interpret`
    - `POST /research`
    - `POST /trip`
    - `POST /budget`
    - `POST /pipeline`
    - `POST /conversation`

- **Agents (`src/agents/*`)**
  - `reelInterpretation/agent.ts`
    - Given a **reel URL**, fetches its caption (via `yt-dlp`) and calls **Gemini** to infer:
      - `destination`, `country`
      - `vibe` (string[])
      - `key_activities` (string[])
      - `confidence`
  - `destinationResearch/agent.ts`
    - Given `destination`, `country`, `vibe`, `key_activities`:
      - Geocodes the place via **Nominatim** (OpenStreetMap).
      - Fetches nearby attractions via **Overpass API**.
      - Calls **Gemini** to select the most relevant 5–7 attractions and a recommended trip duration.
  - `tripPlanning/agent.ts`
    - Given `destination`, `local_attractions`, `recommended_duration_days`:
      - Calls **Gemini** to generate a structured day‑wise itinerary:
        - Day number
        - Theme
        - 2–3 activities per day, chosen from the provided attractions only.
  - `budgetReasoning/agent.ts`
    - Given:
      - `destination`
      - `duration_days`
      - `itinerary` (with activities per day)
      - Optional `preferredCurrency` (default: `USD`)
    - Uses **Puppeteer** to drive a headless browser:
      - Scrapes hotel prices from **Booking.com** (for a 4‑night stay 7 days from “today”).
      - Scrapes activity prices from **GetYourGuide** for each itinerary activity.
    - Extracts currency amounts using a universal regex table and summarizes by currency:
      - `min`, `median`, `max`, `samples`
    - Returns:
      - `hotel_research`
      - `activity_research`
      - `confidence` based on number of samples
      - total sample count and execution time.

- **Orchestrator (`src/orchestrator/orchestrator.ts`)**
  - Exposes `runPipeline(reelUrl, currency, conversationContext?)`.
  - Sequentially invokes:
    1. `reelInterpretationAgent`
    2. `destinationResearchAgent`
    3. `tripPlanningAgent`
    4. `budgetReasoningAgent`
  - Then uses **Gemini** one more time to generate a **human‑readable summary** that:
    - Describes the destination and vibe.
    - Summarizes the itinerary day by day.
    - Explains approximate budget ranges using the budget research.
    - Takes into account the prior **conversation context** if provided.

- **Conversation state (`src/memory/conversationState.ts`)**
  - In‑memory store (no DB) keyed by `conversationId`.
  - Stores for each conversation:
    - `id`
    - `reelUrl`
    - `currency`
    - `history` of turns:
      - `{ role: "user" | "agent", content: string, timestamp: number }`
  - Utilities:
    - `createConversation(...)`
    - `getConversation(id)`
    - `appendTurn(id, role, content)`
    - `updateConversationCurrency(id, currency)`
    - `buildHistoryText(state)` → human‑readable conversation log.

- **Utils**
  - `utils/fetchReelCaption.ts`: uses `yt-dlp` to fetch Instagram reel captions using local browser cookies.
  - `utils/extractJson.ts`: robust JSON extraction from Gemini responses (handles extra text around JSON).

---

## Workflow: End‑to‑End Flow

### Initial request (new reel)

1. **Client → `POST /pipeline`** with:
   - `reelUrl`
   - optional `currency` (default `"USD"`).

2. **Backend pipeline**:
   - Reel Interpretation Agent → structured insight from the reel.
   - Destination Research Agent → nearby attractions + recommended duration.
   - Trip Planning Agent → day‑wise itinerary.
   - Budget Reasoning Agent → price samples & budget summary.
   - Orchestrator calls Gemini again with all of the above to produce a **summary string**.

3. **Conversation creation**:
   - A new conversation is created and stored in memory:
     - Synthetic user turn: `"New reel: <reelUrl>"`
     - Agent turn: the `summary`.

4. **Response**:
   - Returns only:
     - `conversationId`
     - `summary`
     - `history` (text form of the conversation turns).
   - The frontend displays **`summary`** and stores `conversationId`.

### Follow‑up refinement messages

1. **Client → `POST /conversation`** with:
   - `conversationId` (from the first call).
   - `message` (e.g., `"make the trip cheaper"`, `"add 2 days"`, `"focus more on photography"`).
   - optional `currency` (to override/keep USD, INR, etc.).

2. **Backend**:
   - Retrieves the conversation state.
   - Appends the new **user message** to history.
   - Builds `conversationContext` from full history (user/agent turns).
   - Re‑runs `runPipeline(reelUrl, currency, conversationContext)`:
     - The agents recompute based on the same reel, and Gemini’s final **summary** step is guided by the conversation context, so it adapts the itinerary/budget to the latest request.
   - Appends the new **agent summary** turn to history.

3. **Response**:
   - Returns only:
     - `conversationId`
     - updated `summary`
     - updated `history`.

From the client’s point of view, **every call returns a single `summary` string to show to the user**, while the backend handles all reasoning, research, itinerary building, and budgeting behind the scenes.

---

## Third‑Party APIs & Tools

### Gemini (Google AI)

- **Library**: `@google/genai`  
- **Usage**:
  - All reasoning agents and the final orchestrator summary use Gemini model:
    - `MODEL_NAME = "gemini-2.5-flash"`
  - The code calls:
    - `ai.models.generateContent({ model, contents })`
- **Configuration**:
  - API key via `.env`:
    - `GEMINI_API_KEY=...`
  - Loaded in `src/config/index.ts` and injected into agents.

### yt‑dlp (local CLI)

- Used in `fetchReelCaptionSafe` to extract the caption of an Instagram reel.
- Runs locally and leverages **your logged‑in browser cookies** (Chrome by default):
  - `yt-dlp -j --skip-download --cookies-from-browser chrome <reelUrl>`
- **No API key**; relies on your local environment.

### Nominatim (OpenStreetMap)

- Endpoint: `https://nominatim.openstreetmap.org/search`  
- Used to geocode city/destination into lat/lon.  
- Multiple fallback queries for robustness:
  - `"city, country"`, `"destination, country"`, `destination`, `city`, `country`.
- No key required, but rate‑limited (the agent respects this with timed requests).

### Overpass API

- Endpoint: `https://overpass-api.de/api/interpreter`  
- Used to query OpenStreetMap for nearby attractions:
  - Tourism, natural, leisure nodes and ways within a radius (e.g. 5000m).
- Returns raw elements with tags; agent extracts unique `name`s.

### Booking.com (scraping via Puppeteer)

- Used in budget agent to:
  - Query hotel listings for a given city and fixed dates (check‑in 7 days from now, 4‑night stay, 2 adults).
  - Extract per‑night prices in the requested currency (e.g. USD, INR).
- No official API; HTML scraped via selectors and parsed with `extractPrices()`.

### GetYourGuide (scraping via Puppeteer)

- Used in budget agent to:
  - Search for each itinerary activity as a query.
  - Extract activity prices from search results.
- No official API; HTML scraped and parsed with the same currency extractor.

---

## Installation & Setup

### Prerequisites

- **Node.js** 20+ (required for native `fetch` and `@google/genai`)  
- **npm** (comes with Node)  
- **yt‑dlp** installed and available on PATH  
  - Example: `pip install yt-dlp` or use your OS package manager.  
- **Chrome/Chromium** installed (for Puppeteer)  
- A **Gemini API key** from Google AI Studio.

### Steps

1. **Clone / open the project**

   ```bash
   cd ~/Desktop/reelToTrip/reel-to-trip-backend
   ```

2. **Create `.env`**

   ```bash
   GEMINI_API_KEY=YOUR_API_KEY_HERE
   ```

3. **Fix npm cache permissions (if needed)**

   If you see npm `EACCES` errors:

   ```bash
   sudo chown -R $(whoami) ~/.npm
   ```

4. **Install dependencies**

   ```bash
   npm install
   ```

5. **Run the dev server**

   ```bash
   npm run dev
   ```

6. **Verify health**

   ```bash
   curl http://localhost:3000/health
   # -> {"status":"ok"}
   ```

---

## API Reference & Example Calls

All endpoints are under `http://localhost:3000`.

### 1. Health

- **Endpoint**: `GET /health`  
- **Description**: Simple health check.

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

---

### 2. Reel Interpretation only

- **Endpoint**: `POST /interpret`  
- **Body**:

```json
{
  "reelUrl": "https://www.instagram.com/p/C1fW454ybQS/"
}
```

- **Response**: JSON with `destination`, `country`, `vibe`, `key_activities`, `confidence`.

**Example:**

```bash
curl -X POST http://localhost:3000/interpret \
  -H "Content-Type: application/json" \
  -d '{"reelUrl":"https://www.instagram.com/p/C1fW454ybQS/"}'
```

---

### 3. Destination Research only

- **Endpoint**: `POST /research`  
- **Body**:

```json
{
  "destination": "Twin Lagoons, Coron",
  "country": "Philippines",
  "vibe": ["scenic", "adventure"],
  "key_activities": ["photography", "lagoon exploration"]
}
```

- **Response**: `destination`, `local_attractions`, `recommended_duration_days`, `confidence`.

**Example:**

```bash
curl -X POST http://localhost:3000/research \
  -H "Content-Type: application/json" \
  -d '{
    "destination": "Twin Lagoons, Coron",
    "country": "Philippines",
    "vibe": ["scenic", "adventure"],
    "key_activities": ["photography", "lagoon exploration"]
  }'
```

---

### 4. Trip Planning only

- **Endpoint**: `POST /trip`  
- **Body**:

```json
{
  "destination": "Twin Lagoons, Coron",
  "local_attractions": [
    "Kayangan Lake",
    "Siete Pecados",
    "Maquinit Hot Springs",
    "Mount Tapyas"
  ],
  "recommended_duration_days": 4
}
```

- **Response**: `destination`, `duration_days`, `itinerary`, `confidence`.

**Example:**

```bash
curl -X POST http://localhost:3000/trip \
  -H "Content-Type: application/json" \
  -d '{
    "destination": "Twin Lagoons, Coron",
    "local_attractions": [
      "Kayangan Lake",
      "Siete Pecados",
      "Maquinit Hot Springs",
      "Mount Tapyas"
    ],
    "recommended_duration_days": 4
  }'
```

---

### 5. Budget Reasoning only

- **Endpoint**: `POST /budget`  
- **Body**:

```json
{
  "destination": "Twin Lagoons, Coron",
  "duration_days": 4,
  "itinerary": [
    { "day": 1, "activities": ["Mount Tapyas Coron", "Maquinit Hot Springs Coron"] },
    { "day": 2, "activities": ["Kayangan Lake Coron", "Siete Pecados Marine Park"] },
    { "day": 3, "activities": ["Green Lagoon Coron", "Cueva del Amor Coron"] },
    { "day": 4, "activities": [] }
  ],
  "currency": "INR"
}
```

- **Response**: `destination`, `preferred_currency`, `hotel_research`, `activity_research`, `confidence`, `total_price_samples`, `execution_time_seconds`.

**Example:**

```bash
curl -X POST http://localhost:3000/budget \
  -H "Content-Type: application/json" \
  -d '{
    "destination": "Twin Lagoons, Coron",
    "duration_days": 4,
    "itinerary": [
      { "day": 1, "activities": ["Mount Tapyas Coron", "Maquinit Hot Springs Coron"] },
      { "day": 2, "activities": ["Kayangan Lake Coron", "Siete Pecados Marine Park"] },
      { "day": 3, "activities": ["Green Lagoon Coron", "Cueva del Amor Coron"] },
      { "day": 4, "activities": []
    ],
    "currency": "INR"
  }'
```

---

### 6. Full Pipeline (new reel → summary)

- **Endpoint**: `POST /pipeline`  
- **Body**:

```json
{
  "reelUrl": "https://www.instagram.com/p/C1fW454ybQS/",
  "currency": "USD"
}
```

- **Response**:

```json
{
  "conversationId": "abc123",
  "summary": "Human-readable trip explanation...",
  "history": "User: New reel: ...\nAgent: ..."
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/pipeline \
  -H "Content-Type: application/json" \
  -d '{"reelUrl":"https://www.instagram.com/p/C1fW454ybQS/","currency":"USD"}'
```

You should **display `summary`** to the user and **store `conversationId`**.

---

### 7. Conversation Refinement (follow‑ups on same reel)

- **Endpoint**: `POST /conversation`  
- **Body**:

```json
{
  "conversationId": "abc123",
  "message": "Make the trip cheaper and add one more day",
  "currency": "USD"
}
```

- **Response**:

```json
{
  "conversationId": "abc123",
  "summary": "Updated human-readable explanation matching the new request...",
  "history": "User: New reel: ...\nAgent: ...\nUser: Make the trip cheaper...\nAgent: Updated explanation..."
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/conversation \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "abc123",
    "message": "Make the trip cheaper and add one more day",
    "currency": "USD"
  }'
```

The frontend always just needs to show the **latest `summary`** and keep sending `conversationId` + `message` for further refinements.
