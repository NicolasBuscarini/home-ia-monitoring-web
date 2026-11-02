import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

localStorage.setItem('garage-watch.locale.v1', 'pt-BR');

Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() });
Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, value: vi.fn() });
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
});
