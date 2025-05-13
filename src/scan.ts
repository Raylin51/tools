import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, Transaction, TransactionInstruction } from '@solana/web3.js'
import axios from 'axios'
import Websocket from 'ws'
import dotenv from 'dotenv'

dotenv.config()
import { METEORABONDINGCURVEIDL } from './IDL'
import { addPriorityFeeToTransaction, addCreateWsolAccount, createATAInstruction, createKeypairFromPrivateKey } from './utils/solana'
import { BN, Program } from '@coral-xyz/anchor'
import { createCloseAccountInstruction, NATIVE_MINT } from '@solana/spl-token'
import { TOKEN_PROGRAM_ID } from '@coral-xyz/anchor/dist/cjs/utils/token'
import { signAndSendTransactionByBlox } from './utils/blox'

const blackListCreator = [
  'Add2YiY9ZNRpFf65XrXbDPizM5mTSLcGw3UHSAUKqUtd'
]

const whiteListCreator = [
  '5qWya6UjwWnGVhdSBL3hyZ7B45jbk6Byt1hwd7ohEGXE'
]

const buyAmount = 0.1
const rpc = process.env.RPC_URL
const privatekey = process.env.PRIVATE_KEY
const BONDINGCURVE_PROGRAM_ID = new PublicKey('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN')
const maxPrice = 0.00005

if (!rpc) throw Error('先在 .env 中配置 RPC 变量')
if (!privatekey) throw Error('现在 .env 中配置 PRIVATE_KEY 变量')

const wallet = createKeypairFromPrivateKey(privatekey)
const connection = new Connection(rpc)
const program = new Program(
  METEORABONDINGCURVEIDL,
  {
    connection,
    wallet: {
      publicKey: BONDINGCURVE_PROGRAM_ID,
      signTransaction: async () => { throw new Error('Not implemented'); },
      signAllTransactions: async () => { throw new Error('Not implemented') },
    },
  },
)

let solPrice = 170

axios.get('https://api.coingecko.com/api/v3/simple/price\?ids\=solana\&vs_currencies\=usd')
  .then(res => {
    solPrice = res.data.solana.usd
  })
  .catch()

// 定时更新 sol 价格
setInterval(async () => {
  const res = await axios.get('https://api.coingecko.com/api/v3/simple/price\?ids\=solana\&vs_currencies\=usd').catch()
  solPrice = res.data.solana.usd
}, 1000 * 60)

const RECONNECT_DELAY = 1000 // 5 seconds

const connectWebSocket = () => {
  const ws = new Websocket('ws://204.16.246.46:18333')

  ws.on('open', () => {
    console.log('WebSocket connected')
  })

  ws.on('message', data => {
    // console.log(data.toString()) // Ensure data is converted to string if it's a Buffer
    handleTokenCreation(JSON.parse(data.toString()))
  })

  ws.on('close', () => {
    console.log('WebSocket disconnected, attempting to reconnect...')
    setTimeout(connectWebSocket, RECONNECT_DELAY)
  })

  ws.on('error', error => {
    console.error('WebSocket error:', error)
    // The 'close' event will be called next, so reconnection will be handled there.
  })
}

const handleTokenCreation = async (
  transactionData: any,
) => {
  // console.log(accounts)
  const {
    pool_address: pool,
    signer,
    base_mint: tokenMint,
    base_vault: tokenVault,
    quote_vault: wsolVault,
    config,
  } = transactionData
  signer.forEach(item => {
    if (!whiteListCreator.includes(item)) return
  })  
  console.log(tokenMint)
  const startTimestamp = Date.now()
  console.log(`接受到的时间: ${new Date()}`)
  // console.log(creator)
  let transaction = new Transaction()

  // 添加小费
  transaction = addPriorityFeeToTransaction(transaction, 10000000, 120000)

  // 创建 wsol 账户
  const createWsolResult = await addCreateWsolAccount(transaction, wallet.publicKey, buyAmount)
  const wsolAccountAddress = createWsolResult.wsolAccountAddress
  transaction = createWsolResult.transaction

  // 添加 ATA 账户
  const ataInstruction = await createATAInstruction(wallet.publicKey, wallet.publicKey, new PublicKey(tokenMint))
  const ataAddress = ataInstruction.address
  transaction.add(ataInstruction.instruction)

  // 添加 swap 指令
  const swapInstruction = await program.methods.swap({
    amountIn: new BN(buyAmount * LAMPORTS_PER_SOL),
    minimumAmountOut: new BN(buyAmount * solPrice / maxPrice),
  })
    .accounts({
      config,
      pool,
      inputTokenAccount: wsolAccountAddress,
      outputTokenAccount: ataAddress,
      baseVault: tokenVault,
      quoteVault: wsolVault,
      baseMint: tokenMint,
      quoteMint: NATIVE_MINT,
      payer: wallet.publicKey,
      tokenBaseProgram: TOKEN_PROGRAM_ID,
      tokenQuoteProgram: TOKEN_PROGRAM_ID,
      referralTokenAccount: new PublicKey('9koN38T5C8k4GBLmZkU95XGNH2UEcnvKjK9v7XpkgQAR'),
      eventAuthority: new PublicKey('8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF'),
    })
    .instruction()
  transaction.add(swapInstruction)

  // 关闭 wsol 账户
  transaction.add(createCloseAccountInstruction(
    wsolAccountAddress,
    wallet.publicKey,
    wallet.publicKey,
  ))

  // 设置最近的区块哈希
  // const { blockhash } = await connection.getLatestBlockhash()
  // transaction.recentBlockhash = blockhash
  // transaction.feePayer = wallet.publicKey

  // const signature = await sendAndConfirmTransaction(
  //   connection,
  //   transaction,
  //   [wallet],
  //   {
  //     preflightCommitment: 'processed',
  //   }
  // )

  // 提交给 blox 
  const signature = await signAndSendTransactionByBlox(
    connection,
    transaction,
    wallet,
    0.003
  )

  console.log('交易签名:', signature)
  console.log(`总消耗时间 ${Date.now() - startTimestamp}ms`)
}

const main = async () => {
  connectWebSocket()
}

main()
