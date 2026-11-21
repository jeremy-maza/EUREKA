import { useEffect, useState } from 'react';

type Status = 'checking' | 'up' | 'down';

const LABELS: Record<Status, string> = {
  checking: 'Comprobando conexión con el servidor…',
  up: 'Servidor conectado',
  down: 'Servidor no disponible',
};

export function ApiStatus() {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then((response) => setStatus(response.ok ? 'up' : 'down'))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('down');
      });
    return () => controller.abort();
  }, []);

  return (
    <p className={`api-status api-status--${status}`} role="status">
      {LABELS[status]}
    </p>
  );
}
