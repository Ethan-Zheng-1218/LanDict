import { Card } from "@/components/ui/card";
import { BrandLogo } from "@/components/ui/brand-logo";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/icon-button";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Check, Info, Languages, Palette, Settings2, X } from "@/components/ui/icon";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { loadSettings, saveSettings, SETTINGS_CHANGED_EVENT, type MouseLookupSettings, type ReadingSettings, type TranslationSettings } from "./settingsStore";
import { isTauri } from "@tauri-apps/api/core";
import { AI_PROVIDER_PRESETS, findAiProviderPreset, isCustomProvider } from "./aiProviders";
import { testAiConnection } from "../translation/aiTranslationProvider";
import { getSpeechVoice } from "../reading/speech";
import { ThemePicker } from "./ThemePicker";
import { AutostartSetting } from "./AutostartSetting";
import { version as appVersion } from "../../../package.json";

type SettingsSection = "general" | "appearance" | "translation" | "about";

const sections: { id: SettingsSection; label: string; icon: typeof Settings2 }[] = [
  { id: "general", label: "通用", icon: Settings2 },
  { id: "appearance", label: "主题", icon: Palette },
  { id: "translation", label: "翻译", icon: Languages },
  { id: "about", label: "关于", icon: Info },
];

export function SettingsPage({ onClose }: { onClose?: () => void } = {}) {
  const [section, setSection] = useState<SettingsSection>("general");
  const initialSettings = loadSettings();
  const [translation, setTranslation] = useState<TranslationSettings>(initialSettings.translation);
  const [reading, setReading] = useState<ReadingSettings>(initialSettings.reading);
  const [autoAi, setAutoAi] = useState(initialSettings.query.aiEnabled);
  const [mouseLookup, setMouseLookup] = useState(initialSettings.mouseLookup);
  const [delayInput, setDelayInput] = useState(String(initialSettings.mouseLookup.delayMs));
  const [theme, setTheme] = useState(initialSettings.appearance.theme);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [speechVoiceName, setSpeechVoiceName] = useState("");
  const accentPointerStart = useRef<number | null>(null);
  const shortVoiceName = speechVoiceName.split(" - ")[0].replace(/\s+Online.*$/i, "") || "系统默认";

  function updateTranslation<K extends keyof TranslationSettings>(key: K, value: TranslationSettings[K]) {
    setSaved(false);
    setTestResult(null);
    setTranslation((current) => ({ ...current, [key]: value }));
  }

  /** Picking a provider also fills in its endpoint and model, so nobody has to look them up. */
  function updateProvider(provider: TranslationSettings["provider"]) {
    const preset = findAiProviderPreset(provider);
    setSaved(false);
    setTestResult(null);
    setTranslation((current) => ({
      ...current,
      provider,
      apiBaseUrl: preset.custom ? current.apiBaseUrl : preset.baseUrl,
      model: preset.custom ? current.model : preset.model,
    }));
  }

  function saveTranslation() {
    saveSettings({ translation });
    setSaved(true);
  }

  function updateReading<K extends keyof ReadingSettings>(key: K, value: ReadingSettings[K]) {
    const next = { ...reading, [key]: value };
    setReading(next);
    saveSettings({ reading: next });
  }

  function updateMouseLookup<K extends keyof MouseLookupSettings>(key: K, value: MouseLookupSettings[K]) {
    const next = saveSettings({ mouseLookup: { ...mouseLookup, [key]: value } });
    setMouseLookup(next.mouseLookup);
  }

  useEffect(() => {
    const update = () => {
      const current = loadSettings();
      const settings = current.mouseLookup;
      setAutoAi(current.query.aiEnabled);
      setMouseLookup(settings);
      setDelayInput(String(settings.delayMs));
    };
    window.addEventListener(SETTINGS_CHANGED_EVENT, update);
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, update);
  }, []);

  useEffect(() => {
    const update = () => setSpeechVoiceName(getSpeechVoice(reading.voiceAccent)?.name ?? "");
    update();
    window.speechSynthesis?.addEventListener?.("voiceschanged", update);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", update);
  }, [reading.voiceAccent]);

  async function runConnectionTest() {
    setTesting(true);
    setTestResult(null);
    const result = await testAiConnection({
      apiBaseUrl: translation.apiBaseUrl,
      apiKey: translation.apiKey,
      model: translation.model,
    });
    setTesting(false);
    setTestResult({ ok: result.ok, message: result.ok ? `${result.message}（${result.elapsedMs} ms）` : result.message });
  }

  return (
    <section className="settings-page" aria-label="设置" role={onClose ? "dialog" : undefined} aria-modal={onClose ? "true" : undefined}>
      <div className="settings-window" data-testid="settings-window">
        {onClose && <IconButton label="关闭设置" className="settings-close" onClick={onClose} type="button"><X /></IconButton>}
        <aside className="settings-navigation">
          <h1 className="settings-navigation-heading">设置</h1>
          <nav aria-label="设置分类">
            {sections.map(({ id, label, icon: Icon }) => (
              <button className={section === id ? "settings-nav-item active" : "settings-nav-item"} key={id} onClick={() => setSection(id)} type="button">
                <Icon aria-hidden="true" size={16} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="settings-content" data-testid="settings-content">
          {section === "general" && (
            <SettingsSection title="通用">
              <AutostartSetting />
              <div className="settings-row">
                <div><strong>朗读口音</strong><span className="settings-voice-summary">朗读音色：{shortVoiceName}</span></div>
                <div className="settings-accent-toggle" role="radiogroup" aria-label="朗读口音" data-accent={reading.voiceAccent}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    accentPointerStart.current = event.clientX;
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerUp={(event) => {
                    if (accentPointerStart.current === null) return;
                    const delta = event.clientX - accentPointerStart.current;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const american = Math.abs(delta) > 12 ? delta > 0 : event.clientX >= bounds.left + bounds.width / 2;
                    accentPointerStart.current = null;
                    updateReading("voiceAccent", american ? "en-US" : "en-GB");
                  }}
                  onPointerCancel={() => { accentPointerStart.current = null; }}
                >
                  <i className="settings-accent-thumb" aria-hidden="true" />
                  <label><input aria-label="英式发音" name="reading-voice-accent" type="radio" checked={reading.voiceAccent === "en-GB"} onChange={() => updateReading("voiceAccent", "en-GB")} /><span>英式</span></label>
                  <label><input aria-label="美式发音" name="reading-voice-accent" type="radio" checked={reading.voiceAccent === "en-US"} onChange={() => updateReading("voiceAccent", "en-US")} /><span>美式</span></label>
                </div>
              </div>
              <div className="settings-row">
                <div><strong>鼠标取词</strong><span>{isTauri() ? "停留在英文单词上查看释义，关闭窗口后仍在托盘运行" : "在 Windows 桌面版中生效"}</span></div>
                <label className="settings-switch"><input aria-label="鼠标取词" checked={mouseLookup.enabled} onChange={(event) => updateMouseLookup("enabled", event.target.checked)} type="checkbox" /><span /></label>
              </div>
              <div className="settings-row">
                <div><strong>鼠标停留时间</strong><span>100–3000 ms，默认 500 ms</span></div>
                <label className="mouse-lookup-delay"><Input aria-label="鼠标停留时间" type="number" min={100} max={3000} step={50} value={delayInput} onChange={(event) => {
                  setDelayInput(event.target.value);
                  const value = event.target.valueAsNumber;
                  if (Number.isFinite(value) && value >= 100 && value <= 3000) updateMouseLookup("delayMs", value);
                }} onBlur={() => updateMouseLookup("delayMs", delayInput.trim() ? Number(delayInput) : mouseLookup.delayMs)} /><span>ms</span></label>
              </div>
              <div className="settings-row">
                <div><strong>本地 OCR 补充</strong><span>无法直接读取文字时，识别鼠标附近的英文内容</span></div>
                <label className="settings-switch"><input aria-label="本地 OCR 补充" checked={mouseLookup.ocrEnabled} onChange={(event) => updateMouseLookup("ocrEnabled", event.target.checked)} type="checkbox" /><span /></label>
              </div>
            </SettingsSection>
          )}

          {section === "appearance" && (
            <SettingsSection title="主题" description="选择你喜欢的主题，应用后将立即生效并自动保存。">
              <ThemePicker theme={theme} onChange={(next) => {
                setTheme(next);
                saveSettings({ appearance: { theme: next } });
              }} />
            </SettingsSection>
          )}

          {section === "translation" && (
            <SettingsSection title="翻译">
              <div className="settings-row">
                <div><strong>单词自动查询</strong><span>阅读时双击或选中单词，自动弹出解释</span></div>
                <label className="settings-switch"><input aria-label="单词自动查询" checked={reading.autoLookupWord} onChange={(event) => updateReading("autoLookupWord", event.target.checked)} type="checkbox" /><span /></label>
              </div>
              <div className="settings-row">
                <div><strong>本地翻译</strong><span>短语、句子和段落默认使用内置英中模型；免费，可离线使用</span></div>
                <span className="settings-value">英语 ↔ 简体中文</span>
              </div>
              <div className="settings-row">
                <div><strong>AI 翻译</strong><span>开启后自动展开并翻译，关闭后需手动展开</span></div>
                <label className="settings-switch"><input aria-label="AI 自动翻译" checked={autoAi} onChange={(event) => {
                  saveSettings({ query: { aiEnabled: event.target.checked } });
                }} type="checkbox" /><span /></label>
              </div>
              <Card className="settings-form-card">
                <div className="settings-form-heading"><div><strong>AI 翻译服务</strong></div><span className={translation.apiKey.trim() ? "settings-value configured" : "settings-value"}>{translation.apiKey.trim() ? "可用" : "未配置"}</span></div>
                <label className="settings-field">服务类型<select aria-label="服务类型" value={translation.provider} onChange={(event) => updateProvider(event.target.value as TranslationSettings["provider"])}>{AI_PROVIDER_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
                {isCustomProvider(translation.provider) ? <>
                  <label className="settings-field">API Base URL<Input aria-label="API Base URL" placeholder="https://api.example.com/v1" value={translation.apiBaseUrl} onChange={(event) => updateTranslation("apiBaseUrl", event.target.value)} /></label>
                  <label className="settings-field">模型名称<Input aria-label="模型名称" placeholder="例如 gpt-4o-mini" value={translation.model} onChange={(event) => updateTranslation("model", event.target.value)} /></label>
                </> : (
                  <div className="settings-autofill">
                    <span>{findAiProviderPreset(translation.provider).hint}</span>
                    <code>{translation.apiBaseUrl || "—"} · {translation.model || "—"}</code>
                  </div>
                )}
                <label className="settings-field">API Key<Input aria-label="API Key" placeholder="输入 API Key" type="password" value={translation.apiKey} onChange={(event) => updateTranslation("apiKey", event.target.value)} /></label>
                <div className="settings-form-actions">
                  <Button variant="primary" className="settings-primary-button" onClick={saveTranslation} type="button">保存配置</Button>
                  <Button variant="secondary" className="settings-secondary-button" loading={testing} onClick={() => void runConnectionTest()} type="button">{testing ? "测试中…" : "测试连接"}</Button>
                  {saved && <span className="settings-saved"><Check size={14} />配置已保存</span>}
                  {testResult && <span className={testResult.ok ? "settings-test-result ok" : "settings-test-result failed"} role="status">{testResult.ok ? <Check size={14} /> : <X size={14} />}{testResult.message}</span>}
                </div>
              </Card>
            </SettingsSection>
          )}

          {section === "about" && (
            <SettingsSection title="关于">
              <div className="about-brand"><BrandLogo /><div><strong>LanDict</strong><span>一个安静、专注的英语学习工具</span></div></div>
              <div className="settings-row"><div><strong>版本</strong><span>当前应用版本</span></div><span className="settings-value">{appVersion}</span></div>
              <div className="settings-row"><div><strong>词库解释</strong><span>联网优先查询有道，离线或查询失败时使用内置词库</span></div><span className="settings-value">有道 / 牛津词典</span></div>
              {/* CC-CEDICT 的 CC BY-SA 4.0 要求署名，这一行是署名位置，改动前请看 data/cedict/CC-CEDICT-LICENSE.txt。 */}
              <div className="settings-row"><div><strong>词典数据</strong><span>释义与例句来自牛津高阶双解；中文反查来自 CC-CEDICT（CC BY-SA 4.0）；ECDICT 兜底词库为 MIT 许可；美式音频来自 Merriam-Webster</span></div><span className="settings-value">4 个来源</span></div>
            </SettingsSection>
          )}
        </div>
      </div>
    </section>
  );
}

function SettingsSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <div className="settings-section"><PageHeader title={title}>{description && <p id="theme-description">{description}</p>}</PageHeader><div className="settings-section-body">{children}</div></div>;
}
