import { useMemo, useState } from 'react';

import type { RateInfo } from '../api';
import type { DepositProgress } from '../wallet';

type Props = {
  rate: RateInfo | null;
  sender?: string;
  account: string | null;
  onSend: (receiver: string, amount: string, useWallet: boolean, queue: boolean) => Promise<void>;
  walletStep: DepositProgress | null;
  onConnect: () => Promise<void>;
  walletAvailable: boolean;
};

const PRESETS = ['50', '100', '250'];

const STEP_LABEL: Record<DepositProgress, string> = {
  minting: 'Minting mUSD…',
  approving: 'Approving…',
  depositing: 'Locking funds…',
};

export function SendForm({ rate, sender, account, onSend, walletStep, onConnect, walletAvailable }: Props) {
  const [receiver, setReceiver] = useState('');
  const [amount, setAmount] = useState('100');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useWallet, setUseWallet] = useState(true);
  const [queue, setQueue] = useState(false);

  // Signing with your own wallet is only possible once one is connected.
  const signWithWallet = useWallet && Boolean(account);
  const payer = signWithWallet ? account : sender;

  const payout = useMemo(() => {
    const parsedAmount = Number(amount);
    const parsedRate = Number(rate?.rate ?? 0);
    if (!Number.isFinite(parsedAmount) || !parsedRate) return null;
    return parsedAmount * parsedRate;
  }, [amount, rate]);

  const valid = /^0x[0-9a-fA-F]{40}$/.test(receiver) && Number(amount) > 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(receiver, amount, signWithWallet, queue);
      setReceiver('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Send money</h2>
        {payer && (
          <span className="pill mono" title={payer}>
            from {payer.slice(0, 6)}…{payer.slice(-4)}
          </span>
        )}
      </div>

      <div className="segmented" role="group" aria-label="Who signs the deposit">
        <button
          type="button"
          className={`segment${signWithWallet ? ' segment-on' : ''}`}
          onClick={() => {
            setUseWallet(true);
            if (!account) void onConnect();
          }}
          disabled={!walletAvailable && !account}
          title={walletAvailable || account ? undefined : 'No browser wallet detected'}
        >
          Your wallet
        </button>
        <button
          type="button"
          className={`segment${!signWithWallet ? ' segment-on' : ''}`}
          onClick={() => setUseWallet(false)}
        >
          Demo wallet
        </button>
      </div>

      <form onSubmit={submit}>
        <label className="field">
          <span className="field-label">Receiver address on Creditcoin</span>
          <input
            className="input mono"
            value={receiver}
            onChange={(event) => setReceiver(event.target.value.trim())}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
          />
        </label>

        <label className="field">
          <span className="field-label">You send</span>
          <div className="amount-row">
            <div className="amount-input">
              <input
                className="input input-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
              />
              <span className="amount-unit">mUSD</span>
            </div>
            <div className="presets">
              {PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset}
                  className={`preset${amount === preset ? ' preset-on' : ''}`}
                  onClick={() => setAmount(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        </label>

        <div className="quote">
          <div className="quote-row">
            <span>Rate</span>
            <span className="mono">
              {rate ? `${Number(rate.rate).toLocaleString(undefined, { maximumFractionDigits: 4 })}` : '—'}
              {rate && <em className="quote-pair"> {rate.pair}</em>}
            </span>
          </div>
          <div className="quote-row quote-total">
            <span>Receiver gets</span>
            <span className="mono">
              {payout === null ? '—' : payout.toLocaleString(undefined, { maximumFractionDigits: 2 })} <em>fNGN</em>
            </span>
          </div>
        </div>

        <label className="checkline">
          <input type="checkbox" checked={queue} onChange={(event) => setQueue(event.target.checked)} />
          <span>
            Queue for batch settlement
            <em>Hold it back so several transfers can share one proof.</em>
          </span>
        </label>

        {error && <p className="form-error">{error}</p>}

        <button className="button button-primary" type="submit" disabled={!valid || busy}>
          <span className={busy ? 'button-label is-busy' : 'button-label'}>
            {busy
              ? walletStep
                ? STEP_LABEL[walletStep]
                : 'Locking funds…'
              : queue
                ? 'Queue transfer'
                : 'Send transfer'}
          </span>
        </button>
        <p className="form-hint">
          Locks mUSD on Sepolia and records the rate in the same transaction, so both are proved together.
          {signWithWallet
            ? ' You sign the deposit; settlement on Creditcoin is permissionless and runs automatically.'
            : ' Signed by the demo wallet — pick “Your wallet” to sign it yourself.'}
        </p>
      </form>
    </section>
  );
}
