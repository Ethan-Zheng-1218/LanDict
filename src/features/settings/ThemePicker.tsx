import { Check } from "@/components/ui/icon";
import type { AppTheme } from "./settingsStore";

const themes: { id: AppTheme; name: string; description: string }[] = [
  { id: "lime", name: "轻盈绿", description: "绿色点缀，轻盈通透" },
  { id: "black", name: "慕夜黑", description: "深蓝黑底，沉稳克制" },
  { id: "blue", name: "晴空蓝", description: "柔和渐变，清新现代" },
];

export function ThemePicker({ theme, onChange }: { theme: AppTheme; onChange: (theme: AppTheme) => void }) {
  return (
    <fieldset className="theme-picker" aria-describedby="theme-description">
      <legend className="sr-only">主题</legend>
      <div className="theme-options">
        {themes.map((item) => (
          <label className="theme-option" key={item.id}>
            <input type="radio" name="app-theme" aria-label={item.name} value={item.id} checked={theme === item.id} onChange={() => onChange(item.id)} />
            <span className="theme-option-body">
              <span className="theme-selected-mark" aria-hidden="true"><Check /></span>
              <span className="theme-preview" data-theme={item.id} aria-hidden="true">
                <span className="theme-preview-titlebar"><i /><i /><i /></span>
                <span className="theme-preview-layout">
                  <span className="theme-preview-sidebar"><i /><i /><i /><i /></span>
                  <span className="theme-preview-content"><b /><i /><i /><i /><span /></span>
                </span>
              </span>
              <strong>{item.name}</strong>
              <span className="theme-option-description">{item.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
