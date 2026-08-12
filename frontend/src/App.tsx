import {useEffect, useMemo, useRef, useState} from 'react';
import {Browser, Events} from '@wailsio/runtime';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AppConfig,
  CleanupService,
  CompressOptions,
  CompressPreview,
  ConfigService,
  COSService,
  ImageObject,
  ImageRef,
  OrphanImage,
  VaultService,
} from '../bindings/github.com/uniquejava/obsidian-cos-images';

const DEFAULT_COMPRESS: CompressOptions = {quality: 80, maxEdge: 2560};

type Tab = 'images' | 'orphans' | 'settings';
type SortBy = 'uploadTime' | 'size';

/** Keep in sync with build Info.plist / windows info.json. */
const APP_VERSION = '0.1.0';
const APP_AUTHOR = 'cyper';
const APP_GITHUB_URL = 'https://github.com/uniquejava/obsidian-cos-images';

const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS: {value: number; label: string}[] = [
  {value: 20, label: '20'},
  {value: 50, label: '50'},
  {value: 200, label: '200'},
  {value: 1000, label: '1000'},
  {value: 2000, label: '2000'},
  {value: 0, label: 'All'},
];

function applyPageSize<T>(rows: T[], pageSize: number): T[] {
  if (pageSize <= 0) return rows;
  return rows.slice(0, pageSize);
}

const TABS: {id: Tab; label: string}[] = [
  {id: 'images', label: 'Images'},
  {id: 'orphans', label: 'Orphans'},
  {id: 'settings', label: 'Settings'},
];

