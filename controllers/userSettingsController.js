import { ObjectId } from 'mongodb'
import { getDatabase } from '../config/database.js'
import { successResponse, errorResponse } from '../utils/response.js'
import os from 'os'
import path from 'path'

/**
 * 获取用户设置
 */
export async function getUserSettings(req, res) {
  try {
    const userId = req.user?.userId

    if (!userId) {
      return res.status(401).json(errorResponse('未认证', 401))
    }

    const db = getDatabase()
    const settingsCollection = db.collection('user_settings')

    // 查找用户设置
    let settings = await settingsCollection.findOne({ userId: new ObjectId(userId) })

    // 如果不存在，返回默认值
    if (!settings) {
      // 获取系统默认下载路径
      const defaultDownloadPath = path.join(os.homedir(), 'Downloads')
      
      settings = {
        downloadPath: defaultDownloadPath,
      }
    }

    res.json(successResponse({
      downloadPath: settings.downloadPath || path.join(os.homedir(), 'Downloads'),
    }))
  } catch (error) {
    console.error('获取用户设置错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

/**
 * 更新用户设置
 */
export async function updateUserSettings(req, res) {
  try {
    const userId = req.user?.userId

    if (!userId) {
      return res.status(401).json(errorResponse('未认证', 401))
    }

    const { downloadPath } = req.body

    if (!downloadPath) {
      return res.status(400).json(errorResponse('下载路径不能为空', 400))
    }

    const db = getDatabase()
    const settingsCollection = db.collection('user_settings')

    // 更新或创建用户设置
    const result = await settingsCollection.updateOne(
      { userId: new ObjectId(userId) },
      {
        $set: {
          downloadPath,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          userId: new ObjectId(userId),
          createdAt: new Date(),
        },
      },
      { upsert: true }
    )

    res.json(successResponse(null, '设置保存成功'))
  } catch (error) {
    console.error('更新用户设置错误:', error)
    res.status(500).json(errorResponse('服务器内部错误', 500))
  }
}

