import type { WalletState } from '../useWallet';

type Props = { wallet: WalletState };

export function WalletBar({ wallet }: Props) {
  const { account, available, connecting, error, connect, disconnect } = wallet;

  return (
    <div className="walletbar">
      {account ? (
        <>
          <span className="wallet-dot" aria-hidden="true" />
          <span className="mono wallet-address" title={account}>
            {account.slice(0, 6)}…{account.slice(-4)}
          </span>
          <button className="linkbutton" type="button" onClick={disconnect}>
            disconnect
          </button>
        </>
      ) : (
        <button
          className="button button-ghost button-connect"
          type="button"
          onClick={() => void connect()}
          disabled={connecting || !available}
          title={available ? undefined : 'No browser wallet detected'}
        >
          <span className={connecting ? 'button-label is-busy' : 'button-label'}>
            {connecting ? 'Connecting…' : available ? 'Connect wallet' : 'No wallet found'}
          </span>
        </button>
      )}
      {error && <span className="wallet-error">{error}</span>}
    </div>
  );
}
