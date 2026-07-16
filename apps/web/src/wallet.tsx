import type { AnchorProvider } from "@coral-xyz/anchor";
import {
  SolanaSignTransaction,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { getWallets } from "@wallet-standard/app";
import type { Wallet as StandardWallet, WalletAccount } from "@wallet-standard/base";
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
} from "@wallet-standard/features";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const DEVNET_CHAIN = "solana:devnet" as const;
const DEVNET_RPC = "https://api.devnet.solana.com";
const LAST_WALLET_KEY = "stamp:last-wallet";

export type CompatibleWallet = StandardWallet & {
  features: StandardWallet["features"] & StandardConnectFeature & SolanaSignTransactionFeature & Partial<StandardDisconnectFeature & StandardEventsFeature>;
};

type AnchorWallet = ConstructorParameters<typeof AnchorProvider>[1];

type StampWalletContextValue = {
  account: WalletAccount | null;
  anchorWallet: AnchorWallet | null;
  connected: boolean;
  connecting: boolean;
  connection: Connection;
  disconnecting: boolean;
  error: string | null;
  publicKey: PublicKey | null;
  selectedWallet: CompatibleWallet | null;
  wallets: CompatibleWallet[];
  connect(wallet: CompatibleWallet, silent?: boolean): Promise<void>;
  disconnect(): Promise<void>;
};

const StampWalletContext = createContext<StampWalletContextValue | null>(null);

function isCompatible(wallet: StandardWallet): wallet is CompatibleWallet {
  return new Set(wallet.chains).has(DEVNET_CHAIN)
    && StandardConnect in wallet.features
    && SolanaSignTransaction in wallet.features;
}

function devnetAccount(accounts: readonly WalletAccount[]): WalletAccount | null {
  return accounts.find(({ chains, features }) =>
    chains.includes(DEVNET_CHAIN) && features.includes(SolanaSignTransaction)
  ) ?? null;
}

function serializeTransaction(transaction: Transaction | VersionedTransaction): Uint8Array {
  return transaction instanceof Transaction
    ? transaction.serialize({ requireAllSignatures: false, verifySignatures: false })
    : transaction.serialize();
}

function deserializeTransaction<T extends Transaction | VersionedTransaction>(
  original: T,
  bytes: Uint8Array,
): T {
  return (original instanceof Transaction
    ? Transaction.from(bytes)
    : VersionedTransaction.deserialize(bytes)) as T;
}

export function createAnchorWalletAdapter(wallet: CompatibleWallet, account: WalletAccount): AnchorWallet {
  const sign = wallet.features[SolanaSignTransaction].signTransaction;
  return {
    publicKey: new PublicKey(account.publicKey),
    async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
      const [output] = await sign({
        account,
        chain: DEVNET_CHAIN,
        transaction: serializeTransaction(transaction),
      });
      if (!output) throw new Error("Wallet returned no signed transaction");
      return deserializeTransaction(transaction, Uint8Array.from(output.signedTransaction));
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
      const outputs = await sign(...transactions.map((transaction) => ({
        account,
        chain: DEVNET_CHAIN,
        transaction: serializeTransaction(transaction),
      })));
      if (outputs.length !== transactions.length) {
        throw new Error("Wallet returned an incomplete signed transaction batch");
      }
      return transactions.map((transaction, index) => {
        const output = outputs[index];
        if (!output) throw new Error("Wallet omitted a signed transaction");
        return deserializeTransaction(transaction, Uint8Array.from(output.signedTransaction));
      });
    },
  };
}

