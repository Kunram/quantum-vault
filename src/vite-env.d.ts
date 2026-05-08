/// <reference types="vite/client" />

interface Window {
  solana?: {
    isPhantom?: boolean;
    connect(): Promise<{ publicKey: { toString(): string } }>;
    disconnect(): Promise<void>;
    signMessage(message: Uint8Array, display: string): Promise<{ signature: Uint8Array }>;
  };
}
