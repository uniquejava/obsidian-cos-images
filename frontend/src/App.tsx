import {useEffect, useMemo, useRef, useState} from 'react';
import {Browser, Events} from '@wailsio/runtime';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AppConfig,
  BrowseListing,
  CleanupService,
  CompressOptions,
  CompressPreview,
  ConfigService,
  COSBucketInfo,
  COSService,
  ImageObject,
  ImageRef,
  OrphanImage,
  VaultService,
} from '../bindings/github.com/uniquejava/obsidian-cos-images';

const DEFAULT_COMPRESS: CompressOptions = {quality: 80, maxEdge: 2560};

/** Sidebar views: two workspaces (Obsidian / COS) + global Settings. */
type View = 'obsidian-images' | 'obsidian-orphans' | 'cos-browse' | 'settings';
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

function isObsidianView(view: View): boolean {
  return view === 'obsidian-images' || view === 'obsidian-orphans';
}

function isCosView(view: View): boolean {
  return view === 'cos-browse';
}

function defaultCosBaseURL(bucket: string, region: string): string {
  const b = bucket.trim();
  const r = region.trim();
  if (!b || !r) return '';
  return `https://${b}.cos.${r}.myqcloud.com`;
}

function normalizeBrowsePrefix(prefix: string): string {
  let p = prefix.trim().replace(/^\/+/, '');
  if (!p) return '';
  if (!p.endsWith('/')) p += '/';
  return p;
}

function breadcrumbSegments(prefix: string): {label: string; prefix: string}[] {
  const parts = prefix.replace(/\/$/, '').split('/').filter(Boolean);
  const segs = [{label: 'root', prefix: ''}];
  let acc = '';
  for (const part of parts) {
    acc += `${part}/`;
    segs.push({label: part, prefix: acc});
  }
  return segs;
}

function folderLeafName(folderPrefix: string, currentPrefix: string): string {
  const rest = folderPrefix.startsWith(currentPrefix)
    ? folderPrefix.slice(currentPrefix.length)
    : folderPrefix;
  return rest.replace(/\/$/, '') || folderPrefix;
}

const IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.ico',
  '.heic',
  '.avif',
  '.tif',
  '.tiff',
]);

function objectExt(key: string): string {
  const base = key.split('/').pop() || key;
  const i = base.lastIndexOf('.');
  if (i < 0) return '';
  return base.slice(i).toLowerCase();
}

function isImageObjectKey(key: string): boolean {
  return IMAGE_EXTS.has(objectExt(key));
}

function objectLeafName(key: string): string {
  return key.split('/').pop() || key;
}

type BrowseViewMode = 'list' | 'grid';

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

