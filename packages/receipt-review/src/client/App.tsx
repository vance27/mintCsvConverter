import { useState } from 'react';
import { UploadPage } from './pages/UploadPage.js';
import { ReviewQueuePage } from './pages/ReviewQueuePage.js';
import { ReceiptReviewPage } from './pages/ReceiptReviewPage.js';

type View = { name: 'upload' } | { name: 'queue' } | { name: 'review'; receiptId: number };

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
        onSubmitted={() => setView({ name: 'queue' })}
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
