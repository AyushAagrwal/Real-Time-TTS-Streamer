/**
 * Real-Time TTS Player - Main Application
 * Uses MediaSource Extensions for low-latency MP3 streaming playback
 */

// ===================== Latency Profiler =====================
class LatencyProfiler {
    constructor() { this.reset(); }

    reset() {
        this.requestTime = 0;
        this.firstByteTime = 0;
        this.chunkCount = 0;
        this.totalBytes = 0;
    }

    markRequest() { this.requestTime = performance.now(); }
    markFirstByte() { this.firstByteTime = performance.now(); }
    addChunk(bytes) { this.chunkCount++; this.totalBytes += bytes; }

    get firstByteLatency() {
        return this.firstByteTime ? Math.round(this.firstByteTime - this.requestTime) : 0;
    }
    get totalKB() { return (this.totalBytes / 1024).toFixed(1); }
}

// ===================== Streaming Audio Player =====================
class StreamingAudioPlayer {
    constructor(onBufferUpdate) {
        this.audioElement = null;
        this.mediaSource = null;
        this.sourceBuffer = null;
        this.chunks = [];
        this.isPlaying = false;
        this.onBufferUpdate = onBufferUpdate;
        this.initAudio();
    }

    initAudio() {
        this.audioElement = new Audio();
        this.audioElement.autoplay = true;
    }

    async start() {
        this.chunks = [];
        this.isPlaying = true;

        // Use Blob URL approach for reliable MP3 streaming
        this.audioElement.pause();
        this.audioElement.src = '';
    }

    addChunk(chunk) {
        this.chunks.push(chunk);
    }

    async finalize() {
        if (this.chunks.length === 0) return;

        // Combine all chunks into a single blob and play
        const blob = new Blob(this.chunks, { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);

        this.audioElement.src = url;
        this.audioElement.onloadedmetadata = () => {
            this.onBufferUpdate(this.audioElement.duration.toFixed(2));
        };

        try {
            await this.audioElement.play();
        } catch (e) {
            console.error('Playback error:', e);
        }

        // Cleanup URL after playback
        this.audioElement.onended = () => {
            URL.revokeObjectURL(url);
            this.isPlaying = false;
        };
    }

    stop() {
        this.isPlaying = false;
        this.audioElement.pause();
        this.audioElement.src = '';
        this.chunks = [];
    }
}

// ===================== WebSocket TTS Client =====================
class TTSClient {
    constructor(onStatus, onMetrics) {
        this.ws = null;
        this.profiler = new LatencyProfiler();
        this.audioPlayer = new StreamingAudioPlayer((level) => onMetrics('buffer', level));
        this.onStatus = onStatus;
        this.onMetrics = onMetrics;
    }

    async connect() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.ws = new WebSocket(`${protocol}//${location.host}/ws/tts`);
        this.ws.binaryType = 'arraybuffer';

        return new Promise((resolve, reject) => {
            this.ws.onopen = () => { this.onStatus('connected', 'Connected'); resolve(); };
            this.ws.onerror = (e) => { console.error('WS Error:', e); this.onStatus('error', 'Connection error'); reject(); };
            this.ws.onclose = () => this.onStatus('', 'Disconnected');
            this.ws.onmessage = (e) => this.handleMessage(e);
        });
    }

    handleMessage(event) {
        if (event.data instanceof ArrayBuffer) {
            // Binary audio chunk (MP3)
            if (this.profiler.chunkCount === 0) {
                this.profiler.markFirstByte();
                this.onMetrics('firstByte', this.profiler.firstByteLatency);
            }
            this.profiler.addChunk(event.data.byteLength);
            this.onMetrics('chunks', this.profiler.chunkCount);
            this.onMetrics('bytes', this.profiler.totalKB);

            // Add chunk to player
            this.audioPlayer.addChunk(new Uint8Array(event.data));
        } else {
            // JSON control message
            const msg = JSON.parse(event.data);
            if (msg.type === 'start') {
                this.onStatus('streaming', 'Receiving audio...');
                this.audioPlayer.start();
            } else if (msg.type === 'end') {
                this.onMetrics('total', msg.duration_ms);
                this.onStatus('connected', 'Playing audio');
                // Finalize and play the audio
                this.audioPlayer.finalize();
            } else if (msg.type === 'error') {
                this.onStatus('error', msg.message);
            }
        }
    }

    async speak(text, voice, rate) {
        this.profiler.reset();
        this.profiler.markRequest();
        this.ws.send(JSON.stringify({ text, voice, rate: `${rate >= 0 ? '+' : ''}${rate}%` }));
    }

    stop() {
        this.audioPlayer.stop();
        this.onStatus('connected', 'Stopped');
    }

    disconnect() {
        if (this.ws) this.ws.close();
    }
}

// ===================== UI Controller =====================
class UIController {
    constructor() {
        this.client = null;
        this.bindElements();
        this.bindEvents();
        this.init();
    }

    bindElements() {
        this.textInput = document.getElementById('textInput');
        this.voiceSelect = document.getElementById('voiceSelect');
        this.rateSlider = document.getElementById('rateSlider');
        this.rateValue = document.getElementById('rateValue');
        this.playBtn = document.getElementById('playBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.statusDot = document.getElementById('statusDot');
        this.statusText = document.getElementById('statusText');
    }

    bindEvents() {
        this.playBtn.onclick = () => this.play();
        this.stopBtn.onclick = () => this.stop();
        this.rateSlider.oninput = () => {
            this.rateValue.textContent = `${this.rateSlider.value}%`;
        };
    }

    async init() {
        // Load voices
        try {
            const res = await fetch('/api/voices');
            const data = await res.json();
            this.voiceSelect.innerHTML = data.voices
                .filter(v => v.lang.startsWith('en'))
                .map(v => `<option value="${v.id}">${v.name}</option>`)
                .join('');
        } catch (e) {
            console.error('Failed to load voices:', e);
            this.voiceSelect.innerHTML = '<option value="en-US-AriaNeural">Aria (US)</option>';
        }

        // Initialize TTS client
        this.client = new TTSClient(
            (status, text) => this.updateStatus(status, text),
            (metric, value) => this.updateMetric(metric, value)
        );

        try {
            await this.client.connect();
        } catch (e) {
            this.updateStatus('error', 'Failed to connect');
        }
    }

    updateStatus(status, text) {
        this.statusDot.className = 'status-dot ' + status;
        this.statusText.textContent = text;
        this.playBtn.disabled = status === 'streaming';
        this.stopBtn.disabled = status !== 'streaming' && status !== 'connected';
    }

    updateMetric(metric, value) {
        const metricMap = {
            'firstByte': 'FirstByte',
            'chunks': 'Chunks',
            'bytes': 'Bytes',
            'buffer': 'Buffer',
            'decode': 'Decode',
            'total': 'Total'
        };
        const el = document.getElementById(`metric${metricMap[metric] || metric}`);
        if (el) el.textContent = value;
    }

    async play() {
        const text = this.textInput.value.trim();
        if (!text) return;

        // Reset metrics
        ['FirstByte', 'Chunks', 'Bytes', 'Buffer', 'Decode', 'Total'].forEach(m => {
            document.getElementById(`metric${m}`).textContent = '--';
        });

        await this.client.speak(text, this.voiceSelect.value, parseInt(this.rateSlider.value));
    }

    stop() {
        this.client.stop();
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => new UIController());
