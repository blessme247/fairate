import type { AttestationInfo, Transfer } from '../api';

type Props = {
  transfers: Transfer[];
  attestation: AttestationInfo | null;
  explorers?: { source: string; creditcoin: string };
};

const STEPS = ['Deposited', 'Rate attested', 'Deposit attested', 'Released'] as const;

/**
 * How far through the four stages a transfer is.
 *
 * The rate is attested in the same transaction as the deposit, so those two stages complete
 * together — the tracker still shows them separately because they are distinct guarantees, and a
 * viewer should see that the rate was proved, not merely quoted.
 */
function stageOf(transfer: Transfer): number {
  if (transfer.status === 'released') return 4;
  if (transfer.status === 'failed') return -1;
  return 2;
}

function attestationProgress(transfer: Transfer, attestation: AttestationInfo | null): number {
  if (transfer.status === 'released') return 1;
  if (!attestation) return 0;
  const remaining = transfer.blockNumber - attestation.attestedHeight;
  if (remaining <= 0) return 0.98;
  // A deposit typically sits ~40 blocks ahead of the attested head when it lands.
  return Math.min(0.95, Math.max(0.04, 1 - remaining / 45));
}

export function TransferTimeline({ transfers, attestation, explorers }: Props) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Transfers</h2>
        {attestation && (
          <span className="pill mono" title="Sepolia blocks not yet attested on Creditcoin">
            oracle lag {attestation.lag}
          </span>
        )}
      </div>

      {transfers.length === 0 ? (
        <p className="empty">
          No transfers yet. Send one and watch it settle — attestation takes roughly 8 minutes, which is the protocol
          waiting out source-chain reversion risk.
        </p>
      ) : (
        <ul className="transfers">
          {transfers.map((transfer, index) => {
            const stage = stageOf(transfer);
            const progress = attestationProgress(transfer, attestation);

            return (
              <li className="transfer" key={transfer.id} style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}>
                <div className="transfer-head">
                  <div>
                    <div className="transfer-amount mono">
                      {Number(transfer.amount).toLocaleString()} mUSD
                      <span className="transfer-arrow" aria-hidden="true">
                        →
                      </span>
                      {transfer.payout
                        ? `${Number(transfer.payout).toLocaleString(undefined, { maximumFractionDigits: 2 })} fNGN`
                        : `≈ ${(Number(transfer.amount) * Number(transfer.rate)).toLocaleString(undefined, { maximumFractionDigits: 2 })} fNGN`}
                    </div>
                    <div className="transfer-meta mono">
                      to {transfer.receiver.slice(0, 8)}…{transfer.receiver.slice(-6)} · rate{' '}
                      {Number(transfer.rate).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </div>
                  </div>
                  <span className={`status status-${transfer.status}`}>
                    {transfer.status === 'attesting' ? 'attesting' : transfer.status}
                  </span>
                </div>

                <ol className="steps" data-stage={stage}>
                  {STEPS.map((label, stepIndex) => {
                    const done = stage > stepIndex;
                    const active = stage === 2 && stepIndex === 2;
                    return (
                      <li key={label} className={`step${done ? ' step-done' : ''}${active ? ' step-active' : ''}`}>
                        <span className="step-dot" aria-hidden="true" />
                        <span className="step-label">{label}</span>
                      </li>
                    );
                  })}
                </ol>

                {stage === 2 && (
                  <div
                    className="progress"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress * 100)}
                  >
                    <div className="progress-fill" style={{ transform: `scaleX(${progress})` }} />
                  </div>
                )}

                {transfer.error && <p className="transfer-error">{transfer.error}</p>}

                <div className="transfer-links mono">
                  {explorers && (
                    <a href={`${explorers.source}${transfer.depositTx}`} target="_blank" rel="noreferrer">
                      deposit ↗
                    </a>
                  )}
                  {explorers && transfer.releaseTx && (
                    <a href={`${explorers.creditcoin}${transfer.releaseTx}`} target="_blank" rel="noreferrer">
                      release ↗
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