/** In-memory data-URL cache for the current session (disk cache lives in Go). */
const thumbMemory = new Map<string, string>();

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v >= 10 || i === 0 ? 1 : 2)} ${units[i]}`;
}

function formatTime(iso: string): string {
  if (!iso || iso.startsWith('0001-01-01')) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function shortPath(p: string): string {
  const parts = p.split('/');
  return parts.slice(-3).join('/');
}

/** Obsidian note title from a Markdown path (basename without .md). */
function noteTitleFromPath(p: string): string {
  const base = p.split('/').pop() ?? p;
  return base.replace(/\.md$/i, '');
}

function primaryNoteLabel(notes: string[] | null | undefined): {label: string; title: string} {
  if (!notes?.length) return {label: '—', title: ''};
  const titles = notes.map(noteTitleFromPath);
  if (titles.length === 1) return {label: titles[0], title: notes[0]};
  return {
    label: `${titles[0]} +${titles.length - 1}`,
    title: notes.map((n) => `${noteTitleFromPath(n)}\n${n}`).join('\n\n'),
  };
}

/** Case-insensitive substring match; space-separated tokens are AND'd. */
function matchesNoteQuery(
  notes: string[] | null | undefined,
  objectKey: string,
  query: string,
): boolean {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const haystacks = [objectKey.toLowerCase()];
  for (const n of notes ?? []) {
    haystacks.push(n.toLowerCase());
    haystacks.push(noteTitleFromPath(n).toLowerCase());
  }
  return tokens.every((t) => haystacks.some((h) => h.includes(t)));
}

function cosConfigIncomplete(cfg: AppConfig | null): boolean {
  if (!cfg) return true;
  return !(
    cfg.secretIdSet &&
    cfg.secretKeySet &&
    Boolean(cfg.cosBucket?.trim()) &&
    Boolean(cfg.cosRegion?.trim()) &&
    Boolean(cfg.cosBaseURL?.trim())
  );
}

type ToastKind = 'success' | 'error';
interface ToastState {
  kind: ToastKind;
  text: string;
  sticky: boolean;
}

function Toast({toast, onClose}: {toast: ToastState; onClose: () => void}) {
  return (
    <div
      className={`toast toast-${toast.kind}`}
      role="status"
      aria-live="polite"
      onClick={onClose}
      title="Dismiss"
    >
      <span className="toast-text">{toast.text}</span>
      <span className="toast-close" aria-hidden>
        ×
      </span>
    </div>
  );
}

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], {type: mime});
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}

function uploadYear(iso: string): number | null {
  if (!iso || iso.startsWith('0001-01-01')) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getFullYear();
}

function CachedThumb({keyName, size = 40}: {keyName: string; size?: number}) {
  const [src, setSrc] = useState<string | null>(() => thumbMemory.get(keyName) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = thumbMemory.get(keyName);
    if (cached) {
      setSrc(cached);
      return;
    }
    setFailed(false);
    COSService.GetThumbnail(keyName)
      .then((b64) => {
        if (cancelled || !b64) return;
        const dataURL = `data:image/jpeg;base64,${b64}`;
        thumbMemory.set(keyName, dataURL);
        setSrc(dataURL);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [keyName]);

  if (failed) {
    return (
      <div className="thumb-fallback" style={{width: size, height: size}}>
        —
      </div>
    );
  }
  if (!src) {
    return <div className="thumb-fallback" style={{width: size, height: size}} />;
  }
  return (
    <img
      className="thumb-img"
      src={src}
      alt=""
      width={size}
      height={size}
    />
  );
}

function App() {
  const [tab, setTab] = useState<Tab>('images');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configPath, setConfigPath] = useState('');
  const [vaultPathsText, setVaultPathsText] = useState('');
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [secretId, setSecretId] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [cosBucket, setCosBucket] = useState('');
  const [cosRegion, setCosRegion] = useState('');
  const [cosPrefix, setCosPrefix] = useState('obsidian/');
  const [cosBaseURL, setCosBaseURL] = useState('');
  const [images, setImages] = useState<ImageObject[]>([]);
  const [refs, setRefs] = useState<ImageRef[]>([]);
  const [orphans, setOrphans] = useState<OrphanImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [scanStatus, setScanStatus] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('uploadTime');
  const [minSizeKB, setMinSizeKB] = useState(0);
  const [yearFilter, setYearFilter] = useState(0);
  const [noteQuery, setNoteQuery] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [confirmDeleteCount, setConfirmDeleteCount] = useState(false);
  const [previewImage, setPreviewImage] = useState<ImageObject | null>(null);
  const [compressImage, setCompressImage] = useState<ImageObject | null>(null);
  const [noteReader, setNoteReader] = useState<{paths: string[]; active: string} | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [imagesPageSize, setImagesPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [orphansPageSize, setOrphansPageSize] = useState(DEFAULT_PAGE_SIZE);

  const refByKey = useMemo(() => {
    const m = new Map<string, ImageRef>();
    for (const r of refs) m.set(r.key, r);
    return m;
  }, [refs]);

  const pushToast = (kind: ToastKind, text: string, sticky = false) => {
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }
    setToast({kind, text, sticky});
    if (!sticky) {
      toastTimer.current = window.setTimeout(() => {
        setToast(null);
        toastTimer.current = null;
      }, 6000);
    }
  };

  const reportError = (e: unknown) => pushToast('error', String(e), true);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const refreshConfig = async () => {
    const cfg = await ConfigService.GetConfig();
    setConfig(cfg);
    setVaultPathsText((cfg.vaultPaths ?? []).join('\n'));
    setShowThumbnails(Boolean(cfg.showThumbnails));
    setSecretId(cfg.secretId ?? '');
    setSecretKey(''); // never echo stored key
    setCosBucket(cfg.cosBucket ?? '');
    setCosRegion(cfg.cosRegion ?? '');
    setCosPrefix(cfg.cosPrefix?.trim() ? cfg.cosPrefix : 'obsidian/');
    setCosBaseURL(cfg.cosBaseURL ?? '');
    try {
      const path = await ConfigService.ConfigFilePath();
      setConfigPath(path ?? '');
    } catch {
      setConfigPath('');
    }
    return cfg;
  };

  useEffect(() => {
    refreshConfig()
      .then((cfg) => {
        if (cosConfigIncomplete(cfg)) setTab('settings');
      })
      .catch((e: unknown) => reportError(e));
  }, []);

  useEffect(() => {
    const off = Events.On('vault:scan', (ev: {data?: unknown}) => {
      const raw = Array.isArray(ev?.data) ? ev.data[0] : ev?.data;
      const p = raw as {
        filesScanned?: number;
        refsFound?: number;
        currentPath?: string;
        done?: boolean;
      } | null;
      if (!p) return;
      if (p.done) {
        setScanStatus(`Scan done · ${p.filesScanned ?? 0} notes · ${p.refsFound ?? 0} keys`);
        return;
      }
      setScanStatus(
        `Scanning… ${p.filesScanned ?? 0} notes · ${p.refsFound ?? 0} keys` +
          (p.currentPath ? ` · ${shortPath(p.currentPath)}` : ''),
      );
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  const loadImagesAndRefs = async () => {
    setLoading(true);
    setScanStatus('Scanning vaults…');
    try {
      const [imgs, scanned] = await Promise.all([
        COSService.ListImages(),
        VaultService.ScanReferences().catch((e: unknown) => {
          reportError(e);
          return [] as ImageRef[];
        }),
      ]);
      setImages(imgs ?? []);
      setRefs(scanned ?? []);
      setSelectedKeys(new Set());
    } catch (e: unknown) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  };

  const loadOrphans = async () => {
    setLoading(true);
    try {
      const list = await CleanupService.ListOrphans();
      setOrphans(list ?? []);
      setSelectedKeys(new Set());
    } catch (e: unknown) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  };

  const openNoteReader = (notes: string[] | null | undefined) => {
    const paths = (notes ?? []).filter(Boolean);
    if (paths.length === 0) return;
    setNoteReader({paths, active: paths[0]});
  };

  const uploadYears = useMemo(() => {
    const years = new Set<number>();
    for (const img of images) {
      const y = uploadYear(img.uploadTime);
      if (y != null) years.add(y);
    }
    return [...years].sort((a, b) => b - a);
  }, [images]);

  const filteredImages = useMemo(() => {
    const minBytes = minSizeKB > 0 ? minSizeKB * 1024 : 0;
    let list = images.filter((img) => (img.size || 0) >= minBytes);
    if (yearFilter > 0) {
      list = list.filter((img) => uploadYear(img.uploadTime) === yearFilter);
    }
    if (noteQuery.trim()) {
      list = list.filter((img) =>
        matchesNoteQuery(refByKey.get(img.key)?.notes, img.key, noteQuery),
      );
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'size') return (b.size || 0) - (a.size || 0);
      return new Date(b.uploadTime).getTime() - new Date(a.uploadTime).getTime();
    });
  }, [images, minSizeKB, sortBy, yearFilter, noteQuery, refByKey]);

  const visibleImages = applyPageSize(filteredImages, imagesPageSize);
  const totalBytes = filteredImages.reduce((s, img) => s + (img.size || 0), 0);
  const orphanBytes = orphans.reduce((s, img) => s + (img.size || 0), 0);
  const visibleOrphans = applyPageSize(orphans, orphansPageSize);

  const previewList = tab === 'orphans' ? orphans : filteredImages;
  const previewIndex = previewImage
    ? previewList.findIndex((img) => img.key === previewImage.key)
    : -1;

  const stepPreview = (delta: number) => {
    if (previewIndex < 0) return;
    const next = previewIndex + delta;
    if (next < 0 || next >= previewList.length) return;
    setPreviewImage(previewList[next]);
  };

  const toggleKey = (key: string) => {
    setConfirmDeleteCount(false);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAllVisible = (keys: string[]) => {
    setConfirmDeleteCount(false);
    setSelectedKeys((prev) => {
      const allOn = keys.length > 0 && keys.every((k) => prev.has(k));
      const next = new Set(prev);
      if (allOn) {
        for (const k of keys) next.delete(k);
      } else {
        for (const k of keys) next.add(k);
      }
      return next;
    });
  };

  const deleteSelected = async (keys: string[]) => {
    if (keys.length === 0) return;
    setLoading(true);
    setConfirmDeleteCount(false);
    try {
      await COSService.DeleteImages(keys);
      setSelectedKeys(new Set());
      if (previewImage && keys.includes(previewImage.key)) {
        setPreviewImage(null);
      }
      await loadOrphans();
      pushToast('success', `Deleted ${keys.length} object(s).`);
    } catch (e: unknown) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  };

  const deletePreviewOrphan = async () => {
    if (!previewImage || tab !== 'orphans') return;
    const key = previewImage.key;
    const idx = orphans.findIndex((o) => o.key === key);
    setLoading(true);
    try {
      await COSService.DeleteImages([key]);
      const nextList = orphans.filter((o) => o.key !== key);
      setOrphans(nextList);
      setSelectedKeys((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      if (nextList.length === 0 || idx < 0) {
        setPreviewImage(null);
      } else if (idx >= nextList.length) {
        setPreviewImage(nextList[nextList.length - 1]);
      } else {
        setPreviewImage(nextList[idx]);
      }
      pushToast('success', 'Deleted 1 object.');
    } catch (e: unknown) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  };

  const exportOrphans = async (format: 'csv' | 'json') => {
    setLoading(true);
    try {
      const body = await CleanupService.ExportOrphans(format);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadText(
        `cos-orphans-${stamp}.${format}`,
        body ?? '',
        format === 'json' ? 'application/json' : 'text/csv',
      );
      pushToast('success', `Exported orphans as ${format.toUpperCase()}.`);
    } catch (e: unknown) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  };

  const saveVaultPaths = async () => {
    const paths = vaultPathsText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    setLoading(true);
    try {
      await ConfigService.SaveVaultPaths(paths);
      await refreshConfig();
      pushToast('success', 'Vault paths saved.');
    } catch (e: unknown) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  };

  const currentCOSSettings = () => ({
    secretId: secretId.trim(),
    secretKey: secretKey,
    cosBucket: cosBucket.trim(),
    cosRegion: cosRegion.trim(),
    cosPrefix: cosPrefix.trim() || 'obsidian/',
    cosBaseURL: cosBaseURL.trim(),
  });

  const saveCOSSettings = async () => {
    setLoading(true);
    try {
      await ConfigService.SaveCOSSettings(currentCOSSettings());
      setSecretKey('');
      pushToast('success', 'COS settings saved.');
      await refreshConfig();
    } catch (e: unknown) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  };

  const testCOSConnection = async () => {
    setLoading(true);
    try {
      const msg = await COSService.TestConnection(currentCOSSettings());
      pushToast('success', msg ?? 'Connection OK.');
    } catch (e: unknown) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  };

  const toggleThumbnails = async (enabled: boolean) => {
    setShowThumbnails(enabled);
    try {
      await ConfigService.SaveShowThumbnails(enabled);
      setConfig((c) => (c ? {...c, showThumbnails: enabled} : c));
      pushToast('success', enabled ? 'Thumbnails enabled.' : 'Thumbnails disabled.');
    } catch (e: unknown) {
      reportError(e);
      setShowThumbnails(!enabled);
    }
  };

  const clearThumbCache = async () => {
    setLoading(true);
    try {
      await COSService.ClearThumbnailCache();
      thumbMemory.clear();
      pushToast('success', 'Local thumbnail cache cleared.');
    } catch (e: unknown) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!previewImage && !noteReader && !aboutOpen && !compressImage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (compressImage) {
          setCompressImage(null);
          return;
        }
        if (aboutOpen) {
          setAboutOpen(false);
          return;
        }
        if (noteReader) {
          setNoteReader(null);
          return;
        }
        if (previewImage) setPreviewImage(null);
        return;
      }
      if (compressImage || aboutOpen || noteReader || !previewImage) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepPreview(-1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepPreview(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewImage, noteReader, aboutOpen, compressImage, previewIndex, previewList]);

  return (
    <div className="app no-drag">
      <aside className="sidebar">
        <div className="brand">
          Obsidian COS
          <small>{config?.cosPrefix ?? 'obsidian/'}</small>
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`nav-btn${tab === t.id ? ' active' : ''}`}
            onClick={() => {
              setTab(t.id);
              setConfirmDeleteCount(false);
              if (t.id !== 'images' && t.id !== 'orphans') {
                setPreviewImage(null);
                setNoteReader(null);
              }
            }}
          >
            {t.label}
          </button>
        ))}
        <div className="sidebar-footer">
          <div className="sidebar-meta">
            {refs.length} referenced keys
            {scanStatus ? (
              <>
                <br />
                {scanStatus}
              </>
            ) : null}
          </div>
          <button
            type="button"
            className="sidebar-about"
            onClick={() => setAboutOpen(true)}
            title="About this app"
          >
            About · v{APP_VERSION}
          </button>
        </div>
      </aside>

      <div className="main">
        {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

        {tab === 'images' && (
          <>
            <div className="toolbar">
              <button type="button" className="primary" onClick={loadImagesAndRefs} disabled={loading}>
                {loading ? 'Loading…' : 'Refresh'}
              </button>
              <label>
                Sort
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
                  <option value="uploadTime">Upload time</option>
                  <option value="size">Size</option>
                </select>
              </label>
              <label>
                Min KB
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={minSizeKB}
                  onChange={(e) => setMinSizeKB(Number(e.target.value) || 0)}
                  style={{width: 72}}
                />
              </label>
              <button
                type="button"
                className={minSizeKB === 500 ? 'primary' : undefined}
                title="Show images at least 500 KB (common without PicGo compress)"
                onClick={() => {
                  setMinSizeKB(500);
                  setSortBy('size');
                }}
              >
                ≥500 KB
              </button>
              <label>
                Year
                <select
                  value={yearFilter}
                  onChange={(e) => setYearFilter(Number(e.target.value) || 0)}
                >
                  <option value={0}>All</option>
                  {uploadYears.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
              <label className="toolbar-note-search">
                Note
                <input
                  type="search"
                  value={noteQuery}
                  onChange={(e) => setNoteQuery(e.target.value)}
                  placeholder="Title or keyword…"
                  title="Fuzzy match note title, path, or object key. Space-separated words are AND."
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              {noteQuery.trim() ? (
                <button type="button" onClick={() => setNoteQuery('')} title="Clear note filter">
                  Clear
                </button>
              ) : null}
              <label>
                Page size
                <select
                  value={imagesPageSize}
                  onChange={(e) => setImagesPageSize(Number(e.target.value))}
                >
                  {PAGE_SIZE_OPTIONS.map((o) => (
                    <option key={o.label} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <span className="toolbar-stat">
                Showing {visibleImages.length} / {filteredImages.length}
                {' · '}
                {formatBytes(totalBytes)} total filtered
                {images.length > 0 ? ` · ${images.length} loaded from COS` : ''}
                {images.length === 0 && !loading ? ' · click Refresh to load' : ''}
              </span>
            </div>
            <div className="content">
              <div className="panel-split">
                <ImageTable
                  rows={visibleImages}
                  refByKey={refByKey}
                  selectable={false}
                  selectedKeys={selectedKeys}
                  showThumbnails={false}
                  onToggle={toggleKey}
                  onOpenNote={openNoteReader}
                  onPreview={setPreviewImage}
                />
              </div>
            </div>
          </>
        )}

        {tab === 'orphans' && (
          <>
            <div className="toolbar">
              <button type="button" className="primary" onClick={loadOrphans} disabled={loading}>
                {loading ? 'Loading…' : 'Refresh orphans'}
              </button>
              <button type="button" disabled={loading} onClick={() => exportOrphans('csv')}>
                Export CSV
              </button>
              <button type="button" disabled={loading} onClick={() => exportOrphans('json')}>
                Export JSON
              </button>
              <label>
                Page size
                <select
                  value={orphansPageSize}
                  onChange={(e) => setOrphansPageSize(Number(e.target.value))}
                >
                  {PAGE_SIZE_OPTIONS.map((o) => (
                    <option key={o.label} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {!confirmDeleteCount ? (
                <button
                  type="button"
                  className="danger"
                  disabled={selectedKeys.size === 0 || loading}
                  onClick={() => setConfirmDeleteCount(true)}
                >
                  Delete ({selectedKeys.size})
                </button>
              ) : (
                <>
                  <span className="toolbar-stat">
                    Delete {selectedKeys.size} object(s)? This cannot be undone.
                  </span>
                  <button
                    type="button"
                    className="danger"
                    disabled={selectedKeys.size === 0 || loading}
                    onClick={() => void deleteSelected([...selectedKeys])}
                  >
                    {loading ? 'Deleting…' : 'Confirm delete'}
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setConfirmDeleteCount(false)}
                  >
                    Cancel
                  </button>
                </>
              )}
              <span className="toolbar-stat">
                Showing {visibleOrphans.length} / {orphans.length}
                {' · '}
                reclaimable {formatBytes(orphanBytes)}
              </span>
            </div>
            <div className="content">
              <div className="panel-split">
                <ImageTable
                  rows={visibleOrphans}
                  refByKey={refByKey}
                  selectable
                  selectedKeys={selectedKeys}
                  showThumbnails={false}
                  onToggle={toggleKey}
                  onToggleAll={toggleSelectAllVisible}
                  onOpenNote={openNoteReader}
                  onPreview={setPreviewImage}
                />
              </div>
            </div>
          </>
        )}

        {tab === 'settings' && (
          <div className="panel section settings-scroll">
            {cosConfigIncomplete(config) && (
              <div className="setup-banner">
                First-run setup: enter your Tencent COS credentials and bucket below, then add at
                least one Obsidian vault path. Optional <code>.env</code> is only for local
                development.
              </div>
            )}

            <h3>Tencent COS</h3>
            <p className="muted">
              Saved to the local config file (mode 0600). SecretKey is never shown after save —
              leave the field blank to keep the existing key. Optional <code>.env</code> fills
              empty fields for developers.
            </p>
            {configPath && (
              <p className="muted">
                Config file: <code>{configPath}</code>
              </p>
            )}
            <div className="settings-form">
              <label>
                SecretId
                <input
                  type="text"
                  autoComplete="off"
                  value={secretId}
                  onChange={(e) => setSecretId(e.target.value)}
                  placeholder="AKID…"
                />
              </label>
              <label>
                SecretKey
                <input
                  type="password"
                  autoComplete="new-password"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  placeholder={
                    config?.secretKeySet ? '•••••••• (leave blank to keep)' : 'Required'
                  }
                />
              </label>
              <label>
                Bucket
                <input
                  type="text"
                  value={cosBucket}
                  onChange={(e) => setCosBucket(e.target.value)}
                  placeholder="name-appid"
                />
              </label>
              <label>
                Region
                <input
                  type="text"
                  value={cosRegion}
                  onChange={(e) => setCosRegion(e.target.value)}
                  placeholder="ap-shanghai"
                />
              </label>
              <label>
                Object prefix
                <input
                  type="text"
                  value={cosPrefix}
                  onChange={(e) => setCosPrefix(e.target.value)}
                  placeholder="obsidian/"
                />
              </label>
              <label className="settings-span-2">
                Base URL
                <input
                  type="text"
                  value={cosBaseURL}
                  onChange={(e) => setCosBaseURL(e.target.value)}
                  placeholder="https://bucket.cos.region.myqcloud.com"
                />
              </label>
            </div>
            <div className="stack" style={{marginTop: 12}}>
              <button type="button" className="primary" onClick={saveCOSSettings} disabled={loading}>
                Save COS settings
              </button>
              <button type="button" onClick={testCOSConnection} disabled={loading}>
                {loading ? 'Working…' : 'Test connection'}
              </button>
            </div>

            <h3>Thumbnails</h3>
            <p className="muted">
              Default off. When enabled, 64px thumbs are fetched once (COS <code>imageMogr2</code>)
              and stored under the OS cache dir.
            </p>
            <label style={{display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12}}>
              <input
                type="checkbox"
                checked={showThumbnails}
                onChange={(e) => toggleThumbnails(e.target.checked)}
              />
              Show thumbnails
            </label>
            <button type="button" onClick={clearThumbCache} disabled={loading}>
              Clear local thumbnail cache
            </button>

            <h3>Vault paths</h3>
            <p className="muted">
              One Obsidian vault root per line (the folder that contains{' '}
              <code>.obsidian/</code>). Home, <code>/</code>, and similar broad
              paths are rejected so a scan cannot walk the whole disk.
            </p>
            {config?.vaultPathErrors && config.vaultPathErrors.length > 0 && (
              <pre className="error-box" style={{whiteSpace: 'pre-wrap'}}>
                {config.vaultPathErrors.join('\n')}
              </pre>
            )}
            <textarea
              value={vaultPathsText}
              onChange={(e) => setVaultPathsText(e.target.value)}
              rows={8}
              placeholder="/path/to/YourObsidianVault"
            />
            <div style={{marginTop: 12}}>
              <button type="button" className="primary" onClick={saveVaultPaths} disabled={loading}>
                Save vault paths
              </button>
            </div>
          </div>
        )}
      </div>

      {previewImage && (
        <ImageLightbox
          image={previewImage}
          index={previewIndex}
          total={previewList.length}
          onClose={() => setPreviewImage(null)}
          onPrev={() => stepPreview(-1)}
          onNext={() => stepPreview(1)}
          onDelete={tab === 'orphans' ? deletePreviewOrphan : undefined}
          onCompress={
            tab === 'images'
              ? () => {
                  setCompressImage(previewImage);
                }
              : undefined
          }
          deleting={loading}
        />
      )}
      {compressImage && (
        <CompressDialog
          image={compressImage}
          onClose={() => setCompressImage(null)}
          onReplaced={(updated) => {
            thumbMemory.delete(updated.key);
            setImages((prev) =>
              prev.map((img) => (img.key === updated.key ? {...img, ...updated} : img)),
            );
            setPreviewImage((cur) =>
              cur && cur.key === updated.key ? {...cur, ...updated} : cur,
            );
            setCompressImage(null);
            pushToast(
              'success',
              `Replaced ${updated.key} (${formatBytes(compressImage.size)} → ${formatBytes(updated.size)}). Same URL; CDN/Obsidian may cache briefly.`,
            );
          }}
          onError={reportError}
        />
      )}
      {noteReader && (
        <NoteReader
          notePaths={noteReader.paths}
          activePath={noteReader.active}
          onSelectPath={(path) => setNoteReader((cur) => (cur ? {...cur, active: path} : cur))}
          onClose={() => setNoteReader(null)}
        />
      )}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  );
}

function AboutDialog({onClose}: {onClose: () => void}) {
  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="About Obsidian COS Images"
      onClick={onClose}
    >
      <div className="about-card" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-bar">
          <div className="lightbox-meta">
            <strong>About</strong>
          </div>
          <div className="lightbox-actions">
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="about-body">
          <h2 className="about-title">Obsidian COS Images</h2>
          <p className="about-lead">
            Manage PicGo uploads on Tencent COS that are referenced by Obsidian Markdown notes.
          </p>
          <dl className="about-meta">
            <div>
              <dt>Version</dt>
              <dd>v{APP_VERSION}</dd>
            </div>
            <div>
              <dt>Author</dt>
              <dd>{APP_AUTHOR}</dd>
            </div>
          </dl>
          <button
            type="button"
            className="primary"
            onClick={() => {
              void Browser.OpenURL(APP_GITHUB_URL).catch(() => undefined);
            }}
          >
            Open GitHub
          </button>
          <p className="about-repo muted" title={APP_GITHUB_URL}>
            {APP_GITHUB_URL.replace(/^https:\/\//, '')}
          </p>
        </div>
      </div>
    </div>
  );
}

function NoteReader({
  notePaths,
  activePath,
  onSelectPath,
  onClose,
}: {
  notePaths: string[];
  activePath: string;
  onSelectPath: (path: string) => void;
  onClose: () => void;
}) {
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setBody('');
    VaultService.ReadNote(activePath)
      .then((text) => {
        if (!cancelled) setBody(text ?? '');
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activePath]);

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Markdown note reader"
      onClick={onClose}
    >
      <div className="lightbox-card note-reader-card" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-bar">
          <div className="lightbox-meta">
            <strong>{noteTitleFromPath(activePath)}</strong>
            <div className="muted" style={{marginTop: 2}} title={activePath}>
              {shortPath(activePath)}
            </div>
          </div>
          <div className="lightbox-actions">
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        {notePaths.length > 1 && (
          <div className="note-tabs">
            {notePaths.map((p) => (
              <button
                key={p}
                type="button"
                className={`note-tab${p === activePath ? ' active' : ''}`}
                title={p}
                onClick={() => onSelectPath(p)}
              >
                {noteTitleFromPath(p)}
              </button>
            ))}
          </div>
        )}
        <div className="note-reader-body">
          {loading && <p className="muted">Loading note…</p>}
          {!loading && error && <pre className="error-box" style={{margin: 0}}>{error}</pre>}
          {!loading && !error && (
            <article className="md-prose">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  img: ({src, alt}) => (
                    <img
                      src={src}
                      alt={alt ?? ''}
                      loading="lazy"
                      onClick={() => {
                        if (src) {
                          void Browser.OpenURL(src).catch(() => undefined);
                        }
                      }}
                    />
                  ),
                  a: ({href, children}) => (
                    <a
                      href={href}
                      onClick={(e) => {
                        e.preventDefault();
                        if (href) {
                          void Browser.OpenURL(href).catch(() => undefined);
                        }
                      }}
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {body}
              </ReactMarkdown>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}

function ImageLightbox({
  image,
  index,
  total,
  onClose,
  onPrev,
  onNext,
  onDelete,
  onCompress,
  deleting,
}: {
  image: ImageObject;
  index: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onDelete?: () => void | Promise<void>;
  onCompress?: () => void;
  deleting?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < total - 1;
  const positionLabel = index >= 0 && total > 0 ? `${index + 1} / ${total}` : '';

  useEffect(() => {
    setFailed(false);
    setConfirmDelete(false);
  }, [image.key, image.url]);

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onClick={onClose}
    >
      <div className="lightbox-card" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-bar">
          <div className="lightbox-meta">
            <code>{image.key}</code>
            <div className="muted" style={{marginTop: 2}}>
              {formatBytes(image.size)} · {formatTime(image.uploadTime)}
              {positionLabel ? ` · ${positionLabel}` : ''}
            </div>
          </div>
          <div className="lightbox-actions">
            <button
              type="button"
              disabled={deleting || !hasPrev}
              title="Previous (←)"
              onClick={(e) => {
                e.stopPropagation();
                onPrev();
              }}
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={deleting || !hasNext}
              title="Next (→)"
              onClick={(e) => {
                e.stopPropagation();
                onNext();
              }}
            >
              Next →
            </button>
            {onCompress && (
              <button
                type="button"
                className="primary"
                disabled={deleting}
                title="Preview a compressed version, then overwrite the same COS key"
                onClick={(e) => {
                  e.stopPropagation();
                  onCompress();
                }}
              >
                Compress…
              </button>
            )}
            {onDelete && !confirmDelete && (
              <button
                type="button"
                className="danger"
                disabled={deleting}
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(true);
                }}
              >
                Delete
              </button>
            )}
            {onDelete && confirmDelete && (
              <>
                <button
                  type="button"
                  className="danger"
                  disabled={deleting}
                  onClick={(e) => {
                    e.stopPropagation();
                    void onDelete();
                  }}
                >
                  {deleting ? 'Deleting…' : 'Confirm delete'}
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDelete(false);
                  }}
                >
                  Cancel
                </button>
              </>
            )}
            <button
              type="button"
              disabled={deleting}
              onClick={(e) => {
                e.stopPropagation();
                void Browser.OpenURL(image.url).catch((err: unknown) => {
                  window.alert(`Could not open URL:\n${String(err)}`);
                });
              }}
            >
              Open in browser
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              disabled={deleting}
            >
              Close
            </button>
          </div>
        </div>
        <div className="lightbox-body">
          {failed ? (
            <div className="lightbox-error">Failed to load image.</div>
          ) : (
            <img
              key={image.url}
              src={image.url}
              alt={image.key}
              onError={() => setFailed(true)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CompressDialog({
  image,
  onClose,
  onReplaced,
  onError,
}: {
  image: ImageObject;
  onClose: () => void;
  onReplaced: (updated: ImageObject) => void;
  onError: (e: unknown) => void;
}) {
  const [opts, setOpts] = useState<CompressOptions>({...DEFAULT_COMPRESS});
  const [preview, setPreview] = useState<CompressPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const isJPEG = /\.jpe?g$/i.test(image.key);

  const runPreview = async (nextOpts: CompressOptions) => {
    setBusy(true);
    setConfirmReplace(false);
    try {
      const result = await COSService.PreviewCompress(image.key, nextOpts);
      setPreview(result);
      setOpts({quality: result.quality, maxEdge: result.maxEdge});
    } catch (e: unknown) {
      setPreview(null);
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void runPreview({...DEFAULT_COMPRESS});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per image.key
  }, [image.key]);

  const doReplace = async () => {
    setBusy(true);
    try {
      const updated = await COSService.ReplaceWithCompressed(image.key, opts);
      onReplaced(updated);
    } catch (e: unknown) {
      onError(e);
      setConfirmReplace(false);
    } finally {
      setBusy(false);
    }
  };

  const saved =
    preview && preview.originalSize > 0
      ? Math.round((1 - preview.compressedSize / preview.originalSize) * 100)
      : 0;

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Compress and replace"
      onClick={onClose}
    >
      <div className="lightbox-card compress-card" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-bar">
          <div className="lightbox-meta">
            <strong>Compress &amp; replace</strong>
            <div className="muted" style={{marginTop: 2}}>
              Overwrites the same COS key (<code>{image.key}</code>) — Markdown URLs unchanged.
            </div>
          </div>
          <div className="lightbox-actions">
            <button type="button" onClick={onClose} disabled={busy}>
              Close
            </button>
          </div>
        </div>

        <div className="compress-controls">
          <label>
            {isJPEG ? 'JPEG quality' : 'PNG quality (pngquant)'}
            <input
              type="range"
              min={40}
              max={95}
              step={5}
              value={opts.quality}
              disabled={busy}
              onChange={(e) => setOpts((o) => ({...o, quality: Number(e.target.value)}))}
            />
            <span className="mono">{opts.quality}</span>
          </label>
          <label>
            Max long edge
            <select
              value={opts.maxEdge}
              disabled={busy}
              onChange={(e) => setOpts((o) => ({...o, maxEdge: Number(e.target.value)}))}
            >
              <option value={2560}>2560px</option>
              <option value={1920}>1920px</option>
              <option value={1280}>1280px</option>
              <option value={0}>No resize</option>
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runPreview(opts)}
          >
            {busy && !preview ? 'Working…' : 'Refresh preview'}
          </button>
          {preview?.smaller && !confirmReplace && (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => setConfirmReplace(true)}
            >
              Replace on COS
            </button>
          )}
          {preview?.smaller && confirmReplace && (
            <>
              <span className="toolbar-stat">Overwrite same key?</span>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void doReplace()}
              >
                {busy ? 'Uploading…' : 'Confirm replace'}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirmReplace(false)}>
                Cancel
              </button>
            </>
          )}
        </div>

        <div className="compress-stats muted" style={{padding: '6px 14px', fontSize: 12}}>
          {isJPEG
            ? 'JPEG is re-encoded at the quality above.'
            : 'PNG uses pngquant (TinyPNG-style palette). Requires `brew install pngquant` (optional: oxipng).'}
        </div>

        {preview && (
          <div className="compress-stats">
            {formatBytes(preview.originalSize)} → {formatBytes(preview.compressedSize)}
            {preview.smaller ? ` (−${saved}%)` : ' (not smaller)'}
            {preview.width > 0 ? ` · ${preview.width}×${preview.height}` : ''}
            {preview.format ? ` · ${preview.format}` : ''}
            {preview.message ? ` · ${preview.message}` : ''}
          </div>
        )}

        <div className="compress-compare">
          <div className="compress-pane">
            <div className="compress-pane-label">Original · {formatBytes(image.size)}</div>
            <img src={image.url} alt="Original" />
          </div>
          <div className="compress-pane">
            <div className="compress-pane-label">
              Compressed
              {preview ? ` · ${formatBytes(preview.compressedSize)}` : ''}
            </div>
            {preview?.compressedDataURL ? (
              <img src={preview.compressedDataURL} alt="Compressed preview" />
            ) : (
              <div className="lightbox-error">{busy ? 'Compressing…' : 'No preview yet.'}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ImageTable({
  rows,
  refByKey,
  selectable,
  selectedKeys,
  showThumbnails,
  onToggle,
  onToggleAll,
  onOpenNote,
  onPreview,
}: {
  rows: ImageObject[];
  refByKey: Map<string, ImageRef>;
  selectable: boolean;
  selectedKeys: Set<string>;
  showThumbnails: boolean;
  onToggle: (key: string) => void;
  onToggleAll?: (keys: string[]) => void;
  onOpenNote: (notes: string[] | null | undefined) => void;
  onPreview: (img: ImageObject) => void;
}) {
  const colSpan = (selectable ? 1 : 0) + (showThumbnails ? 1 : 0) + 6;
  const rowKeys = rows.map((r) => r.key);
  const allSelected = rowKeys.length > 0 && rowKeys.every((k) => selectedKeys.has(k));
  const someSelected = rowKeys.some((k) => selectedKeys.has(k));
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {selectable && (
              <th className="col-check" title="Select all visible">
                <input
                  type="checkbox"
                  aria-label="Select all visible"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allSelected;
                  }}
                  disabled={rows.length === 0 || !onToggleAll}
                  onChange={() => onToggleAll?.(rowKeys)}
                />
              </th>
            )}
            {showThumbnails && <th className="col-thumb">Thumb</th>}
            <th className="col-key">Object key</th>
            <th className="col-note">Note</th>
            <th className="col-size">Size</th>
            <th className="col-time">Uploaded</th>
            <th className="col-refs" title="How many Markdown notes reference this image">
              Refs
            </th>
            <th className="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="muted" style={{padding: 16}}>
                No rows yet. Click Refresh to load from COS / vaults.
              </td>
            </tr>
          )}
          {rows.map((img) => {
            const notes = refByKey.get(img.key)?.notes ?? undefined;
            const noteCount = notes?.length ?? 0;
            const note = primaryNoteLabel(notes);
            return (
              <tr key={img.key}>
                {selectable && (
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(img.key)}
                      onChange={() => onToggle(img.key)}
                    />
                  </td>
                )}
                {showThumbnails && (
                  <td>
                    <button
                      type="button"
                      className="action-btn"
                      title="Preview image"
                      onClick={() => onPreview(img)}
                      style={{padding: 2, lineHeight: 0}}
                    >
                      <CachedThumb keyName={img.key} />
                    </button>
                  </td>
                )}
                <td className="mono key-cell" title={img.key}>
                  {img.key}
                </td>
                <td>
                  {noteCount === 0 ? (
                    <div className="note-title unused">—</div>
                  ) : (
                    <button
                      type="button"
                      className="note-title-btn"
                      title={note.title || 'Open note'}
                      onClick={() => onOpenNote(notes)}
                    >
                      {note.label}
                    </button>
                  )}
                </td>
                <td style={{whiteSpace: 'nowrap'}} title={`${img.size} bytes`}>
                  {formatBytes(img.size)}
                </td>
                <td style={{whiteSpace: 'nowrap'}}>{formatTime(img.uploadTime)}</td>
                <td>{noteCount}</td>
                <td>
                  <div className="url-actions">
                    <button
                      type="button"
                      className="action-btn"
                      title="Preview image in this app"
                      onClick={() => onPreview(img)}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      className="action-btn"
                      title={img.url}
                      onClick={() => {
                        void Browser.OpenURL(img.url).catch((e: unknown) => {
                          window.alert(`Could not open URL:\n${String(e)}`);
                        });
                      }}
                    >
                      Browser
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default App;
