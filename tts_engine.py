"""TTS Engine wrapper with multiple backends for streaming synthesis."""
import io
import asyncio
from typing import AsyncGenerator

# Default configuration
DEFAULT_VOICE = "en"
CHUNK_SIZE = 8192

# Voice options for gTTS
VOICES = [
    {"id": "en", "name": "English (US)", "lang": "en"},
    {"id": "en-uk", "name": "English (UK)", "lang": "en-uk"},
    {"id": "en-au", "name": "English (Australia)", "lang": "en-au"},
    {"id": "en-in", "name": "English (India)", "lang": "en-in"},
]

async def get_voices() -> list[dict]:
    """Get list of available TTS voices."""
    return VOICES

async def synthesize_stream(text: str, voice: str = DEFAULT_VOICE, rate: str = "+0%") -> AsyncGenerator[bytes, None]:
    """Stream TTS audio chunks using gTTS.
    
    Yields MP3 audio chunks for browser-native playback.
    """
    from gtts import gTTS
    
    # Map voice to gTTS language
    lang = voice.split('-')[0] if '-' in voice else voice
    tld = 'co.uk' if 'uk' in voice else 'com.au' if 'au' in voice else 'co.in' if 'in' in voice else 'com'
    
    # Generate audio to buffer
    tts = gTTS(text=text, lang=lang, tld=tld)
    buffer = io.BytesIO()
    tts.write_to_fp(buffer)
    buffer.seek(0)
    
    # Stream in chunks
    while True:
        chunk = buffer.read(CHUNK_SIZE)
        if not chunk:
            break
        yield chunk
        await asyncio.sleep(0)  # Allow other tasks to run
