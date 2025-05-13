import { PublicKey } from '@solana/web3.js'
export const convertSolRatioToUsd = async (
  tokenA: PublicKey,
  tokenB: PublicKey,
  priceRatio: number,
  solPrice: number,
) => {
  return priceRatio * solPrice
}