export type UserRole = 'Administrator' | 'Viewer' | 'User';

export interface AuthenticatedUser {
  username: string;
  role: UserRole;
  canMonitor: boolean;
}

export interface CameraStatus {
  cameraId: string;
  status: string;
  streamEpoch: string | null;
  liveUrl: string;
}

export interface CaptureSpoolStatus {
  status: 'available' | 'unavailable' | string;
  segments: number;
  segmentLimit: number;
}

export interface CaptureReadiness {
  adapter: string;
  adapterVersion: string;
  capabilities: string[];
  state: string;
  streamEpoch: string | null;
  gaps: number;
  segments: number;
  lastErrorCode: string | null;
  spool?: CaptureSpoolStatus;
}

export interface ReadinessResponse {
  status: 'ready' | 'degraded' | string;
  capture: CaptureReadiness;
}

export interface SystemProfile {
  serviceName: string;
  environment: string;
  applicationVersion: string;
}

export interface PresenceResponse {
  activeClients?: number;
  leaseSeconds?: number;
}
