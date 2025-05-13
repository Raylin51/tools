import axios from 'axios'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import bs58 from 'bs58'
import dotenv from 'dotenv'

dotenv.config()

const BLOX_ENDPOINT = process.env.BLOX_ENDPOINT
const BLOX_AUTH = process.env.BLOX_AUTH
const TRADER_API_TIP_WALLET = "HWEoBxYs7ssKuudEjzjmpfJVX7Dvi7wescFsVx2L5yoY"

if (!BLOX_ENDPOINT) throw Error('先在 .env 中配置 BLOX_ENDPOINT 变量')
if (!BLOX_AUTH) throw Error('先在 .env 中配置 BLOX_AUTH 变量')

export const signAndSendTransactionByBlox = async (
  connection: Connection,
  transaction: Transaction,
  wallet: Keypair,
  tips: number,
) => {
  const tipAddress = new PublicKey(TRADER_API_TIP_WALLET)

  const tipsInstruction = SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: tipAddress,
    lamports: tips * LAMPORTS_PER_SOL,
  })
  transaction.add(tipsInstruction)

  // 设置最近的区块哈希
  const { blockhash } = await connection.getLatestBlockhash()
  transaction.recentBlockhash = blockhash
  transaction.feePayer = wallet.publicKey
  transaction.sign(wallet)

  // 发送快速交易
  axios.post(`${BLOX_ENDPOINT}/api/v2/submit`, {
    transaction: {
      content: transaction.serialize().toString('base64'),
    },
    skipPreFlight: true,
    frontRunningProtection: false,
    submitProtection: 'SP_LOW',
    useStakedRPCs: true,
  }, {
    headers: {
      Authorization: BLOX_AUTH,
    },
  })

  return bs58.encode(transaction.signature || Buffer.from(''))
}