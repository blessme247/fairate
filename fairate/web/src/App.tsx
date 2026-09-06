import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, type AttestationInfo, type ConfigInfo, type RateInfo, type StatusInfo, type Transfer } from './api';
import { RateCard } from './components/RateCard';
import { SendForm } from './components/SendForm';
import { TransferTimeline } from './components/TransferTimeline';
import { ReputationCard } from './components/ReputationCard';
import { Logo } from './components/Logo';
import { WalletBar } from './components/WalletBar';
import { useWallet } from './useWallet';
import { depositWithWallet, type DepositProgress } from './wallet';

const POLL_MS = 6000;
/** A single blip is normal on public RPC; only complain once it looks persistent. */
const FAILURES_BEFORE_WARNING = 3;

/**
 * Distinguishes "the API process is not running" from "an upstream RPC was slow", because the
 * fix is completely different and a wrong diagnosis sends someone restarting a healthy server.
 */
function ConnectionBanner({ error }: { error: string }) {
  const offline = /failed to fetch|networkerror|load failed|econnrefused/i.test(error);
  const upstream = /timeout|rate limit|429|503|econnreset|server response/i.test(error);

  if (offline) {
    return (
      <div className="banner banner-danger" role="alert">
        <strong>API not running.</strong> Start it with <code>pnpm fairate:api</code>.
      </div>
    );
  }

  return (
    <div className="banner banner-warn" role="status">
      <strong>{upstream ? 'Upstream RPC is slow.' : 'Live data is stale.'}</strong>{' '}
      {upstream ? 'Sepolia or Creditcoin did not answer in time. Showing the last known values and retrying.' : error}
    </div>
  );
}

export function App() {
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [rate, setRate] = useState<RateInfo | null>(null);
  const [attestation, setAttestation] = useState<AttestationInfo | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [watched, setWatched] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const [walletStep, setWalletStep] = useState<DepositProgress | null>(null);
  const wallet = useWallet();

  const refresh = useCallback(async () => {
    try {
      const [rateInfo, attestationInfo, transferList] = await Promise.all([
        api.rate(),
        api.attestation(),
        api.transfers(),
      ]);
      setRate(rateInfo);
      setAttestation(attestationInfo);
      setTransfers(transferList.transfers);
      setError(null);
      setFailures(0);
    } catch (cause) {
      // Keep the last good data on screen; a poll failure is not a reason to blank the UI.
      setFailures((count) => count + 1);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void api
      .config()
      .then(setConfig)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // The most recent transfer's receiver is the address worth showing a credit record for.
  const focusAddress = useMemo(
    () => watched || transfers[0]?.receiver || config?.sender || '',
    [watched, transfers, config]
  );

  useEffect(() => {
    if (!focusAddress) return;
    void api
      .status(focusAddress)
      .then(setStatus)
      .catch(() => undefined);
  }, [focusAddress, transfers]);

  const onSend = useCallback(
    async (receiver: string, amount: string, signWithWallet: boolean) => {
      let transfer;

      if (signWithWallet && config) {
        // The browser signs the deposit; the server picks it up for settlement, which needs the
        // Node SDK for proof generation and is permissionless anyway.
        try {
          const txHash = await depositWithWallet(
            config.addresses.stablecoin,
            config.addresses.deposit,
            receiver,
            amount,
            setWalletStep
          );
          ({ transfer } = await api.track(txHash));
        } finally {
          setWalletStep(null);
        }
      } else {
        ({ transfer } = await api.deposit(receiver, amount));
      }

      setTransfers((current) => [transfer, ...current.filter((t) => t.id !== transfer.id)]);
      setWatched(receiver);
      void refresh();
    },
    [refresh, config]
  );

  return (
    <div className="shell">
      <header className="masthead">
        <div className="masthead-top">
          <div className="wordmark">
            <Logo />
            Fairate
          </div>
          <WalletBar wallet={wallet} />
        </div>
        <p className="tagline">
          Cross-border remittance settled by decentralised attestation — no bridge operator, no custodian.
        </p>
      </header>

      {error && (
        <div className="banner banner-danger" role="alert">
          <strong>API unreachable.</strong> {error}
          <span className="banner-hint">
            Start it with <code>pnpm fairate:api</code>.
          </span>
        </div>
      )}

      <div className="grid">
        <div className="column">
          <SendForm
            rate={rate}
            sender={config?.sender}
            account={wallet.account}
            onSend={onSend}
            walletStep={walletStep}
            onConnect={wallet.connect}
            walletAvailable={wallet.available}
          />
          <RateCard rate={rate} attestation={attestation} />
        </div>

        <div className="column">
          <TransferTimeline transfers={transfers} attestation={attestation} explorers={config?.explorers} />
          <ReputationCard
            status={status}
            onWatch={setWatched}
            payoutToken={config?.addresses.payoutToken}
            walletConnected={Boolean(wallet.account)}
          />
        </div>
      </div>

      <footer className="footnote">
        Testnet only. Sepolia deposits are proved to Creditcoin CC3 by the Attestcoin protocol; payouts are minted only
        against a verified proof.
      </footer>
    </div>
  );
}
