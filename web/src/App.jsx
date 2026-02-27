import { useEffect, useMemo, useState } from 'react';

const DEFAULT_FORM = {
  mode: 'pinterest',
  url: '',
  query: 'travel photography',
  depth: 2,
  minWidth: 300,
  quality: 70,
  cookie: '',
  sameOrigin: true,
  maxImages: 80,
  maxScrolls: 35,
  headful: true
};

async function readJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

function formatBytes(value) {
  if (!value && value !== 0) {
    return '-';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) {
    return '-';
  }
  const sec = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

export function App() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [status, setStatus] = useState(null);
  const [report, setReport] = useState(null);
  const [images, setImages] = useState([]);
  const [selectedImages, setSelectedImages] = useState([]);
  const [previewImage, setPreviewImage] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const running = Boolean(status?.running);
  const progress = status?.progress || null;
  const progressPercent = progress?.percent ?? null;
  const canStart = useMemo(() => {
    if (running) {
      return false;
    }
    if (form.mode === 'site') {
      return Boolean(form.url.trim());
    }
    return Boolean(form.url.trim() || form.query.trim());
  }, [form, running]);

  async function refreshAll() {
    const [statusData, reportData, imagesData, logsData] = await Promise.all([
      readJson('/api/crawl/status'),
      readJson('/api/report'),
      readJson('/api/images'),
      readJson('/api/logs?lines=250')
    ]);

    setStatus(statusData);
    setReport(reportData.report || null);
    const imageList = imagesData.images || [];
    setImages(imageList);
    setSelectedImages((prev) => prev.filter((name) => imageList.some((img) => img.name === name)));
    setLogs(logsData.logs || []);
  }

  useEffect(() => {
    refreshAll().catch((err) => setError(err.message));
    const timer = setInterval(() => {
      refreshAll().catch((err) => setError(err.message));
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  async function handleStart(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await readJson('/api/crawl/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form)
      });
      await refreshAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleSelectImage(name) {
    setSelectedImages((prev) => {
      if (prev.includes(name)) {
        return prev.filter((item) => item !== name);
      }
      return [...prev, name];
    });
  }

  async function deleteSingleImage(name) {
    setDeleting(true);
    setError('');
    try {
      await readJson('/api/images/delete-batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ names: [name] })
      });
      setPreviewImage((prev) => (prev?.name === name ? null : prev));
      await refreshAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  async function deleteSelectedImages() {
    if (selectedImages.length === 0) {
      return;
    }

    setDeleting(true);
    setError('');
    try {
      await readJson('/api/images/delete-batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ names: selectedImages })
      });
      setPreviewImage((prev) => (prev && selectedImages.includes(prev.name) ? null : prev));
      await refreshAll();
      setSelectedImages([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="page">
      <section className="panel">
        <h1>Crawler Console</h1>
        <p className="muted">UI React/Vite su porta 6064 per avvio ricerca e browsing immagini.</p>

        <form className="grid" onSubmit={handleStart}>
          <label>
            Mode
            <select value={form.mode} onChange={(e) => updateField('mode', e.target.value)}>
              <option value="pinterest">pinterest</option>
              <option value="site">site</option>
            </select>
          </label>

          <label>
            URL
            <input value={form.url} onChange={(e) => updateField('url', e.target.value)} placeholder="https://..." />
          </label>

          <label>
            Query
            <input value={form.query} onChange={(e) => updateField('query', e.target.value)} placeholder="es: travel photography" />
          </label>

          <label>
            Depth
            <input type="number" min="0" value={form.depth} onChange={(e) => updateField('depth', Number(e.target.value))} />
          </label>

          <label>
            Min Width
            <input type="number" min="1" value={form.minWidth} onChange={(e) => updateField('minWidth', Number(e.target.value))} />
          </label>

          <label>
            Quality (q)
            <input type="number" min="1" max="100" value={form.quality} onChange={(e) => updateField('quality', Number(e.target.value))} />
          </label>

          <label>
            Max Images
            <input type="number" min="1" value={form.maxImages} onChange={(e) => updateField('maxImages', Number(e.target.value))} />
          </label>

          <label>
            Max Scrolls
            <input type="number" min="1" value={form.maxScrolls} onChange={(e) => updateField('maxScrolls', Number(e.target.value))} />
          </label>

          <label>
            Cookie
            <input value={form.cookie} onChange={(e) => updateField('cookie', e.target.value)} placeholder="sessionid=...; csrftoken=..." />
          </label>

          <label className="check">
            <input type="checkbox" checked={form.sameOrigin} onChange={(e) => updateField('sameOrigin', e.target.checked)} />
            same-origin
          </label>

          <label className="check">
            <input type="checkbox" checked={form.headful} onChange={(e) => updateField('headful', e.target.checked)} />
            headful browser
          </label>

          <button type="submit" disabled={!canStart || loading}>
            {running ? 'Crawler in esecuzione...' : loading ? 'Avvio...' : 'Avvia Ricerca'}
          </button>
        </form>

        {error ? <p className="error">{error}</p> : null}

        <div className="status">
          <strong>Status:</strong>{' '}
          {running ? 'RUNNING' : 'IDLE'}
          {status?.startedAt ? ` | start: ${status.startedAt}` : ''}
          {status?.endedAt ? ` | end: ${status.endedAt}` : ''}
          {status?.exitCode !== null && status?.exitCode !== undefined ? ` | code: ${status.exitCode}` : ''}
        </div>

        <div className="progressBlock">
          <div className={`progressTrack ${progressPercent === null ? 'indeterminate' : ''}`}>
            <div
              className="progressFill"
              style={{ width: `${progressPercent === null ? 25 : progressPercent}%` }}
            />
          </div>
          <div className="progressInfo">
            <span>Progresso: {progressPercent === null ? 'calcolo...' : `${progressPercent}%`}</span>
            <span>ETA: {running ? formatDuration(progress?.etaSec) : '-'}</span>
            <span>Elapsed: {formatDuration(progress?.elapsedSec)}</span>
            <span>
              Processate: {progress?.processed ?? 0}
              {progress?.target ? ` / ${progress.target}` : ''}
            </span>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Report</h2>
        <pre>{JSON.stringify(report, null, 2)}</pre>
      </section>

      <section className="panel">
        <h2>Immagini Scaricate ({images.length})</h2>
        <div className="galleryTools">
          <span>Selezionate: {selectedImages.length}</span>
          <button type="button" className="dangerBtn" disabled={selectedImages.length === 0 || deleting} onClick={deleteSelectedImages}>
            Cestino: Elimina Selezionate
          </button>
        </div>
        <div className="gallery">
          {images.map((img) => (
            <article key={img.name} className="card">
              <div className="cardTools">
                <button
                  type="button"
                  className="toolBtn"
                  title="Seleziona"
                  onClick={() => toggleSelectImage(img.name)}
                >
                  {selectedImages.includes(img.name) ? '[v]' : '[ ]'}
                </button>
                <button
                  type="button"
                  className="toolBtn deleteOne"
                  title="Elimina immagine"
                  disabled={deleting}
                  onClick={() => deleteSingleImage(img.name)}
                >
                  [x]
                </button>
              </div>
              <img
                src={img.url}
                alt={img.name}
                loading="lazy"
                onDoubleClick={() => setPreviewImage(img)}
              />
              <div className="meta">
                <p title={img.name}>{img.name}</p>
                <small>{formatBytes(img.sizeBytes)}</small>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Activity Log</h2>
        <div className="logs">
          {logs.map((line, idx) => (
            <div key={`${idx}-${line}`}>{line}</div>
          ))}
        </div>
      </section>

      {previewImage ? (
        <section className="previewOverlay" onClick={() => setPreviewImage(null)}>
          <article className="previewPanel" onClick={(e) => e.stopPropagation()}>
            <header>
              <strong>{previewImage.name}</strong>
              <button type="button" onClick={() => setPreviewImage(null)}>Chiudi</button>
            </header>
            <img src={previewImage.url} alt={previewImage.name} />
          </article>
        </section>
      ) : null}
    </main>
  );
}
