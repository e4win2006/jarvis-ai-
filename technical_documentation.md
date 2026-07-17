# J.A.R.V.I.S. Command Suite - Technical Documentation Report

This document provides a comprehensive technical overview and deep-dive analysis of the J.A.R.V.I.S. (Just A Rather Very Intelligent System) AI IoT Command Suite, a sci-fi HUD dashboard designed for home automation, meteorological tracking, and voice-assisted AI control.

---

## 1. Project Overview

### What the Project Does
The **J.A.R.V.I.S. Command Suite** is a desktop command console. It allows users to:
* **Interact via Speech**: Communicate with an AI using Speech-to-Text (STT) and receive spoken responses via Text-to-Speech (TTS).
* **Control simulated IoT Devices**: Manage a smart home grid (lights, climate controls, locks, vacuum, media player) using both voice commands and dashboard widgets.
* **Monitor Weather Satellite**: Embed and view real-time meteorological tracking via Zoom Earth and retrieve live local weather metrics.
* **Select Cognitive Brains**: Configure the AI engine to operate in Offline mode, connect to a local **Ollama** server, connect to a local **LM Studio** server, or connect to the **Google Gemini API** in the cloud.
* **Run Verified Actions (Tool Manager)**: Execute alarms, web searches, file scans, and desktop actions through verified Python backend scripts that return structured success/failure JSON.

### Overall Architecture
The application runs as a hybrid desktop console: a **Vite + React frontend** wrapped inside an **Electron shell**, communicating with an **Express.js backend server** via REST and WebSockets.

```
                    JARVIS Command Suite
                       │
         ┌─────────────┴─────────────┐
         │                           │
         ▼                           ▼
    Client Shell               Backend Server
 (React + Electron)             (Express.js)
         │                           │
         │                     ┌─────┴─────┐
         │                     │           │
         │                     ▼           ▼
         │                 AI Brain   Tool Manager
         │                 (Ollama/   (Python 3)
         │                 Gemini)         │
         │                     │           │
         │                     └─────┬─────┘
         │                           ▼
         │                     Storage Layer
         │                   (SQLite + Vector)
         │                           │
         └─────────────◄─────────────┘
                (WS Sync & Alerts)
```

1. **Client UI (React + Electron):** Renders the sci-fi dashboard, handles speech recognition (Web Speech API), captures audio levels for orb visualization, and connects to the backend API.
2. **AI Brain (Orchestrator):** Manages conversational history context, queries memory storage, triggers MCP endpoints, and serializes OpenAI/Gemini function calling streams.
3. **Tool Manager (Python):** Decoupled Python 3 execution layer. Runs system automation, database writes, and web searches, outputting structured JSON to guarantee that the AI never invents a successful outcome without verification.
4. **Storage Layer (SQLite):** Main database (`jarvis.db`) configured via `better-sqlite3`. Houses tables for chat history, settings, vector embeddings, and active scheduler items.

---

## 2. Programming Languages Used

| Language | Location | Purpose |
| :--- | :--- | :--- |
| **TypeScript / TSX** | `src/**/*.ts`, `src/**/*.tsx`, `server/src/**/*.ts` | Core frontend dashboard, Electron main loop coordination, Express backend server API routes, and database models. |
| **Python 3** | `server/src/tools/python_tools/*.py` | Asynchronous system automation scripts, file scanners, web query selectors, and database write operations. |
| **HTML5** | `index.html` | Entry point structure, viewport settings, and loading external sci-fi Google Fonts. |
| **CSS3 (Vanilla)** | `src/index.css` | Futuristic theme styling: glassmorphic cards, custom neon glows, CRT scanlines, radars, and keyframe animations. |

---

## 3. Frameworks and Libraries

### Frontend & Electron
* **React (v19.2.7)**: Component framework, managing UI rendering, hooks lifecycle (`useState`, `useEffect`, `useCallback`, `useRef`), and reactive DOM updates.
* **Electron**: Wraps the web application into a desktop application interface with native access to system binaries.
* **Vite (v8.1.1)**: Build system and local development server, providing fast Hot Module Replacement (HMR) and production bundling.
* **Lucide-React**: Dynamic vector icon pack providing futuristic symbols.

### Backend Server
* **Express.js (v4.19.2)**: Hosts REST endpoints (`/api/chat`, `/api/config`, `/api/screenshot`, etc.) and handles request parsing.
* **ws (v8.18.0)**: WebSocket Server for broadcasting scheduling alerts and IoT triggers from backend to the client UI.
* **better-sqlite3 (v11.1.2)**: Fast synchronous SQLite driver for node.
* **whatsapp-web.js (v1.34.7)**: Automates WhatsApp messaging through a headless browser instance.

