export const PLAYER_BUFFER_LIMITS = {
  maxBufferLength: 12,
  backBufferLength: 6,
  maxMaxBufferLength: 18,
  maxBufferSize: 48_000_000,
} as const;

export function selectPlaybackMode(hlsJsSupported: boolean, nativeHlsSupported: boolean) {
  if (nativeHlsSupported) return 'native';
  if (hlsJsSupported) return 'hls.js';
  return 'unsupported';
}
