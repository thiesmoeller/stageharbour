import { parseSnapshot, SNAPSHOT_SCHEMA_VERSION, type LocalSnapshot } from './snapshot.js';

const DEFAULT_FILENAME = 'beispiel-theatergruppe.stageharbour.json';
const FILE_ACCEPT: Record<string, string[]> = {
  'application/json': ['.json', '.stageharbour.json'],
};
const NEWER_VERSION_MESSAGE =
  'Diese Datei stammt aus einer neueren Version und kann nicht geladen werden.';

type FilePickerAcceptType = {
  description?: string;
  accept: Record<string, string | string[]>;
};

type SaveFilePickerOptions = {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
};

type OpenFilePickerOptions = {
  multiple?: boolean;
  types?: FilePickerAcceptType[];
};

type FileSystemPermissionMode = 'read' | 'readwrite';
type PermissionResult = 'granted' | 'denied' | 'prompt';

type FileSystemHandleWithPermission = FileSystemFileHandle & {
  queryPermission?(descriptor?: { mode?: FileSystemPermissionMode }): Promise<PermissionResult>;
  requestPermission?(descriptor?: { mode?: FileSystemPermissionMode }): Promise<PermissionResult>;
};

type WindowWithFilePicker = Window & {
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<[FileSystemFileHandle, ...FileSystemFileHandle[]]>;
};

function filePickerWindow(): WindowWithFilePicker {
  return window as WindowWithFilePicker;
}

async function hasReadWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const withPerm = handle as FileSystemHandleWithPermission;
  const descriptor = { mode: 'readwrite' as const };
  try {
    if (withPerm.queryPermission) {
      const current = await withPerm.queryPermission(descriptor);
      if (current === 'granted') return true;
    }
    if (withPerm.requestPermission) {
      return (await withPerm.requestPermission(descriptor)) === 'granted';
    }
  } catch {
    return false;
  }
  return false;
}

async function writeJsonToHandle(handle: FileSystemFileHandle, json: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(json);
  await writable.close();
}

function downloadJsonFallback(json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = DEFAULT_FILENAME;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function saveWorkspaceToDisk(
  snapshot: LocalSnapshot,
  existingHandle?: FileSystemFileHandle | null,
): Promise<FileSystemFileHandle | null> {
  const json = JSON.stringify(snapshot, null, 2);
  const win = filePickerWindow();

  if (typeof win.showSaveFilePicker === 'function') {
    if (existingHandle) {
      try {
        if (await hasReadWritePermission(existingHandle)) {
          await writeJsonToHandle(existingHandle, json);
          return existingHandle;
        }
      } catch {
        // Fall through to the save picker.
      }
    }

    const handle = await win.showSaveFilePicker({
      suggestedName: DEFAULT_FILENAME,
      types: [{ description: 'StageHarbour Workspace', accept: FILE_ACCEPT }],
    });
    await writeJsonToHandle(handle, json);
    return handle;
  }

  downloadJsonFallback(json);
  return null;
}

function assertCompatibleSchemaVersion(data: unknown): void {
  if (!data || typeof data !== 'object' || !('schemaVersion' in data)) {
    throw new Error(NEWER_VERSION_MESSAGE);
  }
  const version = (data as { schemaVersion: unknown }).schemaVersion;
  if (version !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(NEWER_VERSION_MESSAGE);
  }
}

function parseWorkspaceFileText(text: string): LocalSnapshot {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.');
  }
  assertCompatibleSchemaVersion(data);
  return parseSnapshot(data);
}

function pickFileWithInput(): Promise<File> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.stageharbour.json,application/json';
    let settled = false;

    const finish = (result: File | null, error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new DOMException('The user aborted a request.', 'AbortError'));
    };

    input.addEventListener('change', () => {
      finish(input.files?.[0] ?? null);
    });

    window.addEventListener(
      'focus',
      () => {
        window.setTimeout(() => {
          if (!settled) finish(null);
        }, 400);
      },
      { once: true },
    );

    input.click();
  });
}

export async function loadWorkspaceFromDisk(): Promise<LocalSnapshot> {
  const win = filePickerWindow();

  if (typeof win.showOpenFilePicker === 'function') {
    const [handle] = await win.showOpenFilePicker({
      multiple: false,
      types: [{ description: 'StageHarbour Workspace', accept: FILE_ACCEPT }],
    });
    const file = await handle.getFile();
    return parseWorkspaceFileText(await file.text());
  }

  const file = await pickFileWithInput();
  return parseWorkspaceFileText(await file.text());
}

/** Alias for UI wiring: open a picker and return a validated snapshot. */
export async function pickAndLoadWorkspace(): Promise<LocalSnapshot> {
  return loadWorkspaceFromDisk();
}
