import {useEffect, useMemo, useState} from 'react';
import {Events} from '@wailsio/runtime';
import {
  AppConfig,
  CascadeDeletePreview,
  CleanupService,
  ConfigService,
  COSService,
  ImageObject,
  ImageRef,
  OrphanImage,
  VaultService,
} from '../bindings/github.com/uniquejava/obsidian-cos-images';

type Tab = 'images' | 'orphans' | 'cascade' | 'settings';
type SortBy = 'uploadTime' | 'size';

const TABS: {id: Tab; label: string}[] = [
  {id: 'images', label: 'Images'},
  {id: 'orphans', label: 'Orphans'},
  {id: 'cascade', label: 'Cascade'},
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

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], {type: mime});
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}

function dayStart(isoDate: string): number | null {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function dayEnd(isoDate: string): number | null {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
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
  const [images, setImages] = useState<ImageObject[]>([]);
  const [refs, setRefs] = useState<ImageRef[]>([]);
  const [orphans, setOrphans] = useState<OrphanImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scanStatus, setScanStatus] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('uploadTime');
  const [minSizeMB, setMinSizeMB] = useState(0);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detailNotes, setDetailNotes] = useState<string[]>([]);

  const [notePath, setNotePath] = useState('');
  const [cascadePreview, setCascadePreview] = useState<CascadeDeletePreview | null>(null);

  const refByKey = useMemo(() => {
    const m = new Map<string, ImageRef>();
    for (const r of refs) m.set(r.key, r);
    return m;
  }, [refs]);

  const refreshConfig = async () => {
    const cfg = await ConfigService.GetConfig();
    setConfig(cfg);
    setVaultPathsText((cfg.vaultPaths ?? []).join('\n'));
    setShowThumbnails(Boolean(cfg.showThumbnails));
    try {
      const path = await ConfigService.ConfigFilePath();
      setConfigPath(path ?? '');
    } catch {
      setConfigPath('');
    }
  };

  useEffect(() => {
    refreshConfig().catch((e: unknown) => setError(String(e)));
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
    setError('');
    setScanStatus('Scanning vaults…');
    try {
      const [imgs, scanned] = await Promise.all([
        COSService.ListImages(),
        VaultService.ScanReferences().catch((e: unknown) => {
          setError(String(e));
          return [] as ImageRef[];
        }),
      ]);
      setImages(imgs ?? []);
      setRefs(scanned ?? []);
      setSelectedKeys(new Set());
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadOrphans = async () => {
    setLoading(true);
    setError('');
    try {
      const list = await CleanupService.ListOrphans();
      setOrphans(list ?? []);
      setSelectedKeys(new Set());
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!detailKey) {
      setDetailNotes([]);
      return;
    }
    const cached = refByKey.get(detailKey);
    if (cached) {
      setDetailNotes(cached.notes ?? []);
      return;
    }
    VaultService.FindNotesUsing(detailKey)
      .then((notes) => setDetailNotes(notes ?? []))
      .catch(() => setDetailNotes([]));
  }, [detailKey, refByKey]);

  const filteredImages = useMemo(() => {
    const minBytes = minSizeMB > 0 ? minSizeMB * 1024 * 1024 : 0;
    const fromTs = dayStart(dateFrom);
    const toTs = dayEnd(dateTo);
    let list = images.filter((img) => (img.size || 0) >= minBytes);
    if (unusedOnly) {
      list = list.filter((img) => !refByKey.has(img.key));
    }
    if (fromTs != null || toTs != null) {
      list = list.filter((img) => {
        const t = new Date(img.uploadTime).getTime();
        if (Number.isNaN(t)) return false;
        if (fromTs != null && t < fromTs) return false;
        if (toTs != null && t > toTs) return false;
        return true;
      });
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'size') return (b.size || 0) - (a.size || 0);
      return new Date(b.uploadTime).getTime() - new Date(a.uploadTime).getTime();
    });
  }, [images, minSizeMB, unusedOnly, refByKey, sortBy, dateFrom, dateTo]);

  const totalBytes = filteredImages.reduce((s, img) => s + (img.size || 0), 0);
  const orphanBytes = orphans.reduce((s, img) => s + (img.size || 0), 0);

  const toggleKey = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const deleteSelected = async (keys: string[], label: string) => {
    if (keys.length === 0) return;
    const ok = window.confirm(
      `Delete ${keys.length} COS object(s) (${label})?\nThis cannot be undone.`,
    );
    if (!ok) return;
    setLoading(true);
    setError('');
    try {
      await COSService.DeleteImages(keys);
      setSelectedKeys(new Set());
      if (tab === 'orphans') await loadOrphans();
      else await loadImagesAndRefs();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const exportOrphans = async (format: 'csv' | 'json') => {
    setLoading(true);
    setError('');
    try {
      const body = await CleanupService.ExportOrphans(format);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadText(
        `cos-orphans-${stamp}.${format}`,
        body ?? '',
        format === 'json' ? 'application/json' : 'text/csv',
      );
    } catch (e: unknown) {
      setError(String(e));
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
    setError('');
    try {
      await ConfigService.SaveVaultPaths(paths);
      await refreshConfig();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggleThumbnails = async (enabled: boolean) => {
    setShowThumbnails(enabled);
    try {
      await ConfigService.SaveShowThumbnails(enabled);
      setConfig((c) => (c ? {...c, showThumbnails: enabled} : c));
    } catch (e: unknown) {
      setError(String(e));
      setShowThumbnails(!enabled);
    }
  };

  const clearThumbCache = async () => {
    setLoading(true);
    setError('');
    try {
      await COSService.ClearThumbnailCache();
      thumbMemory.clear();
      window.alert('Local thumbnail cache cleared.');
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const runCascadePreview = async () => {
    setLoading(true);
    setError('');
    setCascadePreview(null);
    try {
      const preview = await CleanupService.PreviewCascadeDelete(notePath.trim());
      setCascadePreview(preview);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const runCascadeDelete = async () => {
    if (!cascadePreview) return;
    const n = cascadePreview.images?.length ?? 0;
    if (n === 0) {
      window.alert('No uniquely-referenced images to delete.');
      return;
    }
    const bytes = (cascadePreview.images ?? []).reduce((s, img) => s + (img.size || 0), 0);
    const ok = window.confirm(
      `Delete ${n} uniquely-referenced image(s) (${formatBytes(bytes)}) for this note?\nShared images will be kept.`,
    );
    if (!ok) return;
    setLoading(true);
    setError('');
    try {
      await CleanupService.CascadeDeleteNoteImages(cascadePreview.notePath, true);
      await runCascadePreview();
      await loadImagesAndRefs();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const showDetail = Boolean(detailKey) && (tab === 'images' || tab === 'orphans');

  return (
    <div className="app no-drag">
      <aside className="sidebar">
        <div className="brand">
          Obsidian COS
          <small>
            {config?.cosPrefix ?? 'obsidian/'}
            {config
              ? ` · ${config.secretIdSet && config.secretKeySet ? 'creds ok' : 'creds missing'}`
              : ''}
          </small>
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`nav-btn${tab === t.id ? ' active' : ''}`}
            onClick={() => {
              setTab(t.id);
              if (t.id !== 'images' && t.id !== 'orphans') setDetailKey(null);
            }}
          >
            {t.label}
          </button>
        ))}
        <div className="sidebar-meta">
          {refs.length} referenced keys
          {scanStatus ? (
            <>
              <br />
              {scanStatus}
            </>
          ) : null}
        </div>
      </aside>

      <div className="main">
        {error && <pre className="error-box">{error}</pre>}

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
                Min MB
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={minSizeMB}
                  onChange={(e) => setMinSizeMB(Number(e.target.value) || 0)}
                  style={{width: 64}}
                />
              </label>
              <label>
                From
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </label>
              <label>
                To
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={unusedOnly}
                  onChange={(e) => setUnusedOnly(e.target.checked)}
                />
                Unused only
              </label>
              <label title="Off by default to avoid COS egress. Cached locally after first load.">
                <input
                  type="checkbox"
                  checked={showThumbnails}
                  onChange={(e) => toggleThumbnails(e.target.checked)}
                />
                Thumbnails
              </label>
              <button
                type="button"
                disabled={selectedKeys.size === 0 || loading}
                onClick={() => deleteSelected([...selectedKeys], 'selected')}
              >
                Delete ({selectedKeys.size})
              </button>
              <span className="toolbar-stat">
                {filteredImages.length} shown · {formatBytes(totalBytes)}
                {images.length === 0 && !loading ? ' · click Refresh' : ''}
              </span>
            </div>
            <div className={`content${showDetail ? ' with-detail' : ''}`}>
              <div className="panel-split">
                <ImageTable
                  rows={filteredImages}
                  refByKey={refByKey}
                  selectedKeys={selectedKeys}
                  showThumbnails={showThumbnails}
                  onToggle={toggleKey}
                  onOpen={setDetailKey}
                />
              </div>
              {showDetail && (
                <DetailPanel
                  detailKey={detailKey!}
                  notes={detailNotes}
                  onClose={() => setDetailKey(null)}
                />
              )}
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
                <input
                  type="checkbox"
                  checked={showThumbnails}
                  onChange={(e) => toggleThumbnails(e.target.checked)}
                />
                Thumbnails
              </label>
              <button
                type="button"
                disabled={selectedKeys.size === 0 || loading}
                onClick={() => deleteSelected([...selectedKeys], 'orphans')}
              >
                Delete ({selectedKeys.size})
              </button>
              <button
                type="button"
                disabled={orphans.length === 0 || loading}
                onClick={() => deleteSelected(orphans.map((o) => o.key), 'all orphans')}
              >
                Delete all
              </button>
              <span className="toolbar-stat">
                {orphans.length} orphans · {formatBytes(orphanBytes)}
              </span>
            </div>
            <div className={`content${showDetail ? ' with-detail' : ''}`}>
              <div className="panel-split">
                <ImageTable
                  rows={orphans}
                  refByKey={refByKey}
                  selectedKeys={selectedKeys}
                  showThumbnails={showThumbnails}
                  onToggle={toggleKey}
                  onOpen={setDetailKey}
                />
              </div>
              {showDetail && (
                <DetailPanel
                  detailKey={detailKey!}
                  notes={detailNotes}
                  onClose={() => setDetailKey(null)}
                />
              )}
            </div>
          </>
        )}

        {tab === 'cascade' && (
          <div className="panel section">
            <p className="muted">
              Preview unique-only cascade delete for a Markdown note path. Shared images stay.
            </p>
            <div className="stack">
              <input
                type="text"
                value={notePath}
                onChange={(e) => setNotePath(e.target.value)}
                placeholder="/path/to/note.md"
                style={{flex: 1, minWidth: 240}}
              />
              <button type="button" onClick={runCascadePreview} disabled={loading || !notePath.trim()}>
                Preview
              </button>
              <button
                type="button"
                className="primary"
                onClick={runCascadeDelete}
                disabled={loading || !cascadePreview || (cascadePreview.images?.length ?? 0) === 0}
              >
                Delete unique images
              </button>
            </div>
            {cascadePreview && (
              <div>
                <p>
                  Note: <code>{cascadePreview.notePath}</code>
                </p>
                <h3>
                  Would delete ({cascadePreview.images?.length ?? 0}) ·{' '}
                  {formatBytes((cascadePreview.images ?? []).reduce((s, i) => s + (i.size || 0), 0))}
                </h3>
                <ul className="note-list">
                  {(cascadePreview.images ?? []).map((img) => (
                    <li key={img.key} style={{display: 'flex', gap: 8, alignItems: 'center'}}>
                      {showThumbnails && <CachedThumb keyName={img.key} size={32} />}
                      <code>{img.key}</code> · {formatBytes(img.size)}
                    </li>
                  ))}
                </ul>
                <h3>Shared — kept ({cascadePreview.sharedWithOtherNotes?.length ?? 0})</h3>
                <ul className="note-list">
                  {(cascadePreview.sharedWithOtherNotes ?? []).map((ref) => (
                    <li key={ref.key}>
                      <code>{ref.key}</code> · {ref.notes?.length ?? 0} notes
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === 'settings' && (
          <div className="panel section">
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
              One vault root per line. Saved to local config (no secrets). Env{' '}
              <code>VAULT_PATHS</code> is used only when no saved paths exist.
            </p>
            {configPath && (
              <p className="muted">
                Config file: <code>{configPath}</code>
              </p>
            )}
            <textarea
              value={vaultPathsText}
              onChange={(e) => setVaultPathsText(e.target.value)}
              rows={8}
              placeholder="/path/to/Obsidian/Documents"
            />
            <div style={{marginTop: 12}}>
              <button type="button" className="primary" onClick={saveVaultPaths} disabled={loading}>
                Save vault paths
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailPanel({
  detailKey,
  notes,
  onClose,
}: {
  detailKey: string;
  notes: string[];
  onClose: () => void;
}) {
  return (
    <aside className="detail">
      <div className="detail-head">
        <strong>
          Notes using
          <br />
          <code>{detailKey}</code>
        </strong>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      {notes.length === 0 ? (
        <p className="muted">No Markdown references found.</p>
      ) : (
        <ul>
          {notes.map((n) => (
            <li key={n} title={n}>
              {shortPath(n)}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function ImageTable({
  rows,
  refByKey,
  selectedKeys,
  showThumbnails,
  onToggle,
  onOpen,
}: {
  rows: ImageObject[];
  refByKey: Map<string, ImageRef>;
  selectedKeys: Set<string>;
  showThumbnails: boolean;
  onToggle: (key: string) => void;
  onOpen: (key: string) => void;
}) {
  const colSpan = showThumbnails ? 7 : 6;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{width: 36}} aria-label="Select" />
            {showThumbnails && <th>Thumb</th>}
            <th>Key</th>
            <th>Size</th>
            <th>Upload time</th>
            <th>Notes</th>
            <th>URL</th>
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
            const noteCount = refByKey.get(img.key)?.notes?.length ?? 0;
            return (
              <tr key={img.key}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(img.key)}
                    onChange={() => onToggle(img.key)}
                  />
                </td>
                {showThumbnails && (
                  <td>
                    <CachedThumb keyName={img.key} />
                  </td>
                )}
                <td className="mono">
                  <button type="button" className="linkish" onClick={() => onOpen(img.key)}>
                    {img.key}
                  </button>
                </td>
                <td style={{whiteSpace: 'nowrap'}} title={`${img.size} bytes`}>
                  {formatBytes(img.size)}
                </td>
                <td style={{whiteSpace: 'nowrap'}}>{formatTime(img.uploadTime)}</td>
                <td>{noteCount}</td>
                <td>
                  <a href={img.url} target="_blank" rel="noreferrer">
                    open
                  </a>
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
