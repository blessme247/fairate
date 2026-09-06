import { useState } from 'react';

import type { StatusInfo } from '../api';
import { describeWalletError } from '../errors';
import { showPayoutTokenInWallet } from '../wallet';

type Props = {
  status: StatusInfo | null;
  onWatch: (address: string) => void;
  payoutToken?: string;
  walletConnected: boolean;
};

export function ReputationCard({ status, onWatch, payoutToken, walletConnected }: Props) {
  const [draft, setDraft] = useState('');
  const [addingToken, setAddingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  async function addToWallet() {
    if (!payoutToken) return;
    setAddingToken(true);
    setTokenError(null);
    try {
      await showPayoutTokenInWallet(payoutToken);
    } catch (cause) {
      setTokenError(describeWalletError(cause));
    } finally {
      setAddingToken(false);
    }
  }

  const total = status ? status.reputation.transfersSent + status.reputation.transfersReceived : 0;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Credit record</h2>
        {status && <span className="pill mono">{status.symbol}</span>}
      </div>

      <form
        className="lookup"
        onSubmit={(event) => {
          event.preventDefault();
          if (/^0x[0-9a-fA-F]{40}$/.test(draft)) onWatch(draft);
        }}
      >
        <input
          className="input mono input-sm"
          value={draft}
          onChange={(event) => setDraft(event.target.value.trim())}
          placeholder={status?.address ?? '0x…'}
          spellCheck={false}
        />
        <button className="button button-ghost" type="submit">
          Look up
        </button>
      </form>

      {status ? (
        <>
          <div className="balance-row">
            <div className="balance mono">
              {Number(status.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              <span className="balance-unit">{status.symbol}</span>
            </div>
            {walletConnected && payoutToken && (
              <button
                className="button button-ghost button-token"
                type="button"
                onClick={() => void addToWallet()}
                disabled={addingToken}
                title="Adds the Creditcoin network and registers fNGN so your wallet displays it"
              >
                <span className={addingToken ? 'button-label is-busy' : 'button-label'}>
                  {addingToken ? 'Opening wallet…' : 'Show in wallet'}
                </span>
              </button>
            )}
          </div>
          {tokenError && <p className="form-error">{tokenError}</p>}

          <dl className="stats stats-quad">
            <div>
              <dt>Sent</dt>
              <dd className="mono">{status.reputation.transfersSent}</dd>
            </div>
            <div>
              <dt>Received</dt>
              <dd className="mono">{status.reputation.transfersReceived}</dd>
            </div>
            <div>
              <dt>Volume out</dt>
              <dd className="mono">
                {Number(status.reputation.volumeSent).toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
              </dd>
            </div>
            <div>
              <dt>Volume in</dt>
              <dd className="mono">
                {Number(status.reputation.volumeReceived).toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
              </dd>
            </div>
          </dl>

          <p className="rate-note">
            {total === 0
              ? 'No attested activity yet for this address.'
              : `${total} proof-backed transfer${total === 1 ? '' : 's'}, first seen at block ${status.reputation.firstSeenBlock.toLocaleString()}. Built only from settlements the oracle verified — nothing self-reported.`}
          </p>
        </>
      ) : (
        <p className="empty">Waiting for an address…</p>
      )}
    </section>
  );
}
