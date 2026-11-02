import type { TranslationKey } from '../../i18n/messages';

interface PermissionCopy {
  name: TranslationKey;
  description: TranslationKey;
}

/**
 * Local copy for the delegated permission catalog. The server remains the authority for keys and
 * delegability; these labels only make the catalog readable and translatable in the interface.
 */
const PERMISSION_COPY: Record<string, PermissionCopy> = {
  'camera.list': {
    name: 'permission.camera.list.name',
    description: 'permission.camera.list.description',
  },
  'live.video.view': {
    name: 'permission.live.video.view.name',
    description: 'permission.live.video.view.description',
  },
  'events.read': {
    name: 'permission.events.read.name',
    description: 'permission.events.read.description',
  },
  'clips.read': {
    name: 'permission.clips.read.name',
    description: 'permission.clips.read.description',
  },
  'clips.export': {
    name: 'permission.clips.export.name',
    description: 'permission.clips.export.description',
  },
  'clips.analysis.request': {
    name: 'permission.clips.analysis.request.name',
    description: 'permission.clips.analysis.request.description',
  },
  'clips.analysis.policy.manage': {
    name: 'permission.clips.analysis.policy.manage.name',
    description: 'permission.clips.analysis.policy.manage.description',
  },
};

export interface PermissionGroupDefinition {
  id: string;
  label: TranslationKey;
  keys: readonly string[];
}

export const PERMISSION_GROUPS: readonly PermissionGroupDefinition[] = [
  { id: 'camera', label: 'admin.profiles.group.camera', keys: ['camera.list'] },
  { id: 'live', label: 'admin.profiles.group.live', keys: ['live.video.view'] },
  { id: 'events', label: 'admin.profiles.group.events', keys: ['events.read'] },
  {
    id: 'clips',
    label: 'admin.profiles.group.clips',
    keys: ['clips.read', 'clips.export', 'clips.analysis.request', 'clips.analysis.policy.manage'],
  },
];

export function permissionName(key: string): TranslationKey | undefined {
  return PERMISSION_COPY[key]?.name;
}

export function permissionDescription(key: string): TranslationKey | undefined {
  return PERMISSION_COPY[key]?.description;
}
