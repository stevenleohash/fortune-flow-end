import { MongoClient } from 'mongodb'

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017'
const DATABASE_NAME = process.env.DATABASE_NAME || 'fortune_flow'

let client = null
let db = null

/**
 * 连接 MongoDB 数据库
 */
export async function connectDatabase() {
  if (client && db) {
    return db
  }

  try {
    client = new MongoClient(MONGODB_URI)
    await client.connect()
    db = client.db(DATABASE_NAME)
    console.log('✅ MongoDB 连接成功')
    
    // 初始化默认用户
    await initDefaultUser()
    
    return db
  } catch (error) {
    console.error('❌ MongoDB 连接失败:', error)
    throw error
  }
}

/**
 * 获取数据库实例
 */
export function getDatabase() {
  if (!db) {
    throw new Error('数据库未连接，请先调用 connectDatabase()')
  }
  return db
}

/**
 * 关闭数据库连接
 */
export async function closeDatabase() {
  if (client) {
    await client.close()
    client = null
    db = null
    console.log('MongoDB 连接已关闭')
  }
}

/**
 * 初始化默认用户
 */
async function initDefaultUser() {
  try {
    const usersCollection = db.collection('users')
    const existingUser = await usersCollection.findOne({ username: 'admin' })
    
    if (!existingUser) {
      const bcrypt = await import('bcrypt')
      const hashedPassword = await bcrypt.default.hash('123456', 10)
      
      await usersCollection.insertOne({
        username: 'admin',
        password: hashedPassword,
        nickname: '管理员',
        status: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      console.log('✅ 默认用户创建成功 (admin/123456)')
    }
  } catch (error) {
    console.error('初始化默认用户失败:', error)
  }
}

