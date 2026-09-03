import { defineStore } from 'pinia';

export type ThemeName = 'light' | 'sepia' | 'gray' | 'black';
export type FontName = 'system' | 'serif' | 'sans';
export type ReadMode = 'paged' | 'scroll';

export interface ReaderSettings {
  theme: ThemeName;
  font: FontName;
  /** px */
  fontSize: number;
  lineHeight: number;
  /** px,max-width of content */
  width: number;
  mode: ReadMode;
}

const KEY = 'novel-reader-settings';

const defaults: ReaderSettings = {
  theme: 'sepia',
  font: 'system',
  fontSize: 18,
  lineHeight: 1.8,
  width: 680,
  mode: 'paged',
};

function load(): ReaderSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {}
  return { ...defaults };
}

export const useSettingsStore = defineStore('settings', {
  state: (): ReaderSettings => load(),
  getters: {
    fontFamily(state): string {
      switch (state.font) {
        case 'serif':
          return `"Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif`;
        case 'sans':
          return `"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
        default:
          return `-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`;
      }
    },
    themeBg(): string {
      return `var(--bg)`;
    },
  },
  actions: {
    save() {
      localStorage.setItem(KEY, JSON.stringify(this.$state));
    },
    set<K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) {
      (this as any)[key] = value;
      this.save();
    },
  },
});