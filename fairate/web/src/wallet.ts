import { BrowserProvider, Contract, ethers, type Eip1193Provider } from 'ethers';

import FairateDepositABI from '../../contracts/abi/FairateDeposit.json';
import MockUSDABI from '../../contracts/abi/MockUSD.json';

declare global {
  interface Window {
    ethereum?: Eip1193Provider & {
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

export const SEPOLIA = {
  chainId: '0xaa36a7', // 11155111
  chainName: 'Ethereum Sepolia',
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
};

export const CREDITCOIN = {
  chainId: '0x18e8f', // 102031
  chainName: 'Creditcoin CC3 Testnet',
  nativeCurrency: { name: 'Creditcoin', symbol: 'CTC', decimals: 18 },
  rpcUrls: ['https://rpc.cc3-testnet.creditcoin.network'],
  blockExplorerUrls: ['https://creditcoin-testnet.blockscout.com'],
};

export function hasInjectedWallet(): boolean {
  return typeof window !== 'undefined' && Boolean(window.ethereum);
}

export async function connect(): Promise<string> {
  if (!window.ethereum) throw new Error('No browser wallet found. Install MetaMask, or use the demo wallet.');

  const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts?.length) throw new Error('Wallet returned no accounts');
  return ethers.getAddress(accounts[0]);
}

type ChainSpec = typeof SEPOLIA;

/**
 * Leaves the wallet *actively on* the given chain, adding it first if unknown.
 *
 * Adding a network and switching to it are separate operations, and approving an add does not
 * reliably leave the wallet on that network. Returning after the add is what made a freshly
 * registered token invisible until the user changed networks by hand, so the switch is always
 * re-attempted afterwards.
 */
async function ensureChain(chain: ChainSpec): Promise<void> {
  const ethereum = window.ethereum;
  if (!ethereum) throw new Error('No browser wallet found');

  const switchChain = () =>
    ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chain.chainId }],
    });

  try {
    await switchChain();
  } catch (error: unknown) {
    // 4902 = chain unknown to the wallet. Anything else is a real failure (including user reject).
    const code = (error as { code?: number })?.code;
    if (code !== 4902) throw error;

    await ethereum.request({ method: 'wallet_addEthereumChain', params: [chain] });
    // Some wallets switch as part of the add and some do not; asking again settles it either way.
    await switchChain();
  }

  await waitForChain(chain.chainId);
}

/**
 * Waits for the wallet to report the expected chain.
 *
 * `wallet_switchEthereumChain` resolves when the request is accepted, not when the provider has
 * finished switching. Registering a token in that gap files it under the previous network.
 */
async function waitForChain(chainId: string, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const current = (await window.ethereum?.request({ method: 'eth_chainId' })) as string | undefined;
    if (current?.toLowerCase() === chainId.toLowerCase()) return;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

export const ensureSepolia = () => ensureChain(SEPOLIA);

/**
 * Makes the payout visible in the user's wallet.
 *
 * Two separate reasons fNGN does not show up on its own: it lives on Creditcoin, not the Sepolia
 * network the sender is connected to, and wallets do not display unknown ERC-20s until they are
 * explicitly registered. So this switches networks first, then registers the token — doing only
 * the second would silently attach the token to whatever chain happened to be selected.
 */
export async function showPayoutTokenInWallet(tokenAddress: string): Promise<void> {
  if (!window.ethereum) throw new Error('No browser wallet found');

  await ensureChain(CREDITCOIN);
  await window.ethereum.request({
    method: 'wallet_watchAsset',
    params: {
      type: 'ERC20',
      options: { address: tokenAddress, symbol: 'fNGN', decimals: 18 },
    },
  });
}

export type DepositProgress = 'minting' | 'approving' | 'depositing';

/**
 * Signs the whole source-chain half of a transfer with the user's own wallet.
 *
 * mUSD is mock money with an open `mint()`, so a connected wallet with no balance is topped up
 * rather than being sent to hunt for a faucet. Each step is skipped when it is unnecessary, so a
 * returning sender signs exactly one transaction.
 */
export async function depositWithWallet(
  stablecoinAddress: string,
  depositAddress: string,
  receiver: string,
  amount: string,
  onProgress: (step: DepositProgress) => void
): Promise<string> {
  if (!window.ethereum) throw new Error('No browser wallet found');

  await ensureSepolia();

  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const account = await signer.getAddress();
  const value = ethers.parseEther(amount);

  const stablecoin = new Contract(stablecoinAddress, MockUSDABI, signer);
  const depositContract = new Contract(depositAddress, FairateDepositABI, signer);

  const balance: bigint = await stablecoin.balanceOf(account);
  if (balance < value) {
    onProgress('minting');
    await (await stablecoin.mint(value - balance)).wait();
  }

  const allowance: bigint = await stablecoin.allowance(account, depositAddress);
  if (allowance < value) {
    onProgress('approving');
    await (await stablecoin.approve(depositAddress, value)).wait();
  }

  onProgress('depositing');
  const tx = await depositContract.deposit(receiver, value);
  await tx.wait();

  return tx.hash as string;
}
