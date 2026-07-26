import { useState } from 'react';
import { api } from '../lib/api.js';

interface FileProgress {
  file: File;
  jobId?: string;
  status: 'uploading' | 'pending' | 'done' | 'error';
  message?: string;
}

interface UploadPageProps {
  onDone: () => void;
}

const POLL_INTERVAL_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function UploadPage({ onDone }: UploadPageProps) {
  const [store, setStore] = useState('Costco');
  const [payer, setPayer] = useState('Brian');
  const [files, setFiles] = useState<FileProgress[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function pollJob(jobId: string, index: number): Promise<void> {
    for (;;) {
      const res = await api.uploads[':jobId'].$get({ param: { jobId } });
      const job = await res.json();
      if (job.status === 'done') {
        setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, status: 'done' } : f)));
        return;
      }
      if (job.status === 'error') {
        setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, status: 'error', message: job.message } : f)));
        return;
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  async function handleSubmit(selected: File[]): Promise<void> {
    setSubmitting(true);
    setFiles(selected.map((file) => ({ file, status: 'uploading' })));

    const formData = new FormData();
    for (const file of selected) {
      formData.append('files', file);
    }
    formData.append('store', store);
    formData.append('payer', payer);

    const res = await fetch('/api/uploads', { method: 'POST', body: formData });
    const { jobIds } = (await res.json()) as { jobIds: string[] };

    setFiles((prev) => prev.map((f, i) => ({ ...f, jobId: jobIds[i], status: 'pending' })));
    await Promise.all(jobIds.map((jobId, index) => pollJob(jobId, index)));
    setSubmitting(false);
  }

  const allDone = files.length > 0 && files.every((f) => f.status === 'done' || f.status === 'error');

  return (
    <main>
      <h1>Upload receipts</h1>
      <label>
        Store
        <input value={store} onChange={(e) => setStore(e.target.value)} disabled={submitting} />
      </label>
      <label>
        Payer
        <input value={payer} onChange={(e) => setPayer(e.target.value)} disabled={submitting} />
      </label>
      <input
        type="file"
        accept="application/pdf"
        multiple
        disabled={submitting}
        onChange={(e) => {
          const selected = Array.from(e.target.files ?? []);
          if (selected.length > 0) {
            void handleSubmit(selected);
          }
        }}
      />
      <ul>
        {files.map((f, i) => (
          <li key={i}>
            {f.file.name}: {f.status}
            {f.message ? ` — ${f.message}` : ''}
          </li>
        ))}
      </ul>
      {allDone ? <button onClick={onDone}>Go to review queue</button> : null}
    </main>
  );
}
