import { useCallback, useLayoutEffect, useRef, useState } from 'react';

const DOWNLOAD_PATH = '/api/workspace/data-export';
const GENERIC_ERROR = 'The download could not be started. Check your sign-in and try again.';
type DownloadState = { phase: 'idle' | 'requested' | 'stopped' | 'timeout' | 'error'; message?: string };
type PendingDownload = { frame: HTMLIFrameElement; timer?: ReturnType<typeof setTimeout> };

/** Native attachments stay out of the app's JSON/Blob heap. Only a short error
 * document is inspected; an attachment does not load into the frame document. */
function readError(frame: HTMLIFrameElement): string | undefined {
  const doc = frame.contentDocument;
  if (!doc || doc.URL === 'about:blank') return undefined;
  if (new URL(doc.URL).origin !== window.location.origin || doc.contentType !== 'application/json') return GENERIC_ERROR;
  const container = doc.querySelector('pre') ?? doc.body;
  const node = container?.firstChild;
  if (!container || !node || node.nodeType !== Node.TEXT_NODE || container.childNodes.length !== 1 || (node as Text).length > 4096) return GENERIC_ERROR;
  try {
    const value: unknown = JSON.parse((node as Text).data);
    if (value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' && value.error.length <= 500) return value.error;
  } catch { /* Never display a raw response body. */ }
  return GENERIC_ERROR;
}

export function PreparedWorkspaceDownload({ timeoutMs = 120_000, endpoint = DOWNLOAD_PATH, buttonLabel = 'Download JSON', testIdPrefix, preparedFile = false }: {
  timeoutMs?: number; endpoint?: string; buttonLabel?: string; testIdPrefix?: string; preparedFile?: boolean;
}) {
  const [state, setState] = useState<DownloadState>({ phase: 'idle' });
  const pending = useRef<PendingDownload | null>(null);
  const stop = useCallback(() => {
    const request = pending.current;
    pending.current = null;
    if (!request) return;
    clearTimeout(request.timer);
    request.frame.onload = null;
    // Cancels a pending navigation before attachment headers. Once an attachment
    // is handed to the browser, its download manager owns transfer cancellation.
    request.frame.src = 'about:blank';
    request.frame.remove();
  }, []);

  // The frame lives outside React's tree: remove it synchronously when an
  // account boundary unmounts this component, before another account paints.
  useLayoutEffect(() => {
    window.addEventListener('pagehide', stop);
    return () => { window.removeEventListener('pagehide', stop); stop(); };
  }, [stop]);

  function download() {
    if (pending.current) return;
    let url: URL;
    try {
      url = new URL(endpoint, window.location.origin);
      if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/workspace/') || url.search || url.hash) throw new Error('Invalid attachment route');
    } catch { setState({ phase: 'error', message: GENERIC_ERROR }); return; }
    const frame = document.createElement('iframe');
    frame.name = `valo-data-download-${crypto.randomUUID()}`;
    frame.title = 'Workspace data download';
    frame.hidden = true;
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-downloads allow-same-origin');
    const request: PendingDownload = { frame };
    pending.current = request;
    frame.onload = () => {
      if (pending.current !== request) return;
      let error: string | undefined;
      try { error = readError(frame); } catch { error = GENERIC_ERROR; }
      if (error) { stop(); setState({ phase: 'error', message: error }); }
    };
    request.timer = setTimeout(() => {
      if (pending.current !== request) return;
      stop(); setState({ phase: 'timeout' });
    }, timeoutMs);
    setState({ phase: 'requested' });
    frame.src = url.href;
    document.body.appendChild(frame);
  }

  return <div className="mt-5" data-testid={testIdPrefix ? `${testIdPrefix}-download` : 'workspace-data-download'}>
    <div className="flex flex-wrap gap-3">
      <button type="button" className="btn btn-primary" onClick={download} disabled={state.phase === 'requested'} data-testid={testIdPrefix ? `${testIdPrefix}-file` : 'button-download-workspace'}>{buttonLabel}</button>
      {state.phase === 'requested' && <button type="button" className="btn btn-ghost" onClick={() => { stop(); setState({ phase: 'stopped' }); }} data-testid={testIdPrefix ? `${testIdPrefix}-stop-download` : 'button-cancel-workspace-download'}>{preparedFile ? 'Stop waiting' : 'Cancel preparation'}</button>}
    </div>
    {state.phase === 'requested' && <p role="status" className="mt-3 text-sm">Download requested; check browser downloads. This page cannot confirm that a file was saved.</p>}
    {state.phase === 'stopped' && <p role="status" className="mt-3 text-sm">Stopped this page's request. Cancel any transfer that already started in your browser.</p>}
    {state.phase === 'timeout' && <p role="status" className="mt-3 text-sm">Stopped waiting for the download. Check browser downloads before trying again; a transfer that already started may continue there.</p>}
    {state.phase === 'error' && <p role="alert" className="mt-3 text-sm text-destructive" data-testid={testIdPrefix ? `${testIdPrefix}-download-error` : 'text-download-error'}>{state.message}</p>}
    <p className="mt-3 text-xs text-muted-foreground">{preparedFile ? 'This file is already prepared. Leaving this page stops a pending download request; it does not cancel the saved export. Use your browser to cancel a transfer that has started. Keep the file private.' : 'Preparation can take a few minutes. You can cancel preparation here; once a download starts, use your browser to cancel it. Leaving this page stops preparation. Keep any downloaded file private.'}</p>
  </div>;
}

