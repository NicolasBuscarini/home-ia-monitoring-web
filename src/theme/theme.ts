export const THEMES = [
  {
    id: 'forest',
    colorScheme: 'dark',
    preview: { background: '#101615', panel: '#18211f', accent: '#8ce0b4', text: '#f1f5f2' },
  },
  {
    id: 'graphite',
    colorScheme: 'dark',
    preview: { background: '#17191d', panel: '#22252a', accent: '#c4c9d2', text: '#f3f4f6' },
  },
  {
    id: 'ocean',
    colorScheme: 'dark',
    preview: { background: '#101a29', panel: '#18263a', accent: '#8ecbff', text: '#f0f6ff' },
  },
  {
    id: 'light',
    colorScheme: 'light',
    preview: { background: '#f3f5f2', panel: '#ffffff', accent: '#276b49', text: '#202822' },
  },
  {
    id: 'lavender',
    colorScheme: 'dark',
    preview: { background: '#191526', panel: '#252039', accent: '#c7a9ff', text: '#f5f0ff' },
  },
  {
    id: 'sunset',
    colorScheme: 'dark',
    preview: { background: '#251719', panel: '#382326', accent: '#ff9a86', text: '#fff2ee' },
  },
  {
    id: 'amber',
    colorScheme: 'dark',
    preview: { background: '#211b12', panel: '#33291a', accent: '#f4c56e', text: '#fff8e8' },
  },
  {
    id: 'rose',
    colorScheme: 'dark',
    preview: { background: '#23151e', panel: '#35202d', accent: '#ff9bc5', text: '#fff1f7' },
  },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME: ThemeId = 'forest';
const STORAGE_KEY = 'garage-watch.theme.v1';

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

export function readSavedTheme(): ThemeId {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return isThemeId(saved) ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(themeId: ThemeId): void {
  const theme = THEMES.find((candidate) => candidate.id === themeId) ?? THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.dataset.bsTheme = theme.colorScheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.preview.background);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme.id);
  } catch {
    // Tema ainda funciona nesta página quando armazenamento local está bloqueado.
  }
}
