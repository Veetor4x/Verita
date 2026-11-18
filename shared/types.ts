export type Verdict = 'SAFE' | 'CAREFUL' | 'SCAM';
export type CheckKind = 'LINK' | 'CLAIM' | 'PAYMENT';
export type Receipt = { intent: string; minerId: string; costUsd: number; signalHash: string; receiptHash?: string; round: 1 | 2 };
export type CheckResult = {
  id: string; kind: CheckKind; input: string;
  verdict: Verdict; reasons: string[]; // max 3
  officialCheck: { status: 'FOUND' | 'CLOSE' | 'NOT_FOUND'; links: string[]; officialSite?: string; officialHandle?: string };
  details: { sources: string[]; miners: string[]; receipts: Receipt[]; totalCostUsd: number; cached: boolean };
  createdAt: number;
};
