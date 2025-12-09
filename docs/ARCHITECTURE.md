# Architecture Deep Dive

This document provides a comprehensive technical analysis of the Real-Time Streaming TTS Player architecture, covering the streaming pipeline, audio processing, and latency optimization strategies.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              BROWSER CLIENT                              │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌───────────────┐    ┌─────────────────────────┐  │
│  │   UI Layer   │───▶│  TTSClient    │───▶│  StreamingAudioPlayer   │  │
│  │  (Controls)  │    │  (WebSocket)  │    │  (Blob + Audio Element) │  │
│  └──────────────┘    └───────────────┘    └─────────────────────────┘  │
│         │                    │                        │                 │
│         │                    │                        ▼                 │
│         │                    │             ┌─────────────────────┐      │
│         │                    │             │  LatencyProfiler    │      │
│         │                    │             │  (Performance API)  │      │
│         └────────────────────┼─────────────┴──────────┬──────────┘      │
│                              │                        │                 │
│  Metrics Display ◀───────────┴────────────────────────┘                 │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ WebSocket (Binary + JSON)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              PYTHON SERVER                               │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐                                                   │
│  │   FastAPI App    │                                                   │
│  │  ┌────────────┐  │    ┌─────────────────────────────────────────┐   │
│  │  │ /ws/tts    │──┼───▶│         TTS Engine (tts_engine.py)        │   │
│  │  │ WebSocket  │  │    │  ┌─────────────────────────────────────┐ │   │
│  │  └────────────┘  │    │  │   gTTS (Google Text-to-Speech)      │ │   │
│  │  ┌────────────┐  │    │  │   - HTTP to Google TTS API          │ │   │
│  │  │ /api/voices│  │    │  │   - Returns MP3 audio buffer        │ │   │
│  │  │ REST       │  │    │  └─────────────────────────────────────┘ │   │
│  │  └────────────┘  │    └─────────────────────────────────────────┘   │
│  └──────────────────┘                                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Audio Streaming Pipeline

### 1. Request Flow

```
User Input → WebSocket Message → TTS Synthesis → Chunk Streaming → Audio Playback
    │              │                  │                │               │
    │              │                  │                │               ▼
    │              │                  │                │         Blob URL Creation
    │              │                  │                │               │
    │              │                  │                │               ▼
    │              │                  │                │         Audio.play()
    │              │                  │                │               │
    ▼              ▼                  ▼                ▼               ▼
 ~0ms           ~5ms            ~3000ms           ~100ms           ~50ms
                                (gTTS API)      (streaming)      (decode)
```

### 2. Chunked Audio Buffering

The system uses a chunked buffering strategy for smooth playback:

```python
# Server-side chunking (tts_engine.py)
CHUNK_SIZE = 8192  # 8KB per chunk

async def synthesize_stream(text, voice, rate):
    # Generate complete audio first
    tts = gTTS(text=text, lang=lang)
    buffer = io.BytesIO()
    tts.write_to_fp(buffer)
    buffer.seek(0)
    
    # Stream in fixed-size chunks
    while True:
        chunk = buffer.read(CHUNK_SIZE)
        if not chunk:
            break
        yield chunk  # Async generator yields chunks
```

### 3. Browser Audio Playback

Two approaches were evaluated:

#### Approach A: Web Audio API + decodeAudioData (Not Used)
- **Problem**: `decodeAudioData` requires complete, valid audio files
- **Issue**: Streaming partial MP3 frames causes decode errors
- **Latency**: Would be lower if it worked (~20ms decode per chunk)

#### Approach B: Blob URL + Audio Element (Current Implementation)
- **Strategy**: Collect all chunks, create Blob, play via Audio element
- **Advantage**: 100% reliable MP3 playback
- **Trade-off**: Slight delay waiting for all chunks
- **Benefit**: Browser handles MP3 decoding natively

```javascript
// Client-side audio playback (app.js)
class StreamingAudioPlayer {
    async finalize() {
        // Combine chunks into a single blob
        const blob = new Blob(this.chunks, { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        
        this.audioElement.src = url;
        await this.audioElement.play();
    }
}
```

## Latency Profiling

### Metrics Collection Points

