import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler, StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LivePlayer } from '../src/features/monitoring/LivePlayer';
import { PLAYER_BUFFER_LIMITS, selectPlaybackMode } from '../src/features/monitoring/playback';
import { I18nProvider, useI18n } from '../src/i18n/i18n';

afterEach(() => cleanup());

const camera = {
  cameraId: 'garage-01',
  status: 'starting',
  streamEpoch: 'epoch-123456789',
  liveUrl: '/api/v1/live/garage-01/index.m3u8',
};

const capturingCamera = { ...camera, status: 'capturing' };

function LocaleSwitch() {
  const { locale, setLocale } = useI18n();
  return (
    <button
      type="button"
      onClick={() => {
        const nextLocale = locale === 'en-US' ? 'pt-BR' : 'en-US';
        setLocale(nextLocale);
      }}
    >
      switch-locale
    </button>
  );
}

describe('live player startup and bounded updates', () => {
  it('prefers working native HLS when declared and keeps Hls.js as fallback', () => {
    expect(selectPlaybackMode(true, true)).toBe('native');
    expect(selectPlaybackMode(false, true)).toBe('native');
    expect(selectPlaybackMode(false, false)).toBe('unsupported');
  });

  it('starts muted without native autoplay while keeping the HLS buffer window short', () => {
    render(
      <I18nProvider>
        <LivePlayer camera={camera} onStatusChange={() => {}} />
      </I18nProvider>,
    );

    const video = screen.getByLabelText('Vídeo ao vivo da câmera');
    expect(video).toHaveProperty('autoplay', false);
    expect(video).toHaveProperty('muted', true);
    expect(PLAYER_BUFFER_LIMITS).toEqual({
      maxBufferLength: 12,
      backBufferLength: 6,
      maxMaxBufferLength: 18,
      maxBufferSize: 48_000_000,
    });
  });

  it('retries HLS initialization when StrictMode replays the mount effect', async () => {
    render(
      <StrictMode>
        <I18nProvider>
          <LivePlayer camera={capturingCamera} onStatusChange={() => {}} />
        </I18nProvider>
      </StrictMode>,
    );

    const video = screen.getByLabelText('Vídeo ao vivo da câmera');
    await waitFor(() => expect(video.dataset.playerInitState).not.toBe('loading-hlsjs'));
    expect(video.dataset.hlsSupported).toBeDefined();
  });

  it('reinitializes the selected stream when the camera changes even if URL and epoch match', () => {
    const nextCamera = { ...capturingCamera, cameraId: 'side-entry' };
    const { rerender } = render(
      <I18nProvider>
        <LivePlayer camera={capturingCamera} onStatusChange={() => {}} />
      </I18nProvider>,
    );
    const video = screen.getByLabelText('Vídeo ao vivo da câmera');
    expect(video).toHaveAttribute('data-camera-id', 'garage-01');

    rerender(
      <I18nProvider>
        <LivePlayer camera={nextCamera} onStatusChange={() => {}} />
      </I18nProvider>,
    );

    expect(video).toHaveAttribute('data-camera-id', 'side-entry');
  });

  it('keeps Play disabled until native media is ready to play', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
    render(
      <I18nProvider>
        <LivePlayer camera={capturingCamera} onStatusChange={() => {}} />
      </I18nProvider>,
    );
    const video = screen.getByLabelText('Vídeo ao vivo da câmera');
    const playMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(video, 'play', { configurable: true, value: playMock });
    const play = screen.getByRole('button', { name: 'Reproduzir vídeo' });
    expect(play).toBeDisabled();

    fireEvent.canPlay(video);
    expect(play).toBeEnabled();
    expect(playMock).toHaveBeenCalledOnce();
  });

  it('shows a format-specific message when the browser rejects media playback', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <LivePlayer camera={capturingCamera} onStatusChange={() => {}} />
      </I18nProvider>,
    );
    const video = screen.getByLabelText('Vídeo ao vivo da câmera');
    Object.defineProperty(video, 'play', {
      configurable: true,
      value: vi.fn().mockRejectedValue(new DOMException('unsupported', 'NotSupportedError')),
    });
    fireEvent.canPlay(video);
    await user.click(screen.getByRole('button', { name: 'Reproduzir vídeo' }));

    expect(screen.getByText('Este navegador não oferece reprodução HLS/MSE compatível.')).toBeInTheDocument();
  });

  it('queues Go Live until the first seekable media range is available', async () => {
    render(
      <I18nProvider>
        <LivePlayer camera={capturingCamera} onStatusChange={() => {}} />
      </I18nProvider>,
    );

    const video = screen.getByLabelText('Vídeo ao vivo da câmera');
    Object.defineProperty(video, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ir ao ponto mais recente do vídeo' }));
    expect(screen.getByText(/Aguardando vídeo ao vivo/)).toBeInTheDocument();

    let currentTime = 0;
    Object.defineProperty(video, 'seekable', {
      configurable: true,
      value: { length: 1, start: () => 10, end: () => 30 },
    });
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
      },
    });
    fireEvent.progress(video);

    expect(currentTime).toBe(29.5);
  });

  it('does not rerender for time updates that do not change the visible seek position', () => {
    let commits = 0;
    const currentTime = 5;
    render(
      <I18nProvider>
        <Profiler id="player" onRender={() => commits++}>
          <LivePlayer camera={camera} onStatusChange={() => {}} />
        </Profiler>
      </I18nProvider>,
    );
    const video = screen.getByLabelText('Vídeo ao vivo da câmera');
    Object.defineProperty(video, 'seekable', {
      configurable: true,
      value: { length: 1, start: () => 0, end: () => 20 },
    });
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => currentTime,
    });

    fireEvent.timeUpdate(video);
    const commitsAfterFirstVisibleUpdate = commits;
    fireEvent.timeUpdate(video);

    expect(commitsAfterFirstVisibleUpdate).toBeGreaterThan(0);
    expect(commits).toBe(commitsAfterFirstVisibleUpdate);
  });

  it('retranslates the current player status and control groups when the locale changes', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <LivePlayer camera={camera} onStatusChange={() => {}} />
        <LocaleSwitch />
      </I18nProvider>,
    );

    expect(screen.getByText('Player ainda não iniciado')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Reprodução e busca' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'switch-locale' }));

    expect(screen.getByText('Player not started yet')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Playback and seeking' })).toBeInTheDocument();
    expect(
      screen.getByText('Live video starts muted. Use the player controls to enable audio or pause.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'switch-locale' }));
    expect(screen.getByText('Player ainda não iniciado')).toBeInTheDocument();
  });
});
