export interface SpeechSynthesisPort {
  speak(utterance: SpeechSynthesisUtterance): void;
  cancel(): void;
}

export type SpeechUtteranceFactory = (text: string) => SpeechSynthesisUtterance;

export interface SpeechState {
  activeTarget: string | null;
  errorTarget: string | null;
  error: string | null;
  unsupported: boolean;
}

const INITIAL_STATE: SpeechState = {
  activeTarget: null,
  errorTarget: null,
  error: null,
  unsupported: false,
};

export function createSpeechController(
  synthesis: SpeechSynthesisPort | undefined,
  makeUtterance: SpeechUtteranceFactory | undefined,
  onState: (state: SpeechState) => void = () => undefined,
) {
  let state = { ...INITIAL_STATE };
  let generation = 0;

  const publish = () => onState({ ...state });
  const cancelCurrent = () => {
    // Invalidate callbacks before cancel: browsers may synchronously emit an error.
    generation += 1;
    const wasActive = state.activeTarget !== null;
    state = { ...state, activeTarget: null };
    if (wasActive) {
      try {
        synthesis?.cancel();
      } catch {
        // The request is already considered stopped; a later action can retry.
      }
    }
  };

  const stop = () => {
    if (!state.activeTarget && !state.error) return;
    cancelCurrent();
    state = { ...state, errorTarget: null, error: null, unsupported: false };
    publish();
  };

  const toggle = (target: string, text: string, locale: "en-US" | "ja-JP") => {
    if (state.activeTarget === target) {
      stop();
      return;
    }
    cancelCurrent();
    state = { ...INITIAL_STATE, activeTarget: target };
    const currentGeneration = generation;
    if (!synthesis || !makeUtterance) {
      state = {
        activeTarget: null,
        errorTarget: target,
        error: "このブラウザーは音声読み上げに対応していません。本文はそのまま読めます。",
        unsupported: true,
      };
      publish();
      return;
    }

    let utterance: SpeechSynthesisUtterance;
    try {
      utterance = makeUtterance(text);
      utterance.lang = locale;
    } catch {
      state = {
        activeTarget: null,
        errorTarget: target,
        error: "読み上げを開始できませんでした。もう一度お試しください。",
        unsupported: false,
      };
      publish();
      return;
    }
    utterance.onend = () => {
      if (generation !== currentGeneration) return;
      state = { ...INITIAL_STATE };
      publish();
    };
    utterance.onerror = (event) => {
      if (generation !== currentGeneration) return;
      if (event.error === "canceled" || event.error === "interrupted") {
        state = { ...INITIAL_STATE };
      } else {
        state = {
          activeTarget: null,
          errorTarget: target,
          error: "読み上げに失敗しました。もう一度お試しください。",
          unsupported: false,
        };
      }
      publish();
    };
    publish();
    try {
      synthesis.speak(utterance);
    } catch {
      if (generation !== currentGeneration) return;
      state = {
        activeTarget: null,
        errorTarget: target,
        error: "読み上げを開始できませんでした。もう一度お試しください。",
        unsupported: false,
      };
      publish();
    }
  };

  return {
    toggle,
    stop,
    stopIfTargetStartsWith(prefix: string) {
      if (state.activeTarget?.startsWith(prefix)) stop();
    },
    getState: () => ({ ...state }),
  };
}
