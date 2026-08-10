export interface SystemLocation {
  name: string;
  path: string;
  kind: 'home' | 'common' | 'drive';
}

export interface SystemRoots {
  home: string;
  common: SystemLocation[];
  drives: SystemLocation[];
}

export function normalizeSystemPath(path: string): string {
  const trimmed = path.trim().replace(/^"|"$/g, '');
  if (/^[a-zA-Z]:[\\/]?$/.test(trimmed)) return `${trimmed.slice(0, 2)}\\`;
  if (trimmed === '/') return '/';
  return trimmed.replace(/[\\/]+$/, '');
}

export function joinSystemPath(parent: string, child: string): string {
  const normalized = normalizeSystemPath(parent);
  const separator = /^[a-zA-Z]:\\/.test(normalized) || normalized.includes('\\') ? '\\' : '/';
  if (normalized === '/') return `/${child}`;
  if (/^[a-zA-Z]:\\$/.test(normalized)) return `${normalized}${child}`;
  return `${normalized}${separator}${child}`;
}

export function parentSystemPath(path: string): string {
  const normalized = normalizeSystemPath(path);
  if (normalized === '/' || /^[a-zA-Z]:\\$/.test(normalized)) return normalized;
  const windows = /^[a-zA-Z]:/.test(normalized) || normalized.includes('\\');
  const separator = windows ? '\\' : '/';
  const last = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (last < 0) return normalized;
  const parent = normalized.slice(0, last);
  if (/^[a-zA-Z]:$/.test(parent)) return `${parent}\\`;
  return parent || separator;
}

export function systemBaseName(path: string): string {
  const normalized = normalizeSystemPath(path);
  if (/^[a-zA-Z]:\\$/.test(normalized)) return normalized.slice(0, 2);
  return normalized.split(/[\\/]/).filter(Boolean).pop() ?? normalized;
}
