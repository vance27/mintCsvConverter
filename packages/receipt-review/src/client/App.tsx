import { useState } from 'react';
import { UploadPage } from './pages/UploadPage.js';

export function App() {
  const [uploadsDone, setUploadsDone] = useState(false);

  if (uploadsDone) {
    // The review queue page lands in the next commit — this is a
    // placeholder handoff point so the upload flow is testable end-to-end
    // on its own first.
    return (
      <main>
        <h1>Uploads complete</h1>
        <p>Review queue coming soon.</p>
      </main>
    );
  }

  return <UploadPage onDone={() => setUploadsDone(true)} />;
}
