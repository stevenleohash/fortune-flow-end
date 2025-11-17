import bcrypt from 'bcrypt'
import { getDatabase } from '../config/database.js'
import { generateToken } from '../middleware/auth.js'
import { successResponse, errorResponse } from '../utils/response.js'

/**
 * 用户登录
 */
export async function login(req, res) {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      return res.status(400).json(errorResponse('用户名和密码不能为空', 400))
    }

    let db
    try {
      db = getDatabase()
    } catch (dbError) {
      console.error('获取数据库连接失败:', dbError)
      return res.status(503).json(errorResponse('数据库未连接，请稍后重试', 503))
    }

    const usersCollection = db.collection('users')

    // 查找用户
    const user = await usersCollection.findOne({ username })

    if (!user) {
      return res.status(422).json(errorResponse('用户名或密码错误', 422))
    }

    // 验证密码
    const isPasswordValid = await bcrypt.compare(password, user.password)

    if (!isPasswordValid) {
      return res.status(422).json(errorResponse('用户名或密码错误', 422))
    }

    // 检查用户状态
    if (user.status !== 1) {
      return res.status(403).json(errorResponse('用户已被禁用', 403))
    }

    // 更新最后登录时间
    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { lastLoginAt: new Date() } }
    )

    // 生成 Token
    const token = generateToken({
      userId: user._id.toString(),
      username: user.username,
    })

    // 返回用户信息（不包含密码）
    const userInfo = {
      id: user._id.toString(),
      username: user.username,
      nickname: user.nickname || user.username,
      email: user.email || '',
      avatar: user.avatar || '',
    }

    res.json(successResponse({
      accessToken: token,
      user: userInfo,
    }, '登录成功'))
  } catch (error) {
    console.error('登录错误:', error)
    console.error('错误堆栈:', error.stack)
    res.status(500).json(errorResponse(
      process.env.NODE_ENV === 'development' 
        ? `服务器内部错误: ${error.message}` 
        : '服务器内部错误', 
      500
    ))
  }
}

/**
 * 用户登出
 */
export async function logout(req, res) {
  // JWT 是无状态的，客户端删除 token 即可
  res.json(successResponse(null, '登出成功'))
}

/**
 * 刷新 Token
 */
export async function refreshToken(req, res) {
  try {
    // 从请求头获取当前 token
    const authHeader = req.headers.authorization
    const token = authHeader && authHeader.split(' ')[1]

    if (!token) {
      return res.status(401).json(errorResponse('未提供认证令牌', 401))
    }

    const jwt = await import('jsonwebtoken')

    const JWT_SECRET = process.env.JWT_SECRET || 'fortune-flow-secret-key-change-in-production'

    try {
      const decoded = jwt.default.verify(token, JWT_SECRET)
      
      // 生成新 token
      const newToken = generateToken({
        userId: decoded.userId,
        username: decoded.username,
      })

      res.json(successResponse({
        accessToken: newToken,
      }, 'Token 刷新成功'))
    } catch (error) {
      return res.status(403).json(errorResponse('Token 无效或已过期', 403))
    }
  } catch (error) {
    console.error('刷新 Token 错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

