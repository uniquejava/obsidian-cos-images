import {useEffect, useState} from 'react';
import {AppConfig, ConfigService} from '../bindings/github.com/uniquejava/obsidian-cos-images';

function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    ConfigService.GetConfig()
      .then(setConfig)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  return (
    <main style={{fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 880}}>
      <h1 style={{marginTop: 0}}>Obsidian COS Images</h1>
      <p style={{color: '#555'}}>
        Wails v3 skeleton. Backend service methods return <code>not implemented</code> until
        the next session implements <code>docs/REQUIREMENTS.md</code>.
      </p>

      <section>
        <h2>Planned features</h2>
        <ol>
          <li>Browse COS images sorted by upload time; show size (find early uncompressed notes).</li>
          <li>See which Markdown notes reference each image.</li>
          <li>Find orphans; cascade-delete images when a note is removed (unique refs only by default).</li>
        </ol>
      </section>

      <section>
        <h2>Config (stub defaults)</h2>
        {error && <pre style={{color: 'crimson'}}>{error}</pre>}
        {config && (
          <pre style={{background: '#f4f4f5', padding: 12, borderRadius: 8, overflow: 'auto'}}>
            {JSON.stringify(config, null, 2)}
          </pre>
        )}
      </section>
    </main>
  );
}

export default App;
