import { useState } from 'react';
import { AppBar, Tab, Tabs, Toolbar } from '@mui/material';
import { UploadPage } from './pages/UploadPage.js';
import { ReviewQueuePage } from './pages/ReviewQueuePage.js';
import { ReceiptReviewPage } from './pages/ReceiptReviewPage.js';
import { SubmittedPage } from './pages/SubmittedPage.js';
import { ImportPage } from './pages/ImportPage.js';
import { TransactionReviewPage } from './pages/TransactionReviewPage.js';
import { SyncOverviewPage } from './pages/SyncOverviewPage.js';
import { RulesSettingsPage } from './pages/RulesSettingsPage.js';
import { SheetEmbedPage } from './pages/SheetEmbedPage.js';

type SubmitResult = { aggregate: Record<string, number>; auditPath: string };

type View =
    | { name: 'upload' }
    | { name: 'queue' }
    | { name: 'review'; receiptId: number }
    | { name: 'submitted'; result: SubmitResult; wasUpdate: boolean }
    | { name: 'import' }
    | { name: 'transaction-review' }
    | { name: 'sync-overview' }
    | { name: 'sheet' }
    | { name: 'settings' };

type NavTabValue = 'queue' | 'import' | 'transaction-review' | 'sync-overview' | 'sheet' | 'settings';

const NAV_TABS: { value: NavTabValue; label: string }[] = [
    { value: 'queue', label: 'Receipts' },
    { value: 'import', label: 'Import' },
    { value: 'transaction-review', label: 'Review transactions' },
    { value: 'sync-overview', label: 'Sync' },
    { value: 'sheet', label: 'Sheet' },
    { value: 'settings', label: 'Settings' },
];

// 'upload'/'review'/'submitted' are sub-flows of the receipts tab — they
// don't get a tab of their own, but "Receipts" stays highlighted while in them.
function tabValueFor(view: View): NavTabValue {
    if (view.name === 'upload' || view.name === 'review' || view.name === 'submitted') {
        return 'queue';
    }
    return view.name;
}

// TS can't distribute `{ name: NavTabValue }` across the View union at a
// generic call site, so build the exact literal per case instead of a cast.
function viewForTab(value: NavTabValue): View {
    switch (value) {
        case 'queue':
            return { name: 'queue' };
        case 'import':
            return { name: 'import' };
        case 'transaction-review':
            return { name: 'transaction-review' };
        case 'sync-overview':
            return { name: 'sync-overview' };
        case 'sheet':
            return { name: 'sheet' };
        case 'settings':
            return { name: 'settings' };
    }
}

export function App() {
    const [view, setView] = useState<View>({ name: 'queue' });

    let page;
    if (view.name === 'upload') {
        page = <UploadPage onDone={() => setView({ name: 'queue' })} />;
    } else if (view.name === 'review') {
        page = (
            <ReceiptReviewPage
                receiptId={view.receiptId}
                onBack={() => setView({ name: 'queue' })}
                onSubmitted={(result, wasUpdate) => setView({ name: 'submitted', result, wasUpdate })}
            />
        );
    } else if (view.name === 'submitted') {
        page = (
            <SubmittedPage
                aggregate={view.result.aggregate}
                auditPath={view.result.auditPath}
                wasUpdate={view.wasUpdate}
                onBackToQueue={() => setView({ name: 'queue' })}
            />
        );
    } else if (view.name === 'import') {
        page = <ImportPage />;
    } else if (view.name === 'transaction-review') {
        page = <TransactionReviewPage onSelectReceipt={(receiptId) => setView({ name: 'review', receiptId })} />;
    } else if (view.name === 'sync-overview') {
        page = <SyncOverviewPage />;
    } else if (view.name === 'sheet') {
        page = <SheetEmbedPage />;
    } else if (view.name === 'settings') {
        page = <RulesSettingsPage />;
    } else {
        page = (
            <ReviewQueuePage
                onUpload={() => setView({ name: 'upload' })}
                onSelect={(receiptId) => setView({ name: 'review', receiptId })}
            />
        );
    }

    return (
        <>
            <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
                <Toolbar variant="dense">
                    <Tabs
                        value={tabValueFor(view)}
                        onChange={(_event, value: NavTabValue) => setView(viewForTab(value))}
                    >
                        {NAV_TABS.map((tab) => (
                            <Tab key={tab.value} value={tab.value} label={tab.label} />
                        ))}
                    </Tabs>
                </Toolbar>
            </AppBar>
            {page}
        </>
    );
}
