import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUDIO_START_DEADLINE_MS,
  playPronunciation,
  preloadPronunciationAudio,
  pronounceNow,
  spokenText,
  stopPronunciation,
} from "./studySpeech";

/** 假音频元素：readyState 由测试控制，play / pause 都记下来。 */
class FakeAudio {
  static created: FakeAudio[] = [];
  static nextReadyState = 4;

  readyState = FakeAudio.nextReadyState;
  preload = "";
  currentTime = 0;
  playCalls = 0;
  pauseCalls = 0;
  playResult: () => Promise<void> = () => Promise.resolve();
  private listeners = new Map<string, (() => void)[]>();

  constructor(readonly src: string) {
    FakeAudio.created.push(this);
  }

  play(): Promise<void> {
    this.playCalls += 1;
    return this.playResult();
  }

  pause(): void {
    this.pauseCalls += 1;
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

const speakMock = () => vi.mocked(window.speechSynthesis.speak);
const spoken = (accent: "en-GB" | "en-US", text: string) => expect.objectContaining({ text, lang: accent });

/** 每个用例用不同地址：模块里的音频缓存是进程级的。 */
let counter = 0;
const url = (name: string) => `https://audio.test/${name}-${(counter += 1)}.mp3`;
const audioFor = (target: string) => {
  const audio = FakeAudio.created.find((item) => item.src === target);
  if (!audio) throw new Error(`没有为 ${target} 建过音频元素`);
  return audio;
};

beforeEach(() => {
  vi.stubGlobal("Audio", FakeAudio);
  FakeAudio.created = [];
  FakeAudio.nextReadyState = 4;
});

afterEach(() => {
  stopPronunciation();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("音频预热", () => {
  it("同一个地址只建一个元素，并让它自己先下着", () => {
    const target = url("preload");
    preloadPronunciationAudio(target);
    preloadPronunciationAudio(target);
    expect(FakeAudio.created.filter((audio) => audio.src === target)).toHaveLength(1);
    expect(audioFor(target).preload).toBe("auto");
  });

  it("没有地址就什么都不做", () => {
    preloadPronunciationAudio(undefined);
    expect(FakeAudio.created).toHaveLength(0);
  });
});

describe("展开释义时自动朗读", () => {
  it("音频已经能播就直接放音频，不动系统语音", () => {
    const target = url("ready");
    preloadPronunciationAudio(target);
    expect(pronounceNow("government", "en-US", { us: target })).toBe("audio");
    expect(audioFor(target).playCalls).toBe(1);
    expect(speakMock()).not.toHaveBeenCalled();
  });

  it("音频还没下完就立刻用系统语音，一秒都不等", () => {
    FakeAudio.nextReadyState = 0;
    const target = url("slow");
    preloadPronunciationAudio(target);
    expect(pronounceNow("government", "en-GB", { uk: target })).toBe("speech");
    expect(speakMock()).toHaveBeenCalledWith(spoken("en-GB", "government"));
    expect(audioFor(target).playCalls).toBe(0);
  });

  it("口音挑对应的那条音频", () => {
    const uk = url("uk");
    const us = url("us");
    preloadPronunciationAudio(uk);
    preloadPronunciationAudio(us);
    pronounceNow("system", "en-US", { uk, us });
    expect(audioFor(us).playCalls).toBe(1);
    expect(audioFor(uk).playCalls).toBe(0);
    pronounceNow("system", "en-GB", { uk, us });
    expect(audioFor(uk).playCalls).toBe(1);
  });

  it("这个口音没有音频就走系统语音", () => {
    const us = url("us-only");
    preloadPronunciationAudio(us);
    expect(pronounceNow("government", "en-GB", { us })).toBe("speech");
    expect(speakMock()).toHaveBeenCalledWith(spoken("en-GB", "government"));
  });

  it("音频被浏览器拦下时补上系统语音", async () => {
    const target = url("blocked");
    preloadPronunciationAudio(target);
    audioFor(target).playResult = () => Promise.reject(new Error("NotAllowedError"));
    expect(pronounceNow("government", "en-US", { us: target })).toBe("audio");
    await vi.waitFor(() => expect(speakMock()).toHaveBeenCalledWith(spoken("en-US", "government")));
  });
});

describe("手点发音", () => {
  it("有音频就放音频", () => {
    const target = url("tap");
    playPronunciation("system", "en-US", target);
    expect(audioFor(target).playCalls).toBe(1);
    expect(speakMock()).not.toHaveBeenCalled();
  });

  it("没有音频就直接用系统语音", () => {
    playPronunciation("system", "en-GB", undefined);
    expect(speakMock()).toHaveBeenCalledWith(spoken("en-GB", "system"));
  });

  it("音频一直没起播，到点改用系统语音", () => {
    vi.useFakeTimers();
    const target = url("stall");
    playPronunciation("system", "en-US", target);
    vi.advanceTimersByTime(AUDIO_START_DEADLINE_MS + 1);
    expect(speakMock()).toHaveBeenCalledWith(spoken("en-US", "system"));
  });

  it("音频按时起播就不再念系统语音", () => {
    vi.useFakeTimers();
    const target = url("started");
    playPronunciation("system", "en-US", target);
    audioFor(target).emit("playing");
    vi.advanceTimersByTime(AUDIO_START_DEADLINE_MS + 1);
    expect(speakMock()).not.toHaveBeenCalled();
  });
});

describe("停声", () => {
  it("念词组时把 sb / sth 换成 someybody / something", () => {
    expect(spokenText("take sth into account")).toBe("take something into account");
    expect(spokenText("behind sb's back")).toBe("behind somebody's back");
    expect(spokenText("sb and sth")).toBe("somebody and something");
    /* 正常单词不能被误伤 */
    expect(spokenText("system")).toBe("system");
  });

  it("词组没有音频时用换过占位符的文本念出来", () => {
    pronounceNow("ability to do sth", "en-GB", {});
    expect(speakMock()).toHaveBeenCalledWith(spoken("en-GB", "ability to do something"));
  });

  it("换词时把音频停掉、语音取消", () => {
    const target = url("stop");
    preloadPronunciationAudio(target);
    pronounceNow("government", "en-US", { us: target });
    stopPronunciation();
    expect(audioFor(target).pauseCalls).toBe(1);
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });
});
