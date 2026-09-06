/**
 * Turns whatever a wallet threw into something a person can read.
 *
 * Wallets do not throw `Error` instances. MetaMask rejects with a plain object like
 * `{ code: 4001, message: 'User rejected the request.' }`, and ethers wraps provider failures
 * again under `info.error`. Passing any of those to `String()` yields `[object Object]`, so each
 * shape has to be unwrapped deliberately.
 *
 * Returns `null` when the user simply cancelled — that is not an error worth reporting back to
 * them, they know what they did.
 */
export function describeWalletError(cause: unknown): string | null {
  const rejectionCodes = new Set([4001, 'ACTION_REJECTED']);

  const codes = new Set<unknown>();
  const messages: string[] = [];

  const visit = (value: unknown, depth: number): void => {
    if (depth > 3 || value === null || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;

    if (typeof record.code === 'number' || typeof record.code === 'string') codes.add(record.code);
    if (typeof record.shortMessage === 'string') messages.push(record.shortMessage);
    if (typeof record.message === 'string') messages.push(record.message);

    visit(record.info, depth + 1);
    visit(record.error, depth + 1);
    visit(record.cause, depth + 1);
  };

  visit(cause, 0);

  for (const code of codes) {
    if (rejectionCodes.has(code as number | string)) return null;
  }

  const message = messages.find((entry) => entry.trim().length > 0);
  if (message && /user rejected|user denied|rejected the request/i.test(message)) return null;
  if (message) return message.length > 160 ? `${message.slice(0, 157)}…` : message;

  if (typeof cause === 'string' && cause.trim()) return cause;
  return 'Wallet request failed';
}
