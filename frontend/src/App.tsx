import {useEffect, useState} from 'react';
import {
  AppConfig,
  ConfigService,
  COSService,
  ImageObject,
} from '../bindings/github.com/uniquejava/obsidian-cos-images';

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

function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [images, setImages] = useState<ImageObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState<'uploadTime' | 'size'>('uploadTime');

  useEffect(() => {
    ConfigService.GetConfig()
      .then(setConfig)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  const loadImages = () => {
    setLoading(true);
    setError('');
    COSService.ListImages()
      .then((list) => setImages(list ?? []))
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadImages();
  }, []);

  const sorted = [...images].sort((a, b) => {
    if (sortBy === 'size') {
      return (b.size || 0) - (a.size || 0);
    }
    const ta = new Date(a.uploadTime).getTime();
    const tb = new Date(b.uploadTime).getTime();
    return tb - ta;
  });

  const totalBytes = images.reduce((sum, img) => sum + (img.size || 0), 0);

  return (
    <main style={{fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1200}}>
      <h1 style={{marginTop: 0}}>Obsidian COS Images</h1>
      <p style={{color: '#555', marginBottom: 16}}>
        PicGo → Tencent COS objects under{' '}
        <code>{config?.cosPrefix ?? 'obsidian/'}</code>
        {config && (
          <>
            {' '}
            · credentials{' '}
            {config.secretIdSet && config.secretKeySet ? 'ready' : 'missing (.env)'}
          </>
        )}
      </p>

      <div style={{display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap'}}>
        <button type="button" onClick={loadImages} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <label>
          Sort{' '}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'uploadTime' | 'size')}
          >
            <option value="uploadTime">Upload time (newest)</option>
            <option value="size">Size (largest)</option>
          </select>
        </label>
        <span style={{color: '#666'}}>
          {images.length} objects · {formatBytes(totalBytes)}
        </span>
      </div>

      {error && (
        <pre style={{color: 'crimson', background: '#fef2f2', padding: 12, borderRadius: 8}}>
          {error}
        </pre>
      )}

      <div style={{overflow: 'auto', border: '1px solid #e4e4e7', borderRadius: 8}}>
        <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 14}}>
          <thead>
            <tr style={{background: '#f4f4f5', textAlign: 'left'}}>
              <th style={{padding: '10px 12px'}}>Key</th>
              <th style={{padding: '10px 12px', whiteSpace: 'nowrap'}}>Size</th>
              <th style={{padding: '10px 12px', whiteSpace: 'nowrap'}}>Upload time</th>
              <th style={{padding: '10px 12px'}}>URL</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && !loading && !error && (
              <tr>
                <td colSpan={4} style={{padding: 16, color: '#71717a'}}>
                  No objects listed yet.
                </td>
              </tr>
            )}
            {sorted.map((img) => (
              <tr key={img.key} style={{borderTop: '1px solid #e4e4e7'}}>
                <td style={{padding: '8px 12px', fontFamily: 'ui-monospace, monospace'}}>
                  {img.key}
                </td>
                <td style={{padding: '8px 12px', whiteSpace: 'nowrap'}} title={`${img.size} bytes`}>
                  {formatBytes(img.size)}
                </td>
                <td style={{padding: '8px 12px', whiteSpace: 'nowrap'}}>
                  {formatTime(img.uploadTime)}
                </td>
                <td style={{padding: '8px 12px', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis'}}>
                  <a href={img.url} target="_blank" rel="noreferrer">
                    {img.url}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

export default App;
