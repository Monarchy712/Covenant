import deployments from "../abi/deployments.testnet.json" with { type: "json" };

export interface Deployments {
  factory: `0x${string}`;
  implementation: `0x${string}`;
  market: `0x${string}`;
  vault: `0x${string}`;
  base: `0x${string}`;
  quote: `0x${string}`;
  factoryBlock: number;
  chainId: number;
}

export const testnet = deployments as unknown as Deployments;
