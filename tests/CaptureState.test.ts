import { describe, expect, it } from 'vitest';
import { captureState } from '../src/features/operations/OperationsPanel';

describe('capture state labels', () => {
  it('maps disabled and unreachable instead of falling back to unknown', () => {
    expect(captureState('disabled')).toMatchObject({ key: 'capture.state.disabled' });
    expect(captureState('unreachable')).toMatchObject({ key: 'capture.state.unreachable' });
    expect(captureState('capturing')).toMatchObject({ key: 'capture.state.capturing' });
    expect(captureState(undefined)).toMatchObject({ key: 'operations.state.unknown' });
  });
});
