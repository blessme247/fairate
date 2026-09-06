import type { AttestationInfo, RateInfo } from '../api';

type Props = { rate: RateInfo | null; attestation: AttestationInfo | null };

function freshness(rate: RateInfo): { label: string; tone: 'ok' | 'warn' } {
  const hours = rate.ageSeconds / 3600;
  const limitHours = rate.stalenessLimitSeconds / 3600;
  if (hours < 1) return { label: `${Math.max(1, Math.round(rate.ageSeconds / 60))} min ago`, tone: 'ok' };
  if (hours < limitHours * 0.75) return { label: `${Math.round(hours)}h ago`, tone: 'ok' };
  return { label: `${Math.round(hours)}h ago — nearing staleness`, tone: 'warn' };
}

export function RateCard({ rate, attestation }: Props) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Oracle</h2>
        {rate && <span className="pill mono">{rate.pair}</span>}
      </div>

      <div className="rate-value mono">
        {rate ? Number(rate.rate).toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—'}
      </div>
      <p className="rate-caption">
        {rate ? (
          <>
            Published{' '}
            <span className={freshness(rate).tone === 'warn' ? 'tone-warn' : undefined}>{freshness(rate).label}</span>.
            Readings older than {rate.stalenessLimitSeconds / 3600}h are refused rather than used.
          </>
        ) : (
          'Waiting for the rate feed…'
        )}
      </p>

      <dl className="stats">
        <div>
          <dt>Sepolia head</dt>
          <dd className="mono">{attestation?.sourceHead.toLocaleString() ?? '—'}</dd>
        </div>
        <div>
          <dt>Attested on Creditcoin</dt>
          <dd className="mono">{attestation?.attestedHeight.toLocaleString() ?? '—'}</dd>
        </div>
      </dl>

      <p className="rate-note">
        The rate is emitted into the same Sepolia transaction as the deposit, so one proof covers both. A payout cannot
        be priced at a rate the oracle never attested.
      </p>
    </section>
  );
}
