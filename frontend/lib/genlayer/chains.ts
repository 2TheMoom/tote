import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";

// Note: genlayer-js's testnetAsimov also has id 4221 (same as testnetBradbury),
// so chain ID alone can't disambiguate it. Bradbury is the current recommended
// testnet and where Tote is deployed, so it's what 4221 resolves to.
const CHAINS_BY_ID: Record<number, any> = {
  4221: testnetBradbury,
};

/**
 * Resolve the genlayer-js chain object to use, based on
 * NEXT_PUBLIC_GENLAYER_CHAIN_ID. Defaults to Bradbury testnet, where
 * Tote is deployed. Always use one of genlayer-js's own exported chain
 * objects here, never a hand-rolled chain object - the SDK relies on
 * fields (e.g. defaultConsensusMaxRotations) that a hand-rolled object
 * won't have.
 */
export function getGenLayerChain() {
  const chainId = parseInt(process.env.NEXT_PUBLIC_GENLAYER_CHAIN_ID || "4221");
  return CHAINS_BY_ID[chainId] ?? testnetBradbury;
}

export function getTxExplorerUrl(txHash: string): string {
  return `https://explorer-bradbury.genlayer.com/tx/${txHash}`;
}

export function getAddressExplorerUrl(address: string): string {
  return `https://explorer-bradbury.genlayer.com/address/${address}`;
}

export { localnet, studionet, testnetAsimov, testnetBradbury };