---

## 4. AI and LLM Integration

### LLM Providers
The application provides four configurable LLM cognitive paths:
1. **Offline Mode**: A local rule-based system providing pre-baked responses to conserve network/processing overhead.
2. **Local Ollama Server**: Fetches from `http://localhost:11434/api/generate`.
3. **Local LM Studio Server**: Fetches from `http://localhost:1234/v1/chat/completions` (OpenAI-compatible).
4. **Google Gemini API**: Fetches from the Generative Language API endpoint (`v1beta` models).

### Prompting & Memory Injection
Before a prompt is dispatched to the active LLM, the Orchestrator performs proactive context fetching:
1. **Long-Term Vector Memory Check:** Queries the local vector database using cosine similarity for notes Edwin has asked JARVIS to remember, returning the top 3 relevant records.
2. **Active Schedules Check:** Selects all active scheduler items (reminders, alarms, timers) from the SQLite database.
3. **Prompt Injection:** Appends these context memories and active schedules directly to the System Prompt, ensuring the LLM has complete historical and temporal awareness (e.g. answering *"Do I have schedules?"* accurately without needing to invoke a tool).

---

## 5. Tool Calling and Verification Layer

Rather than relying on the LLM to assume a tool succeeded, JARVIS uses a strict **Verification Layer**:

```
[User Command] ──► [LLM Brain] ──► [Tool Request] ──► [Python Execution]
                                                             │
[TTS Confirmation] ◄── [LLM Response] ◄── [JSON Output] ◄────┘
```

1. The Brain outputs a tool call (e.g. `desktop_control(action="open_pdfs", folder="desktop")`).
2. The server spawns the corresponding Python process via [pythonRunner.ts](file:///c:/Users/EDWIN%20TOM%20JOSEPH/Desktop/jarvis/server/src/utils/pythonRunner.ts).
3. The Python script executes the command, checks the operating system process tables (using `tasklist` check), and prints a structured JSON result:
   ```json
   {
     "success": true,
     "opened": 3,
     "files": ["AI.pdf", "Math.pdf", "Resume.pdf"]
   }
   ```
4. The backend returns this JSON string to the LLM.
5. The LLM processes the JSON and states: *"Successfully opened three PDF files, sir."* If the JSON reports `{"success": false, "reason": "No files found"}`, the LLM reports the failure: *"I couldn't find any PDF files on your desktop."*

---

## 6. Detailed Schema of Python Tools

### A. Scheduler (`schedule.py`)
Directly manages `scheduler_items` in `jarvis.db`:
- **Add:** `--action add --type <alarm|reminder|timer> --target_time <ISO> --label <text>`
- **List:** `--action list`
- **Dismiss:** `--action dismiss --id <id>`

### B. Search Engine (`search.py`)
Automates query routing to specialized scrapers and APIs:
- **Wikipedia:** Queries OpenSearch API to fetch summaries.
- **Weather:** Resolves coordinates using Open-Meteo Geocoding, then fetches current weather metrics.
- **GitHub:** Queries GitHub API for repository stars, owner, and URL.
- **YouTube:** Scrapes YouTube search result chunks for video titles and IDs.
- **News / Google:** Scrapes DuckDuckGo HTML Lite engine with browser headers.

### C. Desktop Control (`desktop.py`)
Integrates verified Windows OS automation:
- **PDF Scans:** Scans target folders, executes `os.startfile` on PDF extension files, and checks running tasks.
- **App Launcher:** Launches binaries (Notepad, Calc, Paint, etc.) and validates running state via `tasklist` queries.

---

## 7. Database Model Schema

The SQLite database houses the following primary tables:

### `scheduler_items`
Stores alarms, reminders, and timers.
* `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
* `type` (TEXT) - `'alarm' | 'reminder' | 'timer'`
* `target_time` (TEXT) - ISO datetime string
* `label` (TEXT) - Task description
* `active` (INTEGER) - `1` if active, `0` if dismissed

### `chat_history`
Stores the short-term rolling conversation history per session.
* `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
* `timestamp` (DATETIME DEFAULT CURRENT_TIMESTAMP)
* `role` (TEXT) - `'user' | 'assistant' | 'system'`
* `content` (TEXT)
* `session_id` (TEXT DEFAULT 'default')

### `vector_memory`
Stores semantic note embeddings for long-term memory.
* `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
* `text` (TEXT) - Persistent note content
* `metadata` (TEXT) - JSON tags
* `embedding` (TEXT) - Vector values
