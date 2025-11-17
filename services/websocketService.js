import { WebSocketServer } from 'ws'
import { verifyToken } from '../middleware/auth.js'

/**
 * WebSocket 服务
 * 用于与前端自动化任务窗口通信
 */
class WebSocketService {
  constructor() {
    this.wss = null
    this.clients = new Set() // 存储所有连接的客户端
  }

  /**
   * 启动 WebSocket 服务
   * @param {number} port - WebSocket 端口，默认 3000
   */
  start(port = 3000) {
    if (this.wss) {
      console.log('[WebSocketService] WebSocket 服务已启动')
      return
    }

    this.wss = new WebSocketServer({ port })

    this.wss.on('connection', (ws, req) => {
      const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`

      const token = this.extractTokenFromRequest(req)
      if (!token) {
        console.warn(`[WebSocketService] 拒绝未提供 token 的连接: ${clientId}`)
        ws.close(4401, 'Unauthorized')
        return
      }

      try {
        const decoded = verifyToken(token)
        ws.user = decoded
      }
      catch (error) {
        console.warn(`[WebSocketService] token 校验失败，连接被拒绝: ${clientId}`, error.message)
        ws.close(4401, 'Invalid token')
        return
      }

      console.log(`[WebSocketService] 客户端连接: ${clientId}`, ws.user)

      this.clients.add(ws)

      // 发送欢迎消息
      ws.send(JSON.stringify({
        type: 'server:connected',
        data: {
          message: 'WebSocket 连接成功',
          timestamp: new Date().toISOString(),
        },
      }))

      // 处理消息
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString())
          this.handleMessage(ws, data)
        }
        catch (error) {
          console.error('[WebSocketService] 解析消息失败:', error)
        }
      })

      // 处理关闭
      ws.on('close', () => {
        console.log(`[WebSocketService] 客户端断开连接: ${clientId}`)
        this.clients.delete(ws)
      })

      // 处理错误
      ws.on('error', (error) => {
        console.error(`[WebSocketService] 客户端错误 (${clientId}):`, error)
        this.clients.delete(ws)
      })
    })

    this.wss.on('listening', () => {
      console.log(`[WebSocketService] WebSocket 服务已启动，端口: ${port}`)
    })

    this.wss.on('error', (error) => {
      console.error('[WebSocketService] WebSocket 服务错误:', error)
    })
  }

  extractTokenFromRequest(req) {
    try {
      const url = new URL(req.url, 'http://localhost')
      return url.searchParams.get('token')
    }
    catch (error) {
      console.error('[WebSocketService] 解析连接 token 失败:', error)
      return null
    }
  }

  /**
   * 处理客户端消息
   */
  handleMessage(ws, message) {
    const { type, data } = message

    switch (type) {
      case 'client:ready':
        console.log('[WebSocketService] 客户端就绪:', data)
        break

      case 'task:result':
        console.log('[WebSocketService] 收到任务执行结果:', data)
        // 触发任务结果回调，更新任务状态
        if (this.onTaskResult) {
          this.onTaskResult(data)
        }
        // 同时触发任务执行器的结果处理
        if (this.onTaskResultCallback) {
          this.onTaskResultCallback(data)
        }
        break

      default:
        console.log('[WebSocketService] 未知消息类型:', type)
    }
  }

  /**
   * 设置任务结果回调（用于任务执行器）
   */
  setTaskResultCallback(callback) {
    this.onTaskResultCallback = callback
  }

  /**
   * 广播消息到所有客户端
   */
  broadcast(message) {
    const data = typeof message === 'string' ? message : JSON.stringify(message)
    let count = 0

    this.clients.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        try {
          client.send(data)
          count++
        }
        catch (error) {
          console.error('[WebSocketService] 发送消息失败:', error)
        }
      }
    })

    return count
  }

  /**
   * 发送任务执行请求
   */
  sendTaskExecute(taskId, shopData, taskType) {
    const message = {
      type: 'task:execute',
      data: {
        taskId,
        shopData,
        taskType,
        timestamp: new Date().toISOString(),
      },
    }

    return this.broadcast(message)
  }

  /**
   * 广播任务状态更新
   * @param {object} taskUpdate - 任务更新信息 { taskId, status, ... }
   */
  broadcastTaskStatusUpdate(taskUpdate) {
    const message = {
      type: 'task:status-update',
      data: {
        ...taskUpdate,
        timestamp: new Date().toISOString(),
      },
    }

    return this.broadcast(message)
  }

  /**
   * 获取连接的客户端数量
   */
  getClientCount() {
    return this.clients.size
  }

  /**
   * 停止 WebSocket 服务
   */
  stop() {
    if (this.wss) {
      // 关闭所有客户端连接
      this.clients.forEach((client) => {
        try {
          client.close()
        }
        catch (error) {
          console.error('[WebSocketService] 关闭客户端连接失败:', error)
        }
      })
      this.clients.clear()

      // 关闭服务器
      this.wss.close(() => {
        console.log('[WebSocketService] WebSocket 服务已停止')
      })
      this.wss = null
    }
  }
}

export const websocketService = new WebSocketService()

