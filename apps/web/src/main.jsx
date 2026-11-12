import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  const [status, setStatus] = useState('Checking API and database connection…');

  useEffect(() => {
    const controller = new AbortController();

    async function checkConnection() {
      try {
        const response = await fetch('/api/ready', { signal: controller.signal });

        if (response.ok) {
          setStatus('API and database connected.');
        } else if (response.status === 503) {
          setStatus('API is online. Database is unavailable.');
        } else {
          setStatus('API is unavailable.');
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          setStatus('API is unavailable.');
        }
      }
    }

    checkConnection();
    return () => controller.abort();
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Good Faith Estimator
      </h1>
      <p role="status" className="mt-6 border-t border-slate-300 pt-5 text-slate-700">
        {status}
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
