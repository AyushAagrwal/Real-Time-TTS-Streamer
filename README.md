# Real-Time Streaming TTS Player

A browser-based low-latency Text-to-Speech streaming client using Web Audio API and real-time streaming pipelines. Built with Python (FastAPI + gTTS) for the backend and vanilla JavaScript for the frontend.

![TTS Player Demo](docs/screenshot.png)

## Features

- **Real-time TTS Streaming**: Synthesize text to speech and stream audio chunks to the browser
- **Multiple Voice Support**: Choose from different English accents (US, UK, Australia, India)
- **Speed Control**: Adjust speech rate with a slider
- **Latency Profiling**: Real-time metrics dashboard showing:
  - First Byte Latency
  - Chunks Received
  - Total Data Size
  - Audio Buffer Level
- **Modern UI**: Dark glassmorphism theme with smooth animations

## Quick Start

### Prerequisites
- Python 3.10+
- pip

### Installation

```bash
# Clone or navigate to the project directory
cd "TTS Player"

# Install Python dependencies
python -m pip install -r requirements.txt
```

### Running the Server

```bash
python server.py
```

The server will start at **http://localhost:8080**

### Usage

1. Open http://localhost:8080 in your browser
2. Enter or modify the text in the textarea
3. Select a voice from the dropdown
4. Adjust speed if desired
5. Click **▶ Play** to hear the synthesized speech
6. Watch the latency metrics update in real-time

## Project Structure

```
TTS Player/
├── server.py              # FastAPI server with WebSocket streaming
├── tts_engine.py          # TTS synthesis engine (gTTS wrapper)
├── requirements.txt       # Python dependencies
├── static/
│   ├── index.html         # Main UI
│   ├── css/
│   │   └── style.css      # Dark glassmorphism theme
│   └── js/
│       └── app.js         # Web Audio API + streaming logic
└── docs/
    └── ARCHITECTURE.md    # Technical deep-dive
```

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Backend | FastAPI + Uvicorn | Async web server with WebSocket support |
| TTS Engine | gTTS (Google TTS) | Text-to-speech synthesis |
| Audio Format | MP3 | Browser-native playback |
| Frontend | Vanilla JS | Lightweight, no framework dependencies |
| Streaming | WebSocket | Real-time binary audio chunk streaming |
| UI | CSS + Glassmorphism | Modern, responsive design |

## API Reference

### REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Serves the main HTML page |
| `/api/voices` | GET | Returns available TTS voices |

### WebSocket Endpoint

**`/ws/tts`** - Real-time TTS streaming

**Client → Server (JSON):**
```json
{
  "text": "Hello world",
  "voice": "en",
  "rate": "+0%"
}
```

**Server → Client:**
1. `{"type": "start", "timestamp": 1234567890}` - Synthesis started
2. Binary MP3 audio chunks (8KB each)
3. `{"type": "end", "chunks": 8, "bytes": 57000, "duration_ms": 3200}` - Complete

## Latency Metrics Explained

| Metric | Description |
|--------|-------------|
| **First Byte** | Time from request to first audio chunk received |
| **Chunks Received** | Number of audio chunks streamed |
| **Total Data** | Total audio data size in KB |
| **Buffer Level** | Audio duration buffered for playback |

## License

MIT License - Feel free to use and modify.
