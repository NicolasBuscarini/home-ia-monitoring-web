import { describe, expect, it } from 'vitest';
import { captureErrorKey, captureState } from '../src/features/operations/OperationsPanel';

describe('capture state labels', () => {
  it('maps disabled and unreachable instead of falling back to unknown', () => {
    expect(captureState('disabled')).toMatchObject({ key: 'capture.state.disabled' });
    expect(captureState('unreachable')).toMatchObject({ key: 'capture.state.unreachable' });
    expect(captureState('capturing')).toMatchObject({ key: 'capture.state.capturing' });
    expect(captureState(undefined)).toMatchObject({ key: 'operations.state.unknown' });
  });

  it('maps the monitoring camera statuses used by the readiness proxy', () => {
    expect(captureState('stale')).toMatchObject({ key: 'capture.state.stale', state: 'degraded' });
    expect(captureState('unavailable')).toMatchObject({
      key: 'capture.state.unavailable',
      state: 'failed',
    });
    expect(captureState('not_found')).toMatchObject({
      key: 'capture.state.notConfigured',
      state: 'failed',
    });
  });

  it('explains known capture reason codes instead of hiding them behind the generic error', () => {
    expect(captureErrorKey('segment_stale')).toBe('operations.error.segmentStale');
    expect(captureErrorKey('no_segments')).toBe('operations.error.noSegments');
    expect(captureErrorKey('camera_not_configured')).toBe('operations.error.notConfigured');
    expect(captureErrorKey('local_spool_unavailable')).toBe('operations.error.spoolUnavailable');
    expect(captureErrorKey('capture_segment_size_limit')).toBe('operations.error.segmentSizeLimit');
    expect(captureErrorKey('unknown_internal_detail')).toBeNull();
    expect(captureErrorKey(null)).toBeNull();
  });
});
