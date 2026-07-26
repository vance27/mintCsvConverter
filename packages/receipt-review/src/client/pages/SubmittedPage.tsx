interface SubmittedPageProps {
  aggregate: Record<string, number>;
  auditPath: string;
  onBackToQueue: () => void;
}

export function SubmittedPage({ aggregate, auditPath, onBackToQueue }: SubmittedPageProps) {
  return (
    <main>
      <h1>Receipt submitted</h1>
      <p>Aggregate split: {Object.entries(aggregate).map(([name, pct]) => `${name} ${pct}%`).join(', ')}</p>
      <p>
        Audit copy written to <code>{auditPath}</code>.
      </p>
      <button onClick={onBackToQueue}>Back to queue</button>
    </main>
  );
}
