import express, { Request, Response } from 'express'
import { Server } from 'http'
import { PublicKey } from '@solana/web3.js' // 假设 @solana/web3.js 已安装
import zmq from 'zeromq' // 假设 zeromq 已安装
import { convertSolRatioToUsd } from './utils/price' // 引入价格转换函数

interface SnipeRequest {
  tokenAddress: string
  buyAmountSol: number
  priorityFeeSol: number
  tipsSol: number
  maxBuyPriceUsd: number
}

// 用于存储活跃的狙击任务
interface ActiveSnipeJob extends SnipeRequest {
  id: string // 唯一标识符，例如 tokenAddress
  // 可以添加其他任务状态，例如 startTime
}
const activeSnipes = new Map<string, ActiveSnipeJob>()

const app = express()
const port = process.env.PORT || 3000
app.use(express.json())

let server: Server
let zmqSocket: zmq.Subscriber | null = null
const ZMQ_ADDRESS = process.env.ZMQ_ADDRESS || 'tcp://127.0.0.1:5555' // 从环境变量或默认值获取 ZMQ 地址
const ZMQ_TOPIC = 'liquidityEvents' // 假设的 ZMQ 主题

// ZeroMQ 事件处理逻辑
const handleZmqMessage = async (msg: Buffer) => {
  try {
    const eventData = JSON.parse(msg.toString())
    console.log(`[${new Date().toISOString()}] Received ZMQ event:`, eventData)

    // 假设事件数据结构包含 tokenAddress, type, 和 details (包含 tokenA, tokenB, priceRatio)
    const { tokenAddress: eventTokenAddress, type, details } = eventData

    if (type === 'liquidityAdded' && activeSnipes.has(eventTokenAddress)) {
      const job = activeSnipes.get(eventTokenAddress)!
      console.log(`[${new Date().toISOString()}] Liquidity added event found for active snipe: ${job.tokenAddress}`, details)

      // TODO: 从 ZeroMQ 事件的 'details' 中提取 tokenA, tokenB 的地址字符串和 priceRatio
      // const tokenAString: string = details.tokenA_address 
      // const tokenBString: string = details.tokenB_address
      // const priceRatioFromEvent: number = details.priceRatio

      // 示例: 假设我们从事件中获取了这些值
      const tokenAString: string = "So11111111111111111111111111111111111111112" // 示例 Wrapped SOL
      const tokenBString: string = job.tokenAddress // 目标代币
      const priceRatioFromEvent: number = 0.5 // 示例价格比率 (例如 目标代币/SOL)

      // TODO: 获取当前的 SOL 美元价格。这可能需要调用外部 API 或其他服务。
      const currentSolPriceUsd: number = 20 // 示例：假设 SOL 价格为 $20 USD

      if (!tokenAString || !tokenBString || priceRatioFromEvent === undefined || currentSolPriceUsd === undefined) {
        console.error(`[${new Date().toISOString()}] Missing data from ZMQ event or SOL price for ${job.tokenAddress}`)
        return
      }
      
      const tokenAKey = new PublicKey(tokenAString)
      const tokenBKey = new PublicKey(tokenBString)

      const calculatedUsdPrice = await convertSolRatioToUsd(
        tokenAKey,          // 通常是 SOL 或 USDC
        tokenBKey,          // 目标代币
        priceRatioFromEvent, // 价格比率 (目标代币 / tokenA)
        currentSolPriceUsd  // SOL 或 USDC 的美元价格
      )
      console.log(`[${new Date().toISOString()}] Calculated USD price for ${job.tokenAddress}: ${calculatedUsdPrice}`)

      if (calculatedUsdPrice <= job.maxBuyPriceUsd) {
        console.log(`[${new Date().toISOString()}] Price (${calculatedUsdPrice} USD) is within max buy price (${job.maxBuyPriceUsd} USD) for ${job.tokenAddress}. Initiating buy...`)
        // TODO: 实现购买逻辑
        // executeBuy(job, calculatedUsdPrice, details)
        // 购买成功后，可以从 activeSnipes 中移除任务
        // activeSnipes.delete(job.tokenAddress)
        // console.log(`[${new Date().toISOString()}] Buy initiated for ${job.tokenAddress}. Job removed.`)
      } else {
        console.log(`[${new Date().toISOString()}] Price (${calculatedUsdPrice} USD) is NOT within max buy price (${job.maxBuyPriceUsd} USD) for ${job.tokenAddress}.`)
        // 根据策略，可以选择在这里移除任务或继续监听
        // activeSnipes.delete(job.tokenAddress)
      }
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error processing ZMQ message:`, error)
  }
}


// 后台任务现在只是将请求加入待处理列表
const addSnipeTask = (params: SnipeRequest) => {
  console.log(`[${new Date().toISOString()}] Adding snipe task for token: ${params.tokenAddress}`)
  const job: ActiveSnipeJob = { ...params, id: params.tokenAddress }
  activeSnipes.set(params.tokenAddress, job)
  console.log(`[${new Date().toISOString()}] Active snipes: ${activeSnipes.size}`)
  // 不需要在这里启动独立的 ZMQ 监听，共享连接会处理
}

app.post('/snipe', (req: Request, res: Response): void => {
  const {
    tokenAddress,
    buyAmountSol,
    priorityFeeSol,
    tipsSol,
    maxBuyPriceUsd,
  } = req.body as SnipeRequest

  if (!tokenAddress || typeof tokenAddress !== 'string' ||
      buyAmountSol === undefined || typeof buyAmountSol !== 'number' ||
      priorityFeeSol === undefined || typeof priorityFeeSol !== 'number' ||
      tipsSol === undefined || typeof tipsSol !== 'number' ||
      maxBuyPriceUsd === undefined || typeof maxBuyPriceUsd !== 'number') {
    res.status(400).json({ error: 'Invalid parameters. Required: tokenAddress (string), buyAmountSol (number), priorityFeeSol (number), tipsSol (number), maxBuyPriceUsd (number)' })
    return
  }

  if (activeSnipes.has(tokenAddress)) {
    res.status(409).json({ message: `Snipe task for token: ${tokenAddress} is already active.` })
    return
  }

  const requestParams: SnipeRequest = {
    tokenAddress,
    buyAmountSol,
    priorityFeeSol,
    tipsSol,
    maxBuyPriceUsd,
  }

  addSnipeTask(requestParams)

  res.status(202).json({ message: `Snipe task accepted for token: ${tokenAddress}. Listening for liquidity events.` })
  return
})


const startServer = async () => {
  // 初始化 ZeroMQ Subscriber
  zmqSocket = new zmq.Subscriber()
  zmqSocket.connect(ZMQ_ADDRESS)
  zmqSocket.subscribe(ZMQ_TOPIC)
  console.log(`[${new Date().toISOString()}] ZeroMQ subscriber connected to ${ZMQ_ADDRESS} and subscribed to topic "${ZMQ_TOPIC}"`)

  // 异步处理 ZMQ 消息
  ;(async () => {
    if (!zmqSocket) return
    try {
      for await (const [topic, msg] of zmqSocket) {
        // console.log(`[${new Date().toISOString()}] Raw ZMQ message on topic ${topic.toString()}: ${msg.toString()}`)
        if (topic.toString() === ZMQ_TOPIC && msg) {
          handleZmqMessage(msg)
        }
      }
    } catch (err) {
      console.error(`[${new Date().toISOString()}] ZeroMQ socket error:`, err)
      // 可以在这里添加重连逻辑
    }
  })().catch(err => console.error("ZMQ processing loop error:", err))


  return new Promise<void>((resolve) => {
    server = app.listen(port, () => {
      console.log(`Server is running on http://localhost:${port}`)
      resolve()
    })
  })
}

const stopServer = async () => {
  // 关闭 ZeroMQ 连接
  if (zmqSocket) {
    console.log(`[${new Date().toISOString()}] Closing ZeroMQ socket...`)
    if (!zmqSocket.closed) {
        zmqSocket.close()
    }
    zmqSocket = null
    console.log(`[${new Date().toISOString()}] ZeroMQ socket closed.`)
  }

  // 清空活跃任务
  activeSnipes.clear()
  console.log(`[${new Date().toISOString()}] Active snipes cleared.`)

  return new Promise<void>((resolve, reject) => {
    if (server) {
      server.close((err) => {
        if (err) {
          console.error(`[${new Date().toISOString()}] Error closing HTTP server:`, err)
          return reject(err)
        }
        console.log('HTTP Server stopped')
        resolve()
      })
    } else {
      resolve()
    }
  })
}

export { app, startServer, stopServer, SnipeRequest, ActiveSnipeJob }

if (require.main === module) {
  startServer().catch(err => {
    console.error("Failed to start server:", err)
    process.exit(1)
  })

  process.on('SIGINT', async () => {
    console.log('SIGINT signal received. Shutting down gracefully...')
    await stopServer()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received. Shutting down gracefully...')
    await stopServer()
    process.exit(0)
  })
}
