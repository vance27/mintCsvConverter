import { useState } from 'react';
import { UploadPage } from './pages/UploadPage.js';
import { ReviewQueuePage } from './pages/ReviewQueuePage.js';
import { ReceiptReviewPage } from './pages/ReceiptReviewPage.js';
import { SubmittedPage } from './pages/SubmittedPage.js';

type SubmitResult = { aggregate: Record<string, number>; manifestPath: string; auditPath: string };

type View =
  | { name: 'upload' }
  | { name: 'queue' }
  | { name: 'review'; receiptId: number }
  | { name: 'submitted'; result: SubmitResult };

export function App() {
  const [view, setView] = useState<View>({ name: 'queue' });

  if (view.name === 'upload') {
    return <UploadPage onDone={() => setView({ name: 'queue' })} />;
  }

  if (view.name === 'review') {
    return (
      <ReceiptReviewPage
        receiptId={view.receiptId}
        onBack={() => setView({ name: 'queue' })}
        onSubmitted={(result) => setView({ name: 'submitted', result })}
      />
    );
  }

  if (view.name === 'submitted') {
    return (
      <SubmittedPage
        aggregate={view.result.aggregate}
        auditPath={view.result.auditPath}
        onBackToQueue={() => setView({ name: 'queue' })}
      />
    );
  }

  return (
    <ReviewQueuePage
      onUpload={() => setView({ name: 'upload' })}
      onSelect={(receiptId) => setView({ name: 'review', receiptId })}
    />
  );
}