function browseConfigIncomplete(cfg: AppConfig | null): boolean {
  if (!cfg) return true;
  return !(
    Boolean(cfg.browseCosBucket?.trim()) &&
    Boolean(cfg.browseCosRegion?.trim()) &&
    Boolean(cfg.browseCosBaseURL?.trim())
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

function CachedThumb({
  keyName,
  size = 40,
  browse = false,
}: {
  keyName: string;
  size?: number;
  browse?: boolean;
}) {
  const cacheKey = browse ? `browse:${keyName}` : keyName;
  const [src, setSrc] = useState<string | null>(() => thumbMemory.get(cacheKey) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = thumbMemory.get(cacheKey);
    if (cached) {
      setSrc(cached);
      return;
    }
    setFailed(false);
    const fetchThumb = browse ? COSService.BrowseGetThumbnail : COSService.GetThumbnail;
    fetchThumb(keyName)
      .then((b64) => {
        if (cancelled || !b64) return;
        const dataURL = `data:image/jpeg;base64,${b64}`;
        thumbMemory.set(cacheKey, dataURL);
        setSrc(dataURL);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [keyName, browse, cacheKey]);

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
  const [view, setView] = useState<View>('obsidian-images');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configPath, setConfigPath] = useState('');
  const [vaultPathsText, setVaultPathsText] = useState('');
  const [secretId, setSecretId] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [cosBucket, setCosBucket] = useState('');
  const [cosRegion, setCosRegion] = useState('');
  const [cosPrefix, setCosPrefix] = useState('obsidian/');
  const [cosBaseURL, setCosBaseURL] = useState('');
  const [browseBucket, setBrowseBucket] = useState('');
  const [browseRegion, setBrowseRegion] = useState('');
  const [browseBaseURL, setBrowseBaseURL] = useState('');
  const [images, setImages] = useState<ImageObject[]>([]);
  const [refs, setRefs] = useState<ImageRef[]>([]);
  const [orphans, setOrphans] = useState<OrphanImage[]>([]);
  const [browseListing, setBrowseListing] = useState<BrowseListing | null>(null);
  const [browsePrefix, setBrowsePrefix] = useState('');
  const [browsePrefixDraft, setBrowsePrefixDraft] = useState('');
  const [browseViewMode, setBrowseViewMode] = useState<BrowseViewMode>('list');
  const [bucketOptions, setBucketOptions] = useState<COSBucketInfo[]>([]);
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
    setSecretId(cfg.secretId ?? '');
    setSecretKey(''); // never echo stored key
    setCosBucket(cfg.cosBucket ?? '');
    setCosRegion(cfg.cosRegion ?? '');
    setCosPrefix(cfg.cosPrefix?.trim() ? cfg.cosPrefix : 'obsidian/');
    setCosBaseURL(cfg.cosBaseURL ?? '');
    setBrowseBucket(cfg.browseCosBucket ?? '');
    setBrowseRegion(cfg.browseCosRegion ?? '');
    setBrowseBaseURL(cfg.browseCosBaseURL ?? '');
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
        if (cosConfigIncomplete(cfg)) setView('settings');
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

  const loadBrowse = async (prefix: string) => {
    const next = normalizeBrowsePrefix(prefix);
    setLoading(true);
    try {
      const listing = await COSService.Browse(next);
      setBrowseListing(listing);
      setBrowsePrefix(listing?.prefix ?? next);
      setBrowsePrefixDraft(listing?.prefix ?? next);
      setSelectedKeys(new Set());
    } catch (e: unknown) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  };

  const loadBucketOptions = async () => {
    setLoading(true);
    try {
      const list = await COSService.ListBuckets();
      setBucketOptions(list ?? []);
      pushToast(
        'success',
        list?.length ? `Loaded ${list.length} bucket(s).` : 'No buckets returned for this account.',
      );
    } catch (e: unknown) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  };

  const applyBucketOption = (name: string) => {
    const hit = bucketOptions.find((b) => b.name === name);
    if (!hit) return;
    setBrowseBucket(hit.name);
    if (hit.region?.trim()) {
      setBrowseRegion(hit.region.trim());
      setBrowseBaseURL(defaultCosBaseURL(hit.name, hit.region.trim()));
    } else if (browseRegion.trim()) {
      setBrowseBaseURL(defaultCosBaseURL(hit.name, browseRegion));
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
  const browseFolders = browseListing?.folders ?? [];
  const browseObjects = browseListing?.objects ?? [];
  const browseImages = browseObjects.filter((o) => isImageObjectKey(o.key));
  const browseBytes = browseObjects.reduce((s, obj) => s + (obj.size || 0), 0);

  const previewList =
    view === 'obsidian-orphans'
      ? orphans
      : view === 'cos-browse'
        ? browseImages
        : filteredImages;
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
    if (!previewImage || view !== 'obsidian-orphans') return;
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

  const currentBrowseCOSSettings = () => ({
    cosBucket: browseBucket.trim(),
    cosRegion: browseRegion.trim(),
    cosBaseURL: browseBaseURL.trim(),
  });

  const saveCOSSettings = async () => {
    setLoading(true);
    try {
      await ConfigService.SaveCOSSettings(currentCOSSettings());
      setSecretKey('');
      pushToast('success', 'Vault COS settings saved.');
      await refreshConfig();
    } catch (e: unknown) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  };

  const saveBrowseCOSSettings = async () => {
    setLoading(true);
    try {
      await ConfigService.SaveBrowseCOSSettings(currentBrowseCOSSettings());
      setBrowseListing(null);
      pushToast('success', 'Browse COS settings saved.');
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

  const testBrowseCOSConnection = async () => {
    setLoading(true);
    try {
      const msg = await COSService.TestBrowseConnection(currentBrowseCOSSettings());
      pushToast('success', msg ?? 'Browse connection OK.');
    } catch (e: unknown) {
      reportError(e);
    } finally {
      setLoading(false);
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

  const goToView = (next: View) => {
    setView(next);
    setConfirmDeleteCount(false);
    if (next === 'settings') {
      setPreviewImage(null);
      setNoteReader(null);
      return;
    }
    if (next === 'cos-browse' && !browseListing && !loading) {
      void loadBrowse(browsePrefix);
    }
  };

  return (
    <div className="app no-drag">
      <aside className="sidebar">
        <div className="brand">
          Obsidian COS
          <small>
            {isCosView(view)
              ? config?.browseCosBucket?.trim() || 'Browse COS'
              : config?.cosPrefix ?? 'obsidian/'}
          </small>
        </div>

        <div className={`nav-section${isObsidianView(view) ? ' active-section' : ''}`}>
          <button
            type="button"
            className="nav-section-title"
            onClick={() => goToView('obsidian-images')}
          >
            Obsidian
          </button>
          <button
            type="button"
            className={`nav-btn nav-sub${view === 'obsidian-images' ? ' active' : ''}`}
            onClick={() => goToView('obsidian-images')}
          >
            Images
          </button>
          <button
            type="button"
            className={`nav-btn nav-sub${view === 'obsidian-orphans' ? ' active' : ''}`}
            onClick={() => goToView('obsidian-orphans')}
          >
            Orphans
          </button>
        </div>

        <div className={`nav-section${isCosView(view) ? ' active-section' : ''}`}>
          <button
            type="button"
            className="nav-section-title"
            onClick={() => goToView('cos-browse')}
          >
            COS
          </button>
          <button
            type="button"
            className={`nav-btn nav-sub${view === 'cos-browse' ? ' active' : ''}`}
            onClick={() => goToView('cos-browse')}
          >
            Browse
          </button>
        </div>

        <div className="sidebar-footer">
          <button
            type="button"
            className={`nav-btn${view === 'settings' ? ' active' : ''}`}
            onClick={() => goToView('settings')}
          >
            Settings
          </button>
          <div className="sidebar-meta">
            {isObsidianView(view) ? (
              <>
                {refs.length} referenced keys
                {scanStatus ? (
                  <>
                    <br />
                    {scanStatus}
                  </>
                ) : null}
              </>
            ) : isCosView(view) ? (
              <>
                {config?.browseCosBucket?.trim()
                  ? `Browse · ${config.browseCosBucket}`
                  : 'Browse COS not configured'}
                {config?.browseCosRegion?.trim() ? (
                  <>
                    <br />
                    {config.browseCosRegion}
                  </>
                ) : null}
              </>
            ) : (
              'Vault + Browse COS configs'
            )}
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

        {view === 'obsidian-images' && (
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
                  onToggle={toggleKey}
                  onOpenNote={openNoteReader}
                  onPreview={setPreviewImage}
                />
              </div>
            </div>
          </>
        )}

        {view === 'cos-browse' && (
          <>
            <div className="toolbar">
              <button
                type="button"
                className="primary"
                onClick={() => void loadBrowse(browsePrefix)}
                disabled={loading}
              >
                {loading ? 'Loading…' : 'Refresh'}
              </button>
              <label className="toolbar-note-search" style={{minWidth: 280}}>
                Path
                <input
                  type="text"
                  value={browsePrefixDraft}
                  onChange={(e) => setBrowsePrefixDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void loadBrowse(browsePrefixDraft);
                    }
                  }}
                  placeholder="static/img/shop/app/  (empty = bucket root)"
                  title="Deep object prefix. Enter or Go to open that folder."
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button
                type="button"
                disabled={loading}
                onClick={() => void loadBrowse(browsePrefixDraft)}
              >
                Go
              </button>
              <div className="browse-view-toggle" role="group" aria-label="Browse view mode">
                <button
                  type="button"
                  className={browseViewMode === 'list' ? 'active' : ''}
                  disabled={loading}
                  onClick={() => setBrowseViewMode('list')}
                  title="List view"
                >
                  List
                </button>
                <button
                  type="button"
                  className={browseViewMode === 'grid' ? 'active' : ''}
                  disabled={loading}
                  onClick={() => setBrowseViewMode('grid')}
                  title="Thumbnail grid (cached locally)"
                >
                  Thumbnails
                </button>
              </div>
              <span className="toolbar-stat">
                {config?.browseCosBucket ? (
                  <>
                    {config.browseCosBucket}
                    {config.browseCosRegion ? ` · ${config.browseCosRegion}` : ''}
                    {' · '}
                  </>
                ) : (
                  <>Browse COS not set · </>
                )}
                {browseFolders.length} folder(s) · {browseObjects.length} object(s)
                {browseImages.length > 0 ? ` · ${browseImages.length} image(s)` : ''}
                {browseObjects.length > 0 ? ` · ${formatBytes(browseBytes)}` : ''}
                {!browseListing && !loading ? ' · click Refresh' : ''}
              </span>
            </div>
            <div className="browse-crumbs">
              {breadcrumbSegments(browsePrefix).map((seg, i, arr) => (
                <span key={seg.prefix || 'root'} className="browse-crumb">
                  {i > 0 ? <span className="browse-crumb-sep">/</span> : null}
                  {i === arr.length - 1 ? (
                    <span className="browse-crumb-current">{seg.label}</span>
                  ) : (
                    <button
                      type="button"
                      className="browse-crumb-btn"
                      disabled={loading}
                      onClick={() => void loadBrowse(seg.prefix)}
                    >
                      {seg.label}
                    </button>
                  )}
                </span>
              ))}
            </div>
            <div className="content">
              <BrowsePane
                mode={browseViewMode}
                currentPrefix={browsePrefix}
                folders={browseFolders}
                objects={browseObjects}
                loading={loading}
                emptyHint="Empty folder. Open a subfolder or jump to a deeper path."
                onOpenFolder={(prefix) => void loadBrowse(prefix)}
                onPreview={setPreviewImage}
              />
            </div>
          </>
        )}

        {view === 'obsidian-orphans' && (
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
                  onToggle={toggleKey}
                  onToggleAll={toggleSelectAllVisible}
                  onOpenNote={openNoteReader}
                  onPreview={setPreviewImage}
                />
              </div>
            </div>
          </>
        )}

        {view === 'settings' && (
          <div className="panel section settings-scroll">
            {cosConfigIncomplete(config) && (
              <div className="setup-banner">
                First-run: set <strong>Vault COS</strong> (Obsidian bucket + secrets). Then optionally
                set <strong>Browse COS</strong> for a different preview bucket. Vault paths are only
                needed for Images / Orphans.
              </div>
            )}
            {configPath && (
              <p className="muted">
                Config file: <code>{configPath}</code>
              </p>
            )}

            <h3>Vault COS (Obsidian)</h3>
            <p className="muted">
              Used by Images / Orphans / vault URL matching. Leave SecretKey blank on save to keep
              the existing key. Shared SecretId/Key are also used when listing buckets for Browse.
            </p>
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
                  onChange={(e) => {
                    const region = e.target.value;
                    setCosRegion(region);
                    if (cosBucket.trim() && region.trim()) {
                      const auto = defaultCosBaseURL(cosBucket, region);
                      if (
                        !cosBaseURL.trim() ||
                        cosBaseURL.trim() === defaultCosBaseURL(cosBucket, cosRegion)
                      ) {
                        setCosBaseURL(auto);
                      }
                    }
                  }}
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
                Save Vault COS
              </button>
              <button type="button" onClick={() => void testCOSConnection()} disabled={loading}>
                {loading ? 'Working…' : 'Test Vault connection'}
              </button>
            </div>

            <h3>Browse COS (preview bucket)</h3>
            <p className="muted">
              Separate from Vault. Changing this does <strong>not</strong> affect Images / Orphans /
              vault scans. Reuses Vault SecretId/Key. Use List buckets to pick another bucket.
            </p>
            {browseConfigIncomplete(config) && !cosConfigIncomplete(config) && (
              <div className="setup-banner">Set Browse bucket / region / base URL to use COS → Browse.</div>
            )}
            <div className="settings-form">
              <label className="settings-span-2">
                Bucket
                <div className="bucket-row">
                  <input
                    type="text"
                    value={browseBucket}
                    onChange={(e) => setBrowseBucket(e.target.value)}
                    placeholder="name-appid"
                    list="browse-bucket-options"
                  />
                  <button type="button" disabled={loading} onClick={() => void loadBucketOptions()}>
                    {loading ? '…' : 'List buckets'}
                  </button>
                </div>
                {bucketOptions.length > 0 && (
                  <select
                    className="bucket-select"
                    value={browseBucket}
                    onChange={(e) => applyBucketOption(e.target.value)}
                  >
                    <option value="">Select a listed bucket…</option>
                    {bucketOptions.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name}
                        {b.region ? ` (${b.region})` : ''}
                      </option>
                    ))}
                  </select>
                )}
                <datalist id="browse-bucket-options">
                  {bucketOptions.map((b) => (
                    <option key={b.name} value={b.name} />
                  ))}
                </datalist>
              </label>
              <label>
                Region
                <input
                  type="text"
                  value={browseRegion}
                  onChange={(e) => {
                    const region = e.target.value;
                    setBrowseRegion(region);
                    if (browseBucket.trim() && region.trim()) {
                      const auto = defaultCosBaseURL(browseBucket, region);
                      if (
                        !browseBaseURL.trim() ||
                        browseBaseURL.trim() === defaultCosBaseURL(browseBucket, browseRegion)
                      ) {
                        setBrowseBaseURL(auto);
                      }
                    }
                  }}
                  placeholder="ap-shanghai"
                />
              </label>
              <label className="settings-span-2">
                Base URL
                <input
                  type="text"
                  value={browseBaseURL}
                  onChange={(e) => setBrowseBaseURL(e.target.value)}
                  placeholder="https://bucket.cos.region.myqcloud.com"
                />
              </label>
            </div>
            <div className="stack" style={{marginTop: 12}}>
              <button
                type="button"
                className="primary"
                onClick={() => void saveBrowseCOSSettings()}
                disabled={loading}
              >
                Save Browse COS
              </button>
              <button type="button" onClick={() => void testBrowseCOSConnection()} disabled={loading}>
                {loading ? 'Working…' : 'Test Browse connection'}
              </button>
            </div>

            <h3>Thumbnail cache</h3>
            <p className="muted">
              COS Browse Thumbnails mode caches image previews locally (OS cache dir). Clear if thumbs
              look stale after a same-key replace.
            </p>
            <button type="button" onClick={clearThumbCache} disabled={loading}>
              Clear local thumbnail cache
            </button>

            <h3>Vault paths</h3>
            <p className="muted">
              Optional for Browse. Required for Images / Orphans reference mapping. One Obsidian
              vault root per line (the folder that contains <code>.obsidian/</code>). Home,{' '}
              <code>/</code>, and similar broad paths are rejected so a scan cannot walk the whole
              disk.
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
          onDelete={view === 'obsidian-orphans' ? deletePreviewOrphan : undefined}
          onCompress={
            view === 'obsidian-images' || view === 'cos-browse'
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
          browse={view === 'cos-browse'}
          onClose={() => setCompressImage(null)}
          onReplaced={(updated) => {
            const memKey = view === 'cos-browse' ? `browse:${updated.key}` : updated.key;
            thumbMemory.delete(memKey);
            setImages((prev) =>
              prev.map((img) => (img.key === updated.key ? {...img, ...updated} : img)),
            );
            setBrowseListing((prev) =>
              prev
                ? {
                    ...prev,
                    objects: (prev.objects ?? []).map((img) =>
                      img.key === updated.key ? {...img, ...updated} : img,
                    ),
                  }
                : prev,
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
  browse = false,
  onClose,
  onReplaced,
  onError,
}: {
  image: ImageObject;
  browse?: boolean;
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
      const result = browse
        ? await COSService.BrowsePreviewCompress(image.key, nextOpts)
        : await COSService.PreviewCompress(image.key, nextOpts);
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
  }, [image.key, browse]);

  const doReplace = async () => {
    setBusy(true);
    try {
      const updated = browse
        ? await COSService.BrowseReplaceWithCompressed(image.key, opts)
        : await COSService.ReplaceWithCompressed(image.key, opts);
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

function FolderIcon({size = 48}: {size?: number}) {
  return (
    <svg
      className="folder-icon-svg"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden
    >
      <path
        fill="#d4b46a"
        d="M6 18c0-2.2 1.8-4 4-4h14.2c1.1 0 2.1.4 2.9 1.2l3.1 3.1c.8.8 1.8 1.2 2.9 1.2H54c2.2 0 4 1.8 4 4v26c0 2.2-1.8 4-4 4H10c-2.2 0-4-1.8-4-4V18z"
      />
      <path
        fill="#e8c97a"
        d="M6 26h52v24c0 2.2-1.8 4-4 4H10c-2.2 0-4-1.8-4-4V26z"
      />
    </svg>
  );
}

function BrowsePane({
  mode,
  currentPrefix,
  folders,
  objects,
  loading,
  emptyHint,
  onOpenFolder,
  onPreview,
}: {
  mode: BrowseViewMode;
  currentPrefix: string;
  folders: string[];
  objects: ImageObject[];
  loading: boolean;
  emptyHint: string;
  onOpenFolder: (prefix: string) => void;
  onPreview: (img: ImageObject) => void;
}) {
  const empty = folders.length === 0 && objects.length === 0;

  if (mode === 'grid') {
    return (
      <div className="browse-panel">
        {empty ? (
          <div className="muted browse-empty">{emptyHint}</div>
        ) : (
          <div className="browse-grid">
            {folders.map((folder) => (
              <button
                key={folder}
                type="button"
                className="browse-grid-item browse-grid-folder"
                disabled={loading}
                title={folder}
                onClick={() => onOpenFolder(folder)}
              >
                <div className="browse-grid-thumb browse-grid-folder-icon" aria-hidden>
                  <FolderIcon size={56} />
                </div>
                <div className="browse-grid-name" title={folder}>
                  {folderLeafName(folder, currentPrefix)}
                </div>
              </button>
            ))}
            {objects.map((obj) => {
              const name = objectLeafName(obj.key);
              const image = isImageObjectKey(obj.key);
              const ext = objectExt(obj.key).replace(/^\./, '') || 'file';
              return (
                <button
                  key={obj.key}
                  type="button"
                  className="browse-grid-item"
                  disabled={loading}
                  title={`${obj.key}\n${formatBytes(obj.size)}`}
                  onClick={() => {
                    if (image) onPreview(obj);
                    else {
                      void Browser.OpenURL(obj.url).catch((e: unknown) => {
                        window.alert(`Could not open URL:\n${String(e)}`);
                      });
                    }
                  }}
                >
                  <div className="browse-grid-thumb">
                    {image ? (
                      <CachedThumb keyName={obj.key} browse size={120} />
                    ) : (
                      <div className="browse-file-badge">{ext}</div>
                    )}
                  </div>
                  <div className="browse-grid-name" title={name}>
                    {name}
                  </div>
                  <div className="browse-grid-meta">{formatBytes(obj.size)}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="browse-panel">
      <div className="table-wrap browse-list">
        <table className="data-table">
          <thead>
            <tr>
              <th className="col-key">Name</th>
              <th className="col-size">Size</th>
              <th className="col-time">Modified</th>
              <th className="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {empty && (
              <tr>
                <td colSpan={4} className="muted" style={{padding: 16}}>
                  {emptyHint}
                </td>
              </tr>
            )}
            {folders.map((folder) => {
              const name = folderLeafName(folder, currentPrefix);
              return (
                <tr key={folder} className="browse-folder-row">
                  <td className="mono key-cell" title={folder}>
                    <button
                      type="button"
                      className="browse-name-btn"
                      disabled={loading}
                      onClick={() => onOpenFolder(folder)}
                    >
                      <span className="browse-folder-icon" aria-hidden>
                        <FolderIcon size={16} />
                      </span>
                      {name}/
                    </button>
                  </td>
                  <td className="muted">—</td>
                  <td className="muted">—</td>
                  <td>
                    <button
                      type="button"
                      className="action-btn"
                      disabled={loading}
                      onClick={() => onOpenFolder(folder)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              );
            })}
            {objects.map((obj) => {
              const name = objectLeafName(obj.key);
              const image = isImageObjectKey(obj.key);
              return (
                <tr key={obj.key}>
                  <td className="mono key-cell" title={obj.key}>
                    {name}
                  </td>
                  <td style={{whiteSpace: 'nowrap'}} title={`${obj.size} bytes`}>
                    {formatBytes(obj.size)}
                  </td>
                  <td style={{whiteSpace: 'nowrap'}}>
                    {formatTime(obj.lastModified || obj.uploadTime)}
                  </td>
                  <td>
                    <div className="url-actions">
                      {image && (
                        <button
                          type="button"
                          className="action-btn"
                          title="Preview image in this app"
                          onClick={() => onPreview(obj)}
                        >
                          Preview
                        </button>
                      )}
                      <button
                        type="button"
                        className="action-btn"
                        title={obj.url}
                        onClick={() => {
                          void Browser.OpenURL(obj.url).catch((e: unknown) => {
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
    </div>
  );
}

function ImageTable({
  rows,
  refByKey,
  selectable,
  selectedKeys,
  emptyHint,
  onToggle,
  onToggleAll,
  onOpenNote,
  onPreview,
}: {
  rows: ImageObject[];
  refByKey: Map<string, ImageRef>;
  selectable: boolean;
  selectedKeys: Set<string>;
  emptyHint?: string;
  onToggle: (key: string) => void;
  onToggleAll?: (keys: string[]) => void;
  onOpenNote: (notes: string[] | null | undefined) => void;
  onPreview: (img: ImageObject) => void;
}) {
  const colSpan = (selectable ? 1 : 0) + 6;
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
                {emptyHint ?? 'No rows yet. Click Refresh to load from COS / vaults.'}
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
