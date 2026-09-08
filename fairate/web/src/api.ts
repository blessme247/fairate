export type TransferStatus = 'queued' | 'deposited' | 'attesting' | 'released' | 'failed';

export type BatchSummary = {
  tx: string;
  size: number;
  gasUsed: string;
  gasPerTransfer: string;
};

export type Transfer = {
  id: string;
  depositTx: string;
  blockNumber: number;
  sender: string;
  receiver: string;
  amount: string;
  rate: string;
  status: TransferStatus;
  releaseTx?: string;
  payout?: string;
  error?: string;
  createdAt: number;
  batch?: BatchSummary;
};

export type RateInfo = {
  rate: string;
  pair: string;
  updatedAt: number;
  ageSeconds: number;
  stalenessLimitSeconds: number;
};

export type Reputation = {
  transfersSent: number;
  transfersReceived: number;
  volumeSent: string;
  volumeReceived: string;
  firstSeenBlock: number;
};

export type StatusInfo = {
  address: string;
  symbol: string;
  balance: string;
  reputation: Reputation;
};

export type AttestationInfo = { sourceHead: number; attestedHeight: number; lag: number };

export type ConfigInfo = {
  sender: string;
  addresses: Record<string, string>;
  explorers: { source: string; creditcoin: string };
};

/**
 * Where the API lives.
 *
 * Empty in development, so Vite's proxy handles `/api/*`. In a deployed build the UI and the API
 * are on different hosts — the UI is static and the API needs a long-running Node process — so
 * this is baked in at build time via VITE_API_BASE_URL.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok || body.error) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

export const api = {
  rate: () => request<RateInfo>('/api/rate'),
  attestation: () => request<AttestationInfo>('/api/attestation'),
  transfers: () => request<{ transfers: Transfer[] }>('/api/transfers'),
  status: (address?: string) => request<StatusInfo>(`/api/status${address ? `?address=${address}` : ''}`),
  config: () => request<ConfigInfo>('/api/config'),
  track: (txHash: string, queue = false) =>
    request<{ transfer: Transfer }>('/api/track', {
      method: 'POST',
      body: JSON.stringify({ txHash, queue }),
    }),
  deposit: (receiver: string, amount: string, queue = false) =>
    request<{ transfer: Transfer }>('/api/deposit', {
      method: 'POST',
      body: JSON.stringify({ receiver, amount, queue }),
    }),
  settleBatch: (ids: string[]) =>
    request<{ batched: number }>('/api/settle-batch', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
};
