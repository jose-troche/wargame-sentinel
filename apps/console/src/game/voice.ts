// Speech in and out through the browser's Web Speech API. Both are optional: the mic button only
// appears where recognition exists (Chrome, Edge, Safari), and spoken alerts are off by default.

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

function ctor(): (new () => RecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canListen = () => typeof window !== "undefined" && !!ctor();
export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** Starts listening; calls onText with interim text and onFinal once with the final transcript. */
export function listen(onText: (t: string) => void, onFinal: (t: string) => void, onEnd: (error?: string) => void): () => void {
  const C = ctor();
  if (!C) {
    onEnd("Speech recognition is not available in this browser.");
    return () => undefined;
  }
  const r = new C();
  r.lang = navigator.language || "en-US";
  r.interimResults = true;
  r.continuous = false;
  let final = "";
  r.onresult = (e) => {
    let text = "";
    for (let i = 0; i < e.results.length; i++) {
      const res = e.results[i];
      text += res[0].transcript;
      if (res.isFinal) final = text;
    }
    onText(text);
  };
  r.onerror = (e) => onEnd(e.error === "not-allowed" ? "Microphone access was blocked." : e.error === "no-speech" ? "I didn't hear anything." : `Speech error: ${e.error}`);
  r.onend = () => {
    if (final.trim()) onFinal(final.trim());
    onEnd();
  };
  try {
    r.start();
  } catch {
    onEnd("Could not start the microphone.");
  }
  return () => {
    try { r.stop(); } catch { /* already stopped */ }
  };
}

let lastSpoken = "";
/** Speaks a short message; a newer message interrupts an older one. */
export function speak(text: string) {
  if (!canSpeak() || !text || text === lastSpoken) return;
  lastSpoken = text;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/≈/g, "about ").replace(/·/g, ","));
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  } catch { /* speech unavailable */ }
}
