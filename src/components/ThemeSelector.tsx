import { useRef } from 'react';
import { useI18n } from '../i18n/i18n';
import type { TranslationKey } from '../i18n/messages';
import { THEMES, type ThemeId } from '../theme/theme';

interface ThemeSelectorProps {
  value: ThemeId;
  onChange: (theme: ThemeId) => void;
}

export function ThemeSelector({ value, onChange }: ThemeSelectorProps) {
  const { t } = useI18n();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selected = THEMES.find((theme) => theme.id === value) ?? THEMES[0];
  const selectedName = t(`theme.${selected.id}` as TranslationKey);

  return (
    <details className="theme-selector" ref={detailsRef}>
      <summary className="theme-trigger" aria-label={t('theme.current', { name: selectedName })}>
        <span className="theme-trigger-swatches" aria-hidden="true">
          <i style={{ backgroundColor: selected.preview.background }} />
          <i style={{ backgroundColor: selected.preview.accent }} />
          <i style={{ backgroundColor: selected.preview.panel }} />
        </span>
        <span className="theme-trigger-copy">
          <span className="theme-trigger-label">{t('theme.label')}</span>
          <strong>{selectedName}</strong>
        </span>
        <span className="theme-trigger-chevron" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <fieldset className="theme-menu">
        <legend className="visually-hidden">{t('theme.label')}</legend>
        {THEMES.map((theme) => {
          const name = t(`theme.${theme.id}` as TranslationKey);
          const selectedTheme = theme.id === value;
          return (
            <button
              key={theme.id}
              className={`theme-option${selectedTheme ? ' selected' : ''}`}
              type="button"
              aria-pressed={selectedTheme}
              aria-label={t('theme.selectOption', { name })}
              onClick={() => {
                onChange(theme.id);
                if (detailsRef.current) detailsRef.current.open = false;
              }}
            >
              <span className="theme-option-preview" aria-hidden="true">
                <span
                  className="theme-preview-card"
                  style={{ backgroundColor: theme.preview.background, borderColor: theme.preview.panel }}
                >
                  <i style={{ backgroundColor: theme.preview.panel }} />
                  <i style={{ backgroundColor: theme.preview.text }} />
                  <i style={{ backgroundColor: theme.preview.accent }} />
                </span>
                <span className="theme-color-dots">
                  {[theme.preview.background, theme.preview.panel, theme.preview.accent].map((color) => (
                    <i key={color} style={{ backgroundColor: color }} />
                  ))}
                </span>
              </span>
              <span className="theme-option-name">{name}</span>
              <span className="theme-option-check" aria-hidden="true">
                {selectedTheme ? '✓' : ''}
              </span>
            </button>
          );
        })}
      </fieldset>
    </details>
  );
}
