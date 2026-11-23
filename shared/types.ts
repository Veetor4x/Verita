export type Verdict = 'SAFE' | 'CAREFUL' | 'SCAM';
export type CheckKind = 'LINK' | 'CLAIM' | 'PAYMENT' | 'REVIEW';
export type Receipt = { intent: string; minerId: string; costUsd: number; signalHash: string; receiptHash?: string; round: 1 | 2 };
export type CheckResult = {
  id: string; kind: CheckKind; input: string;
  verdict: Verdict; reasons: string[]; // max 3
  officialCheck: { status: 'FOUND' | 'CLOSE' | 'NOT_FOUND'; links: string[]; officialSite?: string; officialHandle?: string };
  details: {
    sources: string[]; miners: string[]; receipts: Receipt[]; totalCostUsd: number; cached: boolean;
    /** Claims (3) and reviews (2): real URLs returned by miners, never invented. */
    sourceLinks?: string[];
    /** Payments: label/value lines to show (Network, Status, From, To, Type, Amount). */
    facts?: { label: string; value: string }[];
  };
  createdAt: number;
};
