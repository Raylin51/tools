import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  SYSVAR_RENT_PUBKEY,
  Signer,
} from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import bs58 from 'bs58'

// 生成新的钱包（Keypair）
export const generateNewWallet = (): { keypair: Keypair, privateKey: string, publicKey: string } => {
  // 生成新的 Keypair
  const keypair = Keypair.generate()

  // 获取私钥（bs58 格式）
  const privateKey = bs58.encode(keypair.secretKey)

  // 获取公钥
  const publicKey = keypair.publicKey.toString()

  return { keypair, privateKey, publicKey }
}

// 创建 ATA 账户的指令
export const createATAInstruction = async (
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey
) => {
  // 获取 ATA 地址
  const ataAddress = await getAssociatedTokenAddress(
    mint,
    owner,
  )

  return {
    instruction: createAssociatedTokenAccountIdempotentInstruction(
      payer,
      ataAddress,
      owner,
      mint,
    ),
    address: ataAddress,
  }
}

// 从 bs58 格式的私钥字符串创建 Keypair
export const createKeypairFromPrivateKey = (privateKeyString: string): Keypair => {
  try {
    // 解码 bs58 格式的私钥
    // const decodedKey = bs58.decode(privateKeyString.trim())
    return Keypair.fromSecretKey(bs58.decode(privateKeyString))
  } catch (error) {
    console.error('私钥解析错误:', error)
    throw new Error('私钥格式不正确，请提供有效的 bs58 格式私钥')
  }
}

// 添加优先费用指令到交易
export const addPriorityFeeToTransaction = (
  transaction: Transaction,
  priorityFeeInMicroLamports: number = 10000000, // 默认1 LAMPORT的优先费用
  computeLimit: number = 100000,
): Transaction => {
  // 创建设置优先费用的指令
  const priorityLimitInstruction = ComputeBudgetProgram.setComputeUnitLimit({
    units: computeLimit,
  })
  const priorityFeeInstruction = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: priorityFeeInMicroLamports
  })

  // 将指令添加到交易的开头
  transaction.instructions = [priorityLimitInstruction, priorityFeeInstruction, ...transaction.instructions]

  return transaction
}

export const addCreateWsolAccount = async (
  transaction: Transaction,
  payer: PublicKey,
  solAmount: number
) => {
  const wsolSeed = `wsol-${Date.now()}`
  const wsolAccountAddress = await PublicKey.createWithSeed(
    payer,
    wsolSeed,
    TOKEN_PROGRAM_ID
  )

  // 计算所需的最小余额
  const rentExemptBalance = 2039280

  // 添加创建账户指令
  transaction.add(
    SystemProgram.createAccountWithSeed({
      fromPubkey: payer,
      basePubkey: payer,
      seed: wsolSeed,
      newAccountPubkey: wsolAccountAddress,
      lamports: rentExemptBalance + solAmount * LAMPORTS_PER_SOL,
      space: 165,
      programId: TOKEN_PROGRAM_ID
    })
  )

  // 初始化代币账户
  transaction.add(
    new TransactionInstruction({
      keys: [
        { pubkey: wsolAccountAddress, isSigner: false, isWritable: true },
        { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
        { pubkey: payer, isSigner: true, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }
      ],
      programId: TOKEN_PROGRAM_ID,
      data: Buffer.from([1, 0, 0, 0]) // 初始化代币账户指令
    })
  )

  return {
    transaction,
    wsolAccountAddress,
  }
}