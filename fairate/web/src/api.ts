export type TransferStatus = 'deposited' | 'attesting' | 'released' | 'failed';

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
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
  track: (txHash: string) =>
    request<{ transfer: Transfer }>('/api/track', {
      method: 'POST',
      body: JSON.stringify({ txHash }),
    }),
  deposit: (receiver: string, amount: string) =>
    request<{ transfer: Transfer }>('/api/deposit', {
      method: 'POST',
      body: JSON.stringify({ receiver, amount }),
    }),
};
