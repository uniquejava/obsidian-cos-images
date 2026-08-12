import {useEffect, useMemo, useState, type CSSProperties} from 'react';
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

type Tab = 'images' | 'orphans' | 'cascade';
type SortBy = 'uploadTime' | 'size';

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

function App() {
  const [tab, setTab] = useState<Tab>('images');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [images, setImages] = useState<ImageObject[]>([]);
  const [refs, setRefs] = useState<ImageRef[]>([]);
  const [orphans, setOrphans] = useState<OrphanImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('uploadTime');
  const [minSizeMB, setMinSizeMB] = useState(0);
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

  useEffect(() => {
    ConfigService.GetConfig()
      .then(setConfig)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  const loadImagesAndRefs = async () => {
    setLoading(true);
    setError('');
    try {
      const [imgs, scanned] = await Promise.all([
        COSService.ListImages(),
        VaultService.ScanReferences().catch(() => [] as ImageRef[]),
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
    loadImagesAndRefs();
  }, []);

  useEffect(() => {
    if (tab === 'orphans') loadOrphans();
  }, [tab]);

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
    let list = images.filter((img) => (img.size || 0) >= minBytes);
    if (unusedOnly) {
      list = list.filter((img) => !refByKey.has(img.key));
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'size') return (b.size || 0) - (a.size || 0);
      return new Date(b.uploadTime).getTime() - new Date(a.uploadTime).getTime();
    });
  }, [images, minSizeMB, unusedOnly, refByKey, sortBy]);

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

  const tabStyle = (t: Tab): CSSProperties => ({
    padding: '8px 14px',
    border: '1px solid #d4d4d8',
    background: tab === t ? '#18181b' : '#fff',
    color: tab === t ? '#fff' : '#18181b',
    cursor: 'pointer',
    borderRadius: 6,
  });

  return (
    <main style={{fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1280}}>
      <h1 style={{marginTop: 0}}>Obsidian COS Images</h1>
      <p style={{color: '#555', marginBottom: 16}}>
        Prefix <code>{config?.cosPrefix ?? 'obsidian/'}</code>
        {config && (
          <>
            {' '}
            · credentials {config.secretIdSet && config.secretKeySet ? 'ready' : 'missing (.env)'}
            {' '}
            · {refs.length} referenced keys from vault scan
          </>
        )}
      </p>

      <div style={{display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap'}}>
        <button type="button" style={tabStyle('images')} onClick={() => setTab('images')}>
          Images
        </button>
        <button type="button" style={tabStyle('orphans')} onClick={() => setTab('orphans')}>
          Orphans
        </button>
        <button type="button" style={tabStyle('cascade')} onClick={() => setTab('cascade')}>
          Cascade
        </button>
      </div>

      {error && (
        <pre style={{color: 'crimson', background: '#fef2f2', padding: 12, borderRadius: 8}}>
          {error}
        </pre>
      )}

      {tab === 'images' && (
        <>
          <div style={{display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap'}}>
            <button type="button" onClick={loadImagesAndRefs} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <label>
              Sort{' '}
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
                <option value="uploadTime">Upload time</option>
                <option value="size">Size</option>
              </select>
            </label>
            <label>
              Min size (MB){' '}
              <input
                type="number"
                min={0}
                step={0.1}
                value={minSizeMB}
                onChange={(e) => setMinSizeMB(Number(e.target.value) || 0)}
                style={{width: 72}}
              />
            </label>
            <label style={{display: 'flex', gap: 6, alignItems: 'center'}}>
              <input
                type="checkbox"
                checked={unusedOnly}
                onChange={(e) => setUnusedOnly(e.target.checked)}
              />
              Unused only
            </label>
            <button
              type="button"
              disabled={selectedKeys.size === 0 || loading}
              onClick={() => deleteSelected([...selectedKeys], 'selected')}
            >
              Delete selected ({selectedKeys.size})
            </button>
            <span style={{color: '#666'}}>
              {filteredImages.length} shown · {formatBytes(totalBytes)}
            </span>
          </div>

          <ImageTable
            rows={filteredImages}
            refByKey={refByKey}
            selectedKeys={selectedKeys}
            onToggle={toggleKey}
            onOpen={setDetailKey}
          />
        </>
      )}

      {tab === 'orphans' && (
        <>
          <div style={{display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap'}}>
            <button type="button" onClick={loadOrphans} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh orphans'}
            </button>
            <button
              type="button"
              disabled={selectedKeys.size === 0 || loading}
              onClick={() => deleteSelected([...selectedKeys], 'orphans')}
            >
              Delete selected ({selectedKeys.size})
            </button>
            <button
              type="button"
              disabled={orphans.length === 0 || loading}
              onClick={() => deleteSelected(orphans.map((o) => o.key), 'all orphans')}
            >
              Delete all orphans
            </button>
            <span style={{color: '#666'}}>
              {orphans.length} orphans · reclaimable {formatBytes(orphanBytes)}
            </span>
          </div>
          <ImageTable
            rows={orphans}
            refByKey={refByKey}
            selectedKeys={selectedKeys}
            onToggle={toggleKey}
            onOpen={setDetailKey}
          />
        </>
      )}

      {tab === 'cascade' && (
        <section>
          <p style={{color: '#555'}}>
            Preview unique-only cascade delete for a Markdown note path. Shared images stay.
          </p>
          <div style={{display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16}}>
            <input
              value={notePath}
              onChange={(e) => setNotePath(e.target.value)}
              placeholder="/path/to/note.md"
              style={{flex: 1, minWidth: 280, padding: 8}}
            />
            <button type="button" onClick={runCascadePreview} disabled={loading || !notePath.trim()}>
              Preview
            </button>
            <button
              type="button"
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
              <ul>
                {(cascadePreview.images ?? []).map((img) => (
                  <li key={img.key}>
                    <code>{img.key}</code> · {formatBytes(img.size)}
                  </li>
                ))}
              </ul>
              <h3>Shared — kept ({cascadePreview.sharedWithOtherNotes?.length ?? 0})</h3>
              <ul>
                {(cascadePreview.sharedWithOtherNotes ?? []).map((ref) => (
                  <li key={ref.key}>
                    <code>{ref.key}</code> · {ref.notes?.length ?? 0} notes
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {detailKey && (
        <aside
          style={{
            marginTop: 20,
            padding: 16,
            background: '#fafafa',
            border: '1px solid #e4e4e7',
            borderRadius: 8,
          }}
        >
          <div style={{display: 'flex', justifyContent: 'space-between', gap: 12}}>
            <strong>References for <code>{detailKey}</code></strong>
            <button type="button" onClick={() => setDetailKey(null)}>
              Close
            </button>
          </div>
          {detailNotes.length === 0 ? (
            <p style={{color: '#71717a'}}>No Markdown references found.</p>
          ) : (
            <ul>
              {detailNotes.map((n) => (
                <li key={n} title={n}>
                  {shortPath(n)}
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </main>
  );
}

function ImageTable({
  rows,
  refByKey,
  selectedKeys,
  onToggle,
  onOpen,
}: {
  rows: ImageObject[];
  refByKey: Map<string, ImageRef>;
  selectedKeys: Set<string>;
  onToggle: (key: string) => void;
  onOpen: (key: string) => void;
}) {
  return (
    <div style={{overflow: 'auto', border: '1px solid #e4e4e7', borderRadius: 8}}>
      <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 14}}>
        <thead>
          <tr style={{background: '#f4f4f5', textAlign: 'left'}}>
            <th style={{padding: '10px 12px'}}></th>
            <th style={{padding: '10px 12px'}}>Key</th>
            <th style={{padding: '10px 12px'}}>Size</th>
            <th style={{padding: '10px 12px'}}>Upload time</th>
            <th style={{padding: '10px 12px'}}>Notes</th>
            <th style={{padding: '10px 12px'}}>URL</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} style={{padding: 16, color: '#71717a'}}>
                No rows.
              </td>
            </tr>
          )}
          {rows.map((img) => {
            const noteCount = refByKey.get(img.key)?.notes?.length ?? 0;
            return (
              <tr key={img.key} style={{borderTop: '1px solid #e4e4e7'}}>
                <td style={{padding: '8px 12px'}}>
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(img.key)}
                    onChange={() => onToggle(img.key)}
                  />
                </td>
                <td style={{padding: '8px 12px', fontFamily: 'ui-monospace, monospace'}}>
                  <button
                    type="button"
                    onClick={() => onOpen(img.key)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: '#1d4ed8',
                      cursor: 'pointer',
                      font: 'inherit',
                      textAlign: 'left',
                    }}
                  >
                    {img.key}
                  </button>
                </td>
                <td style={{padding: '8px 12px', whiteSpace: 'nowrap'}} title={`${img.size} bytes`}>
                  {formatBytes(img.size)}
                </td>
                <td style={{padding: '8px 12px', whiteSpace: 'nowrap'}}>
                  {formatTime(img.uploadTime)}
                </td>
                <td style={{padding: '8px 12px'}}>{noteCount}</td>
                <td
                  style={{
                    padding: '8px 12px',
                    maxWidth: 220,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
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
