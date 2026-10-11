import { describe, expect, it, vi } from "vitest";
import { createSpeechController, type SpeechSynthesisPort } from "./speech";

interface TestUtterance {
  text: string;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

function setup(supported = true) {
  const utterances: TestUtterance[] = [];
  const engine: SpeechSynthesisPort = {
    speak: vi.fn(),
    cancel: vi.fn(),
  };
  const makeUtterance = vi.fn((text: string) => {
    const utterance: TestUtterance = { text, lang: "", onend: null, onerror: null };
    utterances.push(utterance);
    return utterance as unknown as SpeechSynthesisUtterance;
  });
  const states: ReturnType<ReturnType<typeof createSpeechController>["getState"]>[] = [];
  const controller = createSpeechController(supported ? engine : undefined, supported ? makeUtterance : undefined, (state) => states.push(state));
  return { controller, engine, makeUtterance, utterances, states };
}

describe("speech controller", () => {
  it("speaks the complete requested text with its locale and toggles the same target off", () => {
    const { controller, engine, utterances } = setup();
    const text = "Long passage ".repeat(300);

    controller.toggle("unit:1:en", text, "en-US");
    expect(utterances[0]?.text).toBe(text);
    expect(utterances[0]?.lang).toBe("en-US");
    expect(engine.speak).toHaveBeenCalledTimes(1);
    expect(controller.getState().activeTarget).toBe("unit:1:en");

    controller.toggle("unit:1:en", text, "en-US");
    expect(engine.cancel).toHaveBeenCalledTimes(1);
    expect(controller.getState().activeTarget).toBeNull();
  });

  it("cancels the old target before starting another and ignores its stale events", () => {
    const { controller, engine, utterances } = setup();
    controller.toggle("unit:1:en", "English", "en-US");
    const oldUtterance = utterances[0]!;
    controller.toggle("unit:1:ja", "日本語", "ja-JP");
    const currentUtterance = utterances[1]!;

    expect(engine.cancel).toHaveBeenCalledTimes(1);
    expect(controller.getState().activeTarget).toBe("unit:1:ja");
    oldUtterance.onerror?.({ error: "interrupted" });
    oldUtterance.onend?.();
    expect(controller.getState().activeTarget).toBe("unit:1:ja");
    expect(currentUtterance.lang).toBe("ja-JP");
  });

  it("invalidates the prior utterance before a synchronous cancel error fires", () => {
    const utterances: TestUtterance[] = [];
    let onCancel: (() => void) | undefined;
    const engine: SpeechSynthesisPort = {
      speak: vi.fn(),
      cancel: vi.fn(() => onCancel?.()),
    };
    const makeUtterance = (text: string) => {
      const utterance: TestUtterance = { text, lang: "", onend: null, onerror: null };
      utterances.push(utterance);
      return utterance as unknown as SpeechSynthesisUtterance;
    };
    const states: ReturnType<ReturnType<typeof createSpeechController>["getState"]>[] = [];
    const controller = createSpeechController(engine, makeUtterance, (state) => states.push(state));
    controller.toggle("unit:1:en", "English", "en-US");
    onCancel = () => utterances[0]!.onerror?.({ error: "interrupted" });

    controller.toggle("unit:1:ja", "日本語", "ja-JP");

    expect(controller.getState().activeTarget).toBe("unit:1:ja");
    expect(controller.getState().error).toBeNull();
    expect(states.at(-1)?.activeTarget).toBe("unit:1:ja");
  });

  it("clears on completion, reports real errors, and treats browser cancellations as quiet stops", () => {
    const { controller, utterances } = setup();
    controller.toggle("unit:1:en", "English", "en-US");
    utterances[0]!.onend?.();
    expect(controller.getState().activeTarget).toBeNull();
    expect(controller.getState().error).toBeNull();

    controller.toggle("unit:1:ja", "日本語", "ja-JP");
    utterances[1]!.onerror?.({ error: "synthesis-failed" });
    expect(controller.getState().activeTarget).toBeNull();
    expect(controller.getState().errorTarget).toBe("unit:1:ja");
    expect(controller.getState().error).toContain("もう一度");

    controller.toggle("unit:1:ja", "日本語", "ja-JP");
    utterances[2]!.onerror?.({ error: "canceled" });
    expect(controller.getState().activeTarget).toBeNull();
    expect(controller.getState().error).toBeNull();
  });

  it("reports missing API support without stopping reading", () => {
    const { controller, states } = setup(false);
    controller.toggle("unit:1:en", "English", "en-US");
    expect(controller.getState().unsupported).toBe(true);
    expect(controller.getState().error).toContain("対応していません");
    expect(states.at(-1)?.errorTarget).toBe("unit:1:en");
  });

  it("stops only an active note whose own disclosure is closed", () => {
    const { controller, engine } = setup();
    controller.toggle("note:unit-a:0:en", "Note A", "en-US");
    controller.stopIfTargetStartsWith("note:unit-b:");
    expect(engine.cancel).not.toHaveBeenCalled();
    expect(controller.getState().activeTarget).toBe("note:unit-a:0:en");

    controller.stopIfTargetStartsWith("note:unit-a:0:");
    expect(engine.cancel).toHaveBeenCalledTimes(1);
    expect(controller.getState().activeTarget).toBeNull();
  });
});
