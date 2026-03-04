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
  headful: true,
  clearImagesBeforeStart: false,
  recompress: true
};

const FORM_STORAGE_KEY = 'crawler.searchForm';

async function readJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

function buildAppUrl(relativePath) {
  const normalizedPath = String(relativePath || '').replace(/^\/+/, '');
  return new URL(normalizedPath, document.baseURI).toString();
}

function buildApiUrl(relativePath) {
  return buildAppUrl(`api/${String(relativePath || '').replace(/^\/+/, '')}`);
}

function buildImageUrl(name) {
  return buildAppUrl(`images/${encodeURIComponent(name)}`);
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

function loadStoredForm() {
  if (typeof window === 'undefined') {
    return DEFAULT_FORM;
  }

  try {
    const raw = window.localStorage.getItem(FORM_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_FORM;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return DEFAULT_FORM;
    }

    return { ...DEFAULT_FORM, ...parsed };
  } catch {
    return DEFAULT_FORM;
  }
}

export function App() {
  const [form, setForm] = useState(loadStoredForm);
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
      readJson(buildApiUrl('crawl/status')),
      readJson(buildApiUrl('report')),
      readJson(buildApiUrl('images')),
      readJson(buildApiUrl('logs?lines=250'))
    ]);

    setStatus(statusData);
    setReport(reportData.report || null);
    const imageList = imagesData.images || [];
    setImages(imageList);
    setSelectedImages((prev) => prev.filter((name) => imageList.some((img) => img.name === name)));
    setPreviewImage((prev) => (prev && imageList.some((img) => img.name === prev.name) ? prev : null));
    setLogs(logsData.logs || []);
  }

  useEffect(() => {
    refreshAll().catch((err) => setError(err.message));
    const timer = setInterval(() => {
      refreshAll().catch((err) => setError(err.message));
    }, running ? 1000 : 3000);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    window.localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(form));
  }, [form]);

  async function handleStart(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await readJson(buildApiUrl('crawl/start'), {
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

  async function handleStop() {
    setLoading(true);
    setError('');
    try {
      await readJson(buildApiUrl('crawl/stop'), {
        method: 'POST'
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
      await readJson(buildApiUrl('images/delete-batch'), {
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
      await readJson(buildApiUrl('images/delete-batch'), {
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
      <section className="panel consolePanel card border-0">
        <div className="card-body p-3 p-lg-4">
          <div className="d-flex flex-column flex-lg-row align-items-lg-end justify-content-between gap-2 mb-3">
            <div>
              <h1 className="mb-1">Crawler Console</h1>
              <p className="muted">UI React/Vite su porta 6064.</p>
            </div>
          </div>

          <form className="consoleForm" onSubmit={handleStart}>
            <div className="row g-3">
              <div className="col-12">
                <div className="consoleGroup h-100">
                  <p className="groupTitle">Source</p>
                  <div className="row g-2">
                    <div className="col-12 col-md-4 col-xl-2">
                      <label className="form-label">Mode</label>
                      <select className="form-select form-select-sm" value={form.mode} onChange={(e) => updateField('mode', e.target.value)}>
                        <option value="pinterest">pinterest</option>
                        <option value="google">google</option>
                        <option value="site">site</option>
                      </select>
                    </div>

                    <div className="col-12 col-md-8 col-xl-4">
                      <label className="form-label">URL</label>
                      <input className="form-control form-control-sm" value={form.url} onChange={(e) => updateField('url', e.target.value)} placeholder="https://..." />
                    </div>

                    <div className="col-12 col-md-6 col-xl-3">
                      <label className="form-label">Query</label>
                      <input className="form-control form-control-sm" value={form.query} onChange={(e) => updateField('query', e.target.value)} placeholder="es: travel photography" />
                    </div>

                    <div className="col-12 col-md-6 col-xl-3">
                      <label className="form-label">Cookie</label>
                      <input className="form-control form-control-sm" value={form.cookie} onChange={(e) => updateField('cookie', e.target.value)} placeholder="sessionid=...; csrftoken=..." />
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-12 col-xl-7">
                <div className="consoleGroup h-100">
                  <p className="groupTitle">Limits</p>
                  <div className="row g-2">
                    <div className="col-6 col-md-4 col-xl">
                      <label className="form-label">Depth</label>
                      <input className="form-control form-control-sm" type="number" min="0" value={form.depth} onChange={(e) => updateField('depth', Number(e.target.value))} />
                    </div>

                    <div className="col-6 col-md-4 col-xl">
                      <label className="form-label">Min Width</label>
                      <input className="form-control form-control-sm" type="number" min="1" value={form.minWidth} onChange={(e) => updateField('minWidth', Number(e.target.value))} />
                    </div>

                    <div className="col-6 col-md-4 col-xl">
                      <label className="form-label">Quality</label>
                      <input className="form-control form-control-sm" type="number" min="1" max="100" value={form.quality} onChange={(e) => updateField('quality', Number(e.target.value))} />
                    </div>

                    <div className="col-6 col-md-6 col-xl">
                      <label className="form-label">Max Images</label>
                      <input className="form-control form-control-sm" type="number" min="1" value={form.maxImages} onChange={(e) => updateField('maxImages', Number(e.target.value))} />
                    </div>

                    <div className="col-6 col-md-6 col-xl">
                      <label className="form-label">Max Scrolls</label>
                      <input className="form-control form-control-sm" type="number" min="1" value={form.maxScrolls} onChange={(e) => updateField('maxScrolls', Number(e.target.value))} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-12 col-xl-5">
                <div className="consoleGroup h-100">
                  <p className="groupTitle">Options</p>
                  <div className="row g-2">
                    <div className="col-12 col-sm-6">
                      <div className="form-check">
                        <input className="form-check-input" id="sameOrigin" type="checkbox" checked={form.sameOrigin} onChange={(e) => updateField('sameOrigin', e.target.checked)} />
                        <label className="form-check-label" htmlFor="sameOrigin">same-origin</label>
                      </div>
                    </div>

                    <div className="col-12 col-sm-6">
                      <div className="form-check">
                        <input className="form-check-input" id="headful" type="checkbox" checked={form.headful} onChange={(e) => updateField('headful', e.target.checked)} />
                        <label className="form-check-label" htmlFor="headful">headful browser</label>
                      </div>
                    </div>

                    <div className="col-12">
                      <div className="form-check">
                        <input className="form-check-input" id="clearImagesBeforeStart" type="checkbox" checked={form.clearImagesBeforeStart} onChange={(e) => updateField('clearImagesBeforeStart', e.target.checked)} />
                        <label className="form-check-label" htmlFor="clearImagesBeforeStart">cancella immagini prima della ricerca</label>
                      </div>
                    </div>

                    <div className="col-12">
                      <div className="form-check">
                        <input className="form-check-input" id="recompress" type="checkbox" checked={form.recompress} onChange={(e) => updateField('recompress', e.target.checked)} />
                        <label className="form-check-label" htmlFor="recompress">ricompressione immagini</label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-12 col-xl-8">
                <div className="consoleGroup h-100">
                  <p className="groupTitle">Status</p>
                  <div className="status">
                    <strong>Status:</strong>{' '}
                    {running ? 'RUNNING' : 'IDLE'}
                    {status?.startedAt ? ` | start: ${status.startedAt}` : ''}
                    {status?.endedAt ? ` | end: ${status.endedAt}` : ''}
                    {status?.exitCode !== null && status?.exitCode !== undefined ? ` | code: ${status.exitCode}` : ''}
                  </div>
                </div>
              </div>

              <div className="col-12 col-xl-4">
                <div className="consoleGroup h-100">
                  <p className="groupTitle">Actions</p>
                  <div className="d-grid gap-2 d-sm-flex justify-content-sm-end">
                    <button className="btn btn-dark btn-sm" type="submit" disabled={!canStart || loading}>
                      {running ? 'Crawler in esecuzione...' : loading ? 'Avvio...' : 'Avvia Ricerca'}
                    </button>
                    <button className="btn btn-outline-dark btn-sm" type="button" disabled={!running || loading} onClick={handleStop}>
                      Stop
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </form>

          {error ? <p className="error mt-2 mb-0">{error}</p> : null}

          <div className="progressBlock mt-3">
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
        </div>
      </section>

      <details className="panel collapsible">
        <summary>Report</summary>
        <pre>{JSON.stringify(report, null, 2)}</pre>
      </details>

      <details className="panel collapsible">
        <summary>Activity Log</summary>
        <div className="logs">
          {logs.map((line, idx) => (
            <div key={`${idx}-${line}`}>{line}</div>
          ))}
        </div>
      </details>

      <section className="imageStream">
        <div className="galleryTools">
          <h2>Immagini Scaricate ({images.length})</h2>
          <span>Selezionate: {selectedImages.length}</span>
          <button type="button" className="dangerBtn" disabled={selectedImages.length === 0 || deleting} onClick={deleteSelectedImages}>
            Cestino: Elimina Selezionate
          </button>
        </div>
        <div className="imageRail">
          {images.map((img) => (
            <article key={img.name} className="imageCard">
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
                src={buildImageUrl(img.name)}
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

      {previewImage ? (
        <section className="previewOverlay" onClick={() => setPreviewImage(null)}>
          <article className="previewPanel" onClick={(e) => e.stopPropagation()}>
            <header>
              <strong>{previewImage.name}</strong>
              <button type="button" onClick={() => setPreviewImage(null)}>Chiudi</button>
            </header>
            <img src={buildImageUrl(previewImage.name)} alt={previewImage.name} />
          </article>
        </section>
      ) : null}
    </main>
  );
}