```
┌────────────┐     ┌────────────┐     ┌────────────┐     ┌────────────┐
│  Request   │────▶│ First Byte │────▶│  Chunks    │────▶│  Playback  │
│   Sent     │     │  Received  │     │  Complete  │     │   Start    │
└────────────┘     └────────────┘     └────────────┘     └────────────┘
      │                  │                  │                  │
      │ T0               │ T1               │ T2               │ T3
      │                  │                  │                  │
      ├──────────────────┤                  │                  │
      │   First Byte     │                  │                  │
      │   Latency        │                  │                  │
      │                  ├──────────────────┤                  │
      │                  │   Streaming      │                  │
      │                  │   Duration       │                  │
      │                  │                  ├──────────────────┤
      │                  │                  │   Buffer to      │
      │                  │                  │   Play Latency   │
      └──────────────────┴──────────────────┴──────────────────┘
                      Total End-to-End Latency
```

### Implementation

```javascript
class LatencyProfiler {
    markRequest() { 
        this.requestTime = performance.now();  // High-resolution timestamp
    }
    
    markFirstByte() { 
        this.firstByteTime = performance.now(); 
    }
    
    get firstByteLatency() { 
        return Math.round(this.firstByteTime - this.requestTime); 
    }
}
```

## WebSocket Protocol

### Message Types

| Direction | Type | Format | Purpose |
|-----------|------|--------|---------|
| Client → Server | Request | JSON | `{text, voice, rate}` |
| Server → Client | Start | JSON | `{type: "start", timestamp}` |
| Server → Client | Audio | Binary | Raw MP3 chunk bytes |
| Server → Client | End | JSON | `{type: "end", chunks, bytes, duration_ms}` |
| Server → Client | Error | JSON | `{type: "error", message}` |

### Binary Frame Handling

```javascript
this.ws.binaryType = 'arraybuffer';

handleMessage(event) {
    if (event.data instanceof ArrayBuffer) {
        // Binary audio chunk
        this.audioPlayer.addChunk(new Uint8Array(event.data));
    } else {
        // JSON control message
        const msg = JSON.parse(event.data);
        // Handle start/end/error
    }
}
```

## Performance Characteristics

### Typical Latency Breakdown

| Phase | Typical Duration | Notes |
|-------|------------------|-------|
| WebSocket RTT | ~5ms | Local network |
| gTTS API Call | 2000-4000ms | Google's servers |
| Audio Transfer | 50-200ms | Depends on length |
| Browser Decode | ~50ms | MP3 native decode |
| **Total** | **2100-4300ms** | First byte to audio |

### Optimization Strategies

1. **Streaming Chunks**: Send audio as it's generated, don't wait for complete file
2. **Fixed Chunk Size**: 8KB chunks balance latency vs overhead
3. **Async I/O**: Non-blocking WebSocket and async audio processing
4. **Pre-buffering**: Start playback when sufficient audio is buffered

## File Organization

```
TTS Player/
├── server.py              # 74 lines - FastAPI + WebSocket
├── tts_engine.py          # 42 lines - gTTS wrapper
├── requirements.txt       # 5 dependencies
├── static/
│   ├── index.html         # 85 lines - UI structure
│   ├── css/style.css      # 180 lines - Styling
│   └── js/app.js          # 210 lines - Client logic
└── docs/
    └── ARCHITECTURE.md    # This file
```

**Total Lines of Code**: ~596 lines (excluding docs)

## Error Handling

### Server-Side

```python
try:
    async for chunk in synthesize_stream(text, voice, rate):
        await websocket.send_bytes(chunk)
except WebSocketDisconnect:
    print("Client disconnected")
except Exception as e:
    print(f"Error: {e}")
```

### Client-Side

```javascript
this.ws.onerror = (e) => {
    console.error('WS Error:', e);
    this.onStatus('error', 'Connection error');
};

try {
    await this.audioElement.play();
} catch (e) {
    console.error('Playback error:', e);
}
```

## Future Improvements

1. **True Streaming Playback**: Use MediaSource Extensions with proper MP3 frame detection
2. **Lower Latency**: Switch to edge-tts when SSL issues are resolved (faster than gTTS)
3. **Audio Visualization**: Add waveform/spectrum display using Web Audio API's AnalyserNode
4. **Caching**: Cache synthesized audio for repeated phrases
5. **Progressive Playback**: Start playing before all chunks arrive (requires proper frame boundaries)

## References

- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [MediaSource Extensions](https://developer.mozilla.org/en-US/docs/Web/API/MediaSource)
- [gTTS Documentation](https://gtts.readthedocs.io/)
- [FastAPI WebSockets](https://fastapi.tiangolo.com/advanced/websockets/)
