# J.A.R.V.I.S. Command Suite - User Manual

Welcome to the **J.A.R.V.I.S. (Just A Rather Very Intelligent System)** Command Suite. This manual provides detailed instructions on how to install, configure, and operate your personal AI command center.

---

## 1. System Architecture Overview

JARVIS is structured into three unified architectural layers to maximize execution reliability and prevent hallucinations:

```
                    JARVIS Command Suite
                       │
         ┌─────────────┴─────────────┐
         │                           │
         ▼                           ▼
     AI Brain                  Tool Manager
(Gemini/Ollama/LM Studio)        (Python 3)
         │                           │
         └─────────────┬─────────────┘
                       ▼
                 Storage Layer
              (SQLite + Vector Memory)
```

1. **AI Brain:** Handles natural language understanding, context tracking, reasoning, and dynamically decides which tools to invoke.
2. **Tool Manager (Python):** A verified execution layer running Python 3 scripts that communicate directly with the local system, returning structured JSON results to the Brain.
3. **Storage Layer:** A SQLite database (`jarvis.db`) storing short-term chat histories and active alarms/reminders, paired with a Vector Memory table for semantic note recall.

---

## 2. Prerequisites

Ensure you have the following installed on your machine:
* **Node.js** (v18+ or v20+ recommended)
* **Python** (v3.8+ or newer). Make sure Python is added to your system `PATH`.
* **Git** (for version control and pushing changes).
* Either a local LLM runner (**LM Studio** or **Ollama**), or a **Google Gemini API Key** for cloud processing.

---

## 3. Installation & Setup

1. **Navigate to the Project Folder:**
   ```bash
   cd jarvis
   ```

2. **Install Frontend and Electron Shell Dependencies:**
   Run the npm installation script in the root directory:
   ```bash
   npm install
   ```

3. **Install Backend Server Dependencies:**
   Navigate to the server directory and run installation:
   ```bash
   cd server
   ```
   ```bash
   npm install
   ```

4. **Return to the Root Directory:**
   ```bash
   cd ..
   ```

---

## 4. Launching JARVIS

JARVIS can be run in two modes:

### Development Mode (Web Dashboard)
To run the React frontend with hot reloading and launch the Express backend server concurrently:
```bash
npm run dev
```
Open your browser and navigate to `http://localhost:5173/` to view the holographic HUD dashboard.

### Desktop App Mode (Electron Shell)
To compile and launch the command center inside a standalone, borderless desktop window:
```bash
npm run electron:dev
```

---

## 5. Configuration (Settings Console)

1. Boot the command center and click the **Gear (Settings)** icon in the top right corner.
2. Select your preferred **AI Backend**:
   - **Gemini:** Enter your Google Gemini API key. Uses `gemini-2.5-flash` to query the cloud.
   - **LM Studio:** Ensure LM Studio is running locally on port `1234` with a model loaded (e.g. `qwen/qwen3-8b`).
   - **Ollama:** Ensure Ollama is active on port `11434` with `llama3` or similar model pulled.
   - **Offline:** Disables AI completions, running local patterns and direct controls.
3. Configure other features like **WhatsApp Uplink Integration** or custom SMTP email configurations if desired.

---

## 6. Voice and Text Command Interface

You can interact with JARVIS via two inputs:
* **Holographic Core (Voice):** Tap the pulsing core orb in the center. Speak your directive, and tap again to submit. JARVIS will process it using Web Speech Recognition (STT) and talk back to you via operating system Speech Synthesis (TTS).
* **Terminal Console (Keyboard):** Type your commands directly into the prompt bar at the bottom of the log terminal.

---

## 7. Command Guide & Verification Flows

JARVIS operates on a strict **Verification Layer**: a tool will execute and return JSON output, which the LLM reads before declaring success. If an operation fails, the LLM will notify you of the exact reason rather than inventing a successful outcome.

### A. Alarms, Reminders, and Timers
* **Commands:** 
  - *"Wake me up tomorrow at 7:00 AM."*
  - *"Set an alarm for 6 PM labeled Church."*
  - *"List my active schedules."*
  - *"Dismiss schedule ID 2."*
* **How it works:** Direct SQL insertions in the local database are verified. Asking *"Do I have schedules?"* reads the active database records directly and displays them.

### B. Intelligent Web Search
* **Commands:**
  - *"Who is Chris Evans?"*
  - *"What is the weather in London right now?"*
  - *"Check the latest news on technology."*
  - *"Find the repository for react-native on GitHub."*
* **How it works:** JARVIS dynamically routes the search to the appropriate provider (Wikipedia for biographies, Open-Meteo for real-time weather, GitHub API for repositories, or DuckDuckGo for general web/news results) and summarizes the findings.

### C. Desktop Control and Automation
* **Commands:**
  - *"Open all PDFs on my desktop."*
  - *"Launch notepad."*
  - *"Turn up the volume."*
  - *"Skip to the next track."*
* **How it works:** 
  - For PDF requests, JARVIS scans your desktop folder, triggers system file handlers to open them, checks running tasks, and reports the exact file list (e.g., *"Successfully opened three PDF files, sir."*).
  - For launch requests, it verifies the application process is running using system task analysis.

### D. Memory and Context
* **Commands:**
  - *"Remember that my server port is 8080."*
  - *"Recall what you know about my server."*
* **How it works:** Stores semantic records in a local Vector Memory. Related notes are retrieved and injected into the AI context for every subsequent request.