export function StampWalletProvider({ children }: { children: ReactNode }) {
  const registry = useMemo(() => getWallets(), []);
  const connection = useMemo(() => new Connection(DEVNET_RPC, "confirmed"), []);
  const [wallets, setWallets] = useState<CompatibleWallet[]>(() => registry.get().filter(isCompatible));
  const [selectedWallet, setSelectedWallet] = useState<CompatibleWallet | null>(null);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptedSilentConnect = useRef(false);

  useEffect(() => {
    const refresh = () => setWallets(registry.get().filter(isCompatible));
    const offRegister = registry.on("register", refresh);
    const offUnregister = registry.on("unregister", refresh);
    return () => {
      offRegister();
      offUnregister();
    };
  }, [registry]);

  const connect = useCallback(async (wallet: CompatibleWallet, silent = false) => {
    setConnecting(true);
    setError(null);
    try {
      const output = await wallet.features[StandardConnect].connect({ silent });
      const nextAccount = devnetAccount(output.accounts);
      if (!nextAccount) throw new Error(`${wallet.name} returned no devnet signing account`);
      setSelectedWallet(wallet);
      setAccount(nextAccount);
      window.localStorage.setItem(LAST_WALLET_KEY, wallet.name);
    } catch (reason: unknown) {
      if (!silent) setError(reason instanceof Error ? reason.message : "Wallet connection failed");
      throw reason;
    } finally {
      setConnecting(false);
    }
  }, []);

  useEffect(() => {
    if (attemptedSilentConnect.current || wallets.length === 0 || account) return;
    attemptedSilentConnect.current = true;
    const previous = window.localStorage.getItem(LAST_WALLET_KEY);
    const wallet = wallets.find(({ name }) => name === previous);
    if (wallet) void connect(wallet, true).catch(() => undefined);
  }, [account, connect, wallets]);

  useEffect(() => {
    if (!selectedWallet || !(StandardEvents in selectedWallet.features)) return;
    return selectedWallet.features[StandardEvents]?.on("change", ({ accounts }) => {
      if (accounts) setAccount(devnetAccount(accounts));
    });
  }, [selectedWallet]);

  const disconnect = useCallback(async () => {
    setDisconnecting(true);
    setError(null);
    try {
      if (selectedWallet && StandardDisconnect in selectedWallet.features) {
        await selectedWallet.features[StandardDisconnect]?.disconnect();
      }
      setAccount(null);
      setSelectedWallet(null);
      window.localStorage.removeItem(LAST_WALLET_KEY);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Wallet disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  }, [selectedWallet]);

  const anchorWallet = useMemo(
    () => selectedWallet && account ? createAnchorWalletAdapter(selectedWallet, account) : null,
    [account, selectedWallet],
  );
  const value = useMemo<StampWalletContextValue>(() => ({
    account,
    anchorWallet,
    connected: Boolean(account),
    connecting,
    connection,
    disconnect,
    disconnecting,
    error,
    publicKey: anchorWallet?.publicKey ?? null,
    selectedWallet,
    wallets,
    connect,
  }), [account, anchorWallet, connect, connecting, connection, disconnect, disconnecting, error, selectedWallet, wallets]);

  return <StampWalletContext.Provider value={value}>{children}</StampWalletContext.Provider>;
}

export function useStampWallet(): StampWalletContextValue {
  const value = useContext(StampWalletContext);
  if (!value) throw new Error("useStampWallet must be used inside StampWalletProvider");
  return value;
}

function compactAddress(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function WalletControl() {
  const {
    connect,
    connected,
    connecting,
    disconnect,
    disconnecting,
    error,
    publicKey,
    selectedWallet,
    wallets,
  } = useStampWallet();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const label = connecting
    ? "CONNECTING"
    : publicKey
      ? compactAddress(publicKey.toBase58())
      : "CONNECT WALLET";

  return (
    <div className="wallet-control" ref={menuRef}>
      <button
        aria-expanded={open}
        className={`wallet-trigger ${connected ? "is-connected" : ""}`}
        disabled={connecting || disconnecting}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="wallet-trigger__dot" />
        {label}
      </button>
      {open && (
        <div className="wallet-menu" role="dialog" aria-label="Wallet connection">
          <div className="wallet-menu__head">
            <strong>DEVNET WALLET</strong>
            <span>YOU SIGN. STAMP NEVER HOLDS KEYS.</span>
          </div>
          {publicKey ? (
            <>
              <div className="wallet-current">
                <span>{selectedWallet?.name ?? "WALLET"}</span>
                <strong>{publicKey.toBase58()}</strong>
              </div>
              <button
                className="wallet-option is-danger"
                onClick={() => {
                  setOpen(false);
                  void disconnect();
                }}
                type="button"
              >DISCONNECT</button>
            </>
          ) : wallets.length > 0 ? (
            <div className="wallet-options">
              {wallets.map((wallet) => (
                <button
                  className="wallet-option"
                  key={wallet.name}
                  onClick={() => void connect(wallet).then(() => setOpen(false)).catch(() => undefined)}
                  type="button"
                >
                  <img alt="" height="24" src={wallet.icon} width="24" />
                  <strong>{wallet.name}</strong>
                  <span>AVAILABLE</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="wallet-empty">
              <strong>NO WALLET DETECTED.</strong>
              <span>Install a Wallet Standard Solana wallet, then reload STAMP.</span>
            </div>
          )}
          {error && <div className="wallet-error" role="alert">{error}</div>}
        </div>
      )}
    </div>
  );
}
