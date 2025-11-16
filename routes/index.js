import express from 'express'

const router = express.Router()

/* GET home page. */
router.get('/', (req, res) => {
  res.json({
    code: 200,
    message: 'Fortune Flow API Server',
    data: null,
  })
})

export default router
