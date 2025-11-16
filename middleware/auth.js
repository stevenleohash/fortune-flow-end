import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'fortune-flow-secret-key-change-in-production'

/**
 * JWT 认证中间件
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization
  const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      code: 401,
      message: '未提供认证令牌',
      data: null,
    })
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = decoded
    next()
  } catch (error) {
    return res.status(403).json({
      code: 403,
      message: '认证令牌无效或已过期',
      data: null,
    })
  }
}

/**
 * 生成 JWT Token
 */
export function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  })
}

