// Speech-to-Text (STT) and Text-to-Speech (TTS) Manager using Web Speech API

class SpeechManager {
  private synth: SpeechSynthesis | null = null;
  private recognition: any = null;
  private wakeWordRecognition: any = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private isListeningActive = false;
  private isWakeWordActive = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.synth = window.speechSynthesis;
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false; // Stop after a pause
        this.recognition.interimResults = false;
        this.recognition.lang = 'en-US';

        this.wakeWordRecognition = new SpeechRecognition();
        this.wakeWordRecognition.continuous = true;
        this.wakeWordRecognition.interimResults = true;
        this.wakeWordRecognition.lang = 'en-US';
      }
    }
  }

  // TTS: Speak text
  speak(
    text: string,
    voiceName?: string,
    rate = 1.0,
    pitch = 1.0,
    onStart?: () => void,
    onEnd?: () => void,
    onError?: (e: any) => void
  ) {
    if (!this.synth) {
      onError?.(new Error('Speech Synthesis not supported in this browser.'));
      return;
    }

    this.stopSpeaking();

    // Clean text: strip markdown characters
    const cleanText = text.replace(/[*#`_\-]/g, '').trim();

    this.currentUtterance = new SpeechSynthesisUtterance(cleanText);
    this.currentUtterance.rate = rate;
    this.currentUtterance.pitch = pitch;

    if (voiceName) {
      const voices = this.getVoices();
      const selectedVoice = voices.find(v => v.name === voiceName);
      if (selectedVoice) {
        this.currentUtterance.voice = selectedVoice;
      }
    }

    if (onStart) this.currentUtterance.onstart = onStart;
    if (onEnd) this.currentUtterance.onend = onEnd;
    this.currentUtterance.onerror = (e) => {
      // Don't error on manual cancel/interruption
      if (e.error !== 'interrupted') {
        onError?.(e);
      } else {
        onEnd?.();
      }
    };

    this.synth.speak(this.currentUtterance);
  }

  // TTS: Cancel active speech
  stopSpeaking() {
    if (this.synth) {
      this.synth.cancel();
      this.currentUtterance = null;
    }
  }

  // TTS: Retrieve all available voices
  getVoices(): SpeechSynthesisVoice[] {
    if (!this.synth) return [];
    return this.synth.getVoices();
  }

  // STT: Check if Speech Recognition is supported
  isRecognitionSupported(): boolean {
    return !!this.recognition;
  }

  // STT: Start listening to voice input
  startListening(
    onResult: (text: string) => void,
    onEnd: () => void,
    onError: (err: any) => void
  ) {
    if (!this.recognition) {
      onError(new Error('Speech Recognition not supported in this browser.'));
      return;
    }

    if (this.isListeningActive) {
      return;
    }

    this.isListeningActive = true;

    this.recognition.onresult = (event: any) => {
      const result = event.results[0][0].transcript;
      onResult(result);
    };

    this.recognition.onerror = (event: any) => {
      this.isListeningActive = false;
      // Abort is a standard trigger when stopListening() is called
      if (event.error !== 'aborted') {
        onError(event);
      }
    };

    this.recognition.onend = () => {
      this.isListeningActive = false;
      onEnd();
    };

    try {
      this.recognition.start();
    } catch (e) {
      this.isListeningActive = false;
      onError(e);
    }
  }

  // STT: Stop listening to voice input
  stopListening() {
    if (this.recognition && this.isListeningActive) {
      try {
        this.recognition.abort();
      } catch (e) {
        console.warn('Error stopping recognition:', e);
      }
      this.isListeningActive = false;
    }
  }

  // WAKE WORD: Start listening for "Hey Jarvis"
  startWakeWordListener(onWakeWord: () => void) {
    if (!this.wakeWordRecognition || this.isWakeWordActive) return;
    this.isWakeWordActive = true;

    this.wakeWordRecognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript.toLowerCase();
        if (transcript.includes('hey jarvis') || transcript.includes('jarvis')) {
          this.stopWakeWordListener();
          onWakeWord();
          break;
        }
      }
    };

    this.wakeWordRecognition.onend = () => {
      if (this.isWakeWordActive) {
        try {
          this.wakeWordRecognition.start();
        } catch (e) {
          console.warn('Failed to restart wake word listener:', e);
        }
      }
    };

    this.wakeWordRecognition.onerror = (e: any) => {
      if (e.error !== 'aborted') {
        console.warn('Wake word listener error:', e.error);
      }
    };

    try {
      this.wakeWordRecognition.start();
    } catch (e) {
      console.warn('Failed to start wake word listener:', e);
      this.isWakeWordActive = false;
    }
  }

  stopWakeWordListener() {
    this.isWakeWordActive = false;
    if (this.wakeWordRecognition) {
      try {
        this.wakeWordRecognition.abort();
      } catch (e) {}
    }
  }
}

export const speech = new SpeechManager();
