import { ObjectId } from 'mongodb'
import { getDatabase } from '../config/database.js'
import { successResponse, errorResponse } from '../utils/response.js'

/**
 * 获取当前用户信息
 */
export async function getUserDetail(req, res) {
  try {
    const userId = req.user?.userId

    if (!userId) {
      return res.status(401).json(errorResponse('未认证', 401))
    }

    const db = getDatabase()
    const usersCollection = db.collection('users')

    const user = await usersCollection.findOne({ _id: new ObjectId(userId) })

    if (!user) {
      return res.status(404).json(errorResponse('用户不存在', 404))
    }

    // 返回用户信息（不包含密码）
    const userInfo = {
      id: user._id.toString(),
      username: user.username,
      nickname: user.nickname || user.username,
      email: user.email || '',
      avatar: user.avatar || '',
      gender: user.gender || null,
      address: user.address || '',
      profile: {
        avatar: user.avatar || '',
        nickName: user.nickname || user.username,
        gender: user.gender || null,
        address: user.address || '',
        email: user.email || '',
      },
      roles: [], // 暂时返回空数组
      currentRole: null, // 暂时返回 null
    }

    res.json(successResponse(userInfo))
  } catch (error) {
    console.error('获取用户信息错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

