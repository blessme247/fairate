import { useCallback, useEffect, useState } from 'react';

import { describeWalletError } from './errors';
import { connect as connectWallet, ensureSepolia, hasInjectedWallet } from './wallet';

export type WalletState = {
  account: string | null;
  available: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
};

export function useWallet(): WalletState {
  const [account, setAccount] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = hasInjectedWallet();

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const next = await connectWallet();
      await ensureSepolia();
      setAccount(next);
    } catch (cause) {
      // A cancelled request is not a failure worth surfacing — describeWalletError returns null.
      setError(describeWalletError(cause));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAccount(null);
    setError(null);
  }, []);

  // Follow the wallet's own account switching rather than going stale behind it.
  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum?.on) return;

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      setAccount(accounts?.length ? accounts[0] : null);
    };

    ethereum.on('accountsChanged', onAccountsChanged);
    return () => ethereum.removeListener?.('accountsChanged', onAccountsChanged);
  }, []);

  return { account, available, connecting, error, connect, disconnect };
}
