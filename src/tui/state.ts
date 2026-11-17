import type {
  Environment,
  SecretStatus,
  SecretType,
  VaultMeta,
} from '../core/types.js';
import type { WorkspaceData } from './data.js';
import type { SecretFilter, SecretSortKey } from './format.js';

export type ViewId =
  | 'dashboard'
  | 'secrets'
  | 'projects'
  | 'passwords'
  | 'totp'
  | 'ssh'
  | 'certs'
  | 'tools'
  | 'settings';

export const VIEW_ORDER: ViewId[] = [
  'dashboard',
  'secrets',
  'projects',
  'passwords',
  'totp',
  'ssh',
  'certs',
  'tools',
  'settings',
];

export const VIEW_META: Record<ViewId, { label: string; tag: string; hint: string }> = {
  dashboard: { label: 'Dashboard', tag: 'DB', hint: 'Health, activity and attention items' },
  secrets: { label: 'Secrets', tag: 'SE', hint: 'Developer secrets, versions and rotation' },
  projects: { label: 'Projects', tag: 'PR', hint: 'Group and filter your secrets' },
  passwords: { label: 'Passwords', tag: 'PW', hint: 'Website logins and credentials' },
  totp: { label: 'TOTP', tag: 'OT', hint: 'Two-factor codes with live countdown' },
  ssh: { label: 'SSH Keys', tag: 'SH', hint: 'Key pairs, fingerprints and hosts' },
  certs: { label: 'Certificates', tag: 'CE', hint: 'X.509 certificates and private keys' },
  tools: { label: 'Tools', tag: 'TL', hint: 'Export, import and run commands' },
  settings: { label: 'Settings', tag: 'ST', hint: 'Identity, vault, agent and configuration' },
};

export type SecretDraft = {
  name: string;
  service: string;
  type: SecretType;
  environment: Environment;
  status: SecretStatus;
  value: string;
  notes: string;
  projectId: string | null;
  expiresOn: Date | null;
  lastRotated: Date | null;
};

/** Kept as an alias for readability at call sites. */
export type LockedSecretDraft = SecretDraft;

export interface ListState {
  query: string;
  searching: boolean;
  detail: boolean;
  selected: number;
  scroll: number;
}

export interface SecretsState extends ListState {
  filter: SecretFilter;
  sort: SecretSortKey;
  sortDirection: 'asc' | 'desc';
  focus: 'list' | 'detail';
  detailScroll: number;
}

export interface Toast {
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  until: number;
}

export interface AppState {
  screen: 'starting' | 'login' | 'main';
  view: ViewId;
  data: WorkspaceData;
  meta: VaultMeta | null;
  secrets: SecretsState;
  lists: Record<'passwords' | 'projects' | 'totp' | 'ssh' | 'certs', ListState>;
  revealedUntil: Record<string, number>;
  modal: ModalState | null;
  toast: Toast | null;
  busy: string | null;
  errors: string[];
  agent: {
    status: 'unknown' | 'locked' | 'unlocked';
    ttlRemainingMs: number;
    pid?: number;
    sampledAt: number;
  };
  unlocked: boolean;
  login: {
    email: string;
    password: string;
    focus: 0 | 1;
    emailCursor: number;
    passwordCursor: number;
    error: string | null;
    busy: boolean;
  };
  quitConfirm: boolean;
  toolIndex: number;
}

export type ModalState =
  | ConfirmModal
  | FormModal
  | PickerModal
  | ViewerModal
  | { kind: 'help' };

export interface ConfirmModal {
  kind: 'confirm';
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

export interface FormField {
  key: string;
  label: string;
  kind: 'text' | 'password' | 'textarea' | 'select' | 'boolean';
  value: string;
  cursor?: number;
  options?: Array<{ label: string; value: string; hint?: string }>;
  required?: boolean;
  placeholder?: string;
  help?: string;
  rows?: number;
  maxLength?: number;
}

export interface FormState {
  title: string;
  subtitle?: string;
  fields: FormField[];
  focus: number;
  scroll?: number;
  error: string | null;
  submitLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onSubmit: (values: Record<string, string>) => Promise<void> | void;
  onCancel?: () => void;
}

export interface FormModal {
  kind: 'form';
  form: FormState;
}

export interface PickerItem {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}

export interface PickerState {
  title: string;
  subtitle?: string;
  items: PickerItem[];
  selected: number;
  scroll: number;
  query: string;
  searchable: boolean;
  onSelect: (value: string) => void | Promise<void>;
}

export interface PickerModal {
  kind: 'pick';
  picker: PickerState;
}

export interface ViewerState {
  title: string;
  subtitle?: string;
  text: string;
  scroll: number;
  wrap: boolean;
  copyLabel?: string;
}

export interface ViewerModal {
  kind: 'viewer';
  viewer: ViewerState;
}

export function emptyList(): ListState {
  return { query: '', searching: false, detail: false, selected: 0, scroll: 0 };
}

export function initialState(data: WorkspaceData): AppState {
  return {
    screen: 'starting',
    view: 'dashboard',
    data,
    meta: data.meta,
    secrets: {
      query: '',
      searching: false,
      detail: false,
      selected: 0,
      scroll: 0,
      filter: {
        search: '',
        projectId: null,
        env: null,
        service: null,
        type: null,
        status: null,
      },
      sort: 'updated',
      sortDirection: 'desc',
      focus: 'list',
      detailScroll: 0,
    },
    lists: {
      passwords: emptyList(),
      projects: emptyList(),
      totp: emptyList(),
      ssh: emptyList(),
      certs: emptyList(),
    },
    revealedUntil: {},
    modal: null,
    toast: null,
    busy: null,
    errors: [],
    agent: { status: 'unknown', ttlRemainingMs: 0, sampledAt: Date.now() },
    unlocked: false,
    login: {
      email: '',
      password: '',
      focus: 0,
      emailCursor: 0,
      passwordCursor: 0,
      error: null,
      busy: false,
    },
    quitConfirm: false,
    toolIndex: 0,
  };
}
