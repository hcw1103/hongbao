const axios = require('axios')
const querystring = require('querystring')
const cookies = require('./cookies')
const randomPhone = require('../random-phone')
const logger = require('../logger')
const timeout = require('../timeout')

const origin = 'https://h5.ele.me'

async function request ({mobile, url} = {}) {
  const query = querystring.parse(url)
  let index = 0
  let number = -1

  const request = axios.create({
    baseURL: origin,
    withCredentials: true,
    headers: {
      origin,
      referer: `${origin}/hongbao/`,
      'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; PRO 6 Build/MRA58K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/53.0.2785.49 Mobile MQQBrowser/6.2 TBS/043221 Safari/537.36 V1_AND_SQ_7.0.0_676_YYB_D QQ/7.0.0.3135 NetType/WIFI WebP/0.3.0 Pixel/1080'
    },
    transformRequest: [(data, headers) => {
      headers['X-Shard'] = `eosid=${parseInt(query.sn, 16)}`
      return JSON.stringify(data)
    }]
  })

  return (async function lottery () {
    let count = 0
    let cookie
    do {
      if (index > cookies.length - 1) {
        if (count >= 3 || number !== 1) {
          throw new Error('网络繁忙，请稍后重试')
        }
        // 如果这个是最佳红包，等两秒，再继续从头搜寻 “没有被锁定的 cookie”
        index = 0
        count++
        await timeout(2000)
      }
      cookie = cookies[index++]
    } while (cookie.lock)

    if (!query.sn ||
      !query.lucky_number ||
      isNaN(query.lucky_number) ||
      !cookie) {
      throw new Error('饿了么红包链接不正确\n或\n请求饿了么服务器失败')
    }

    let phone
    if (number === 1) {
      // 如果这个是最佳红包，换成指定的手机号领取，并锁定 cookie
      phone = mobile
      cookie.lock = true
    } else {
      phone = randomPhone(mobile)
    }

    let records = []
    try {
      // 绑定手机号
      await request.put(`/restapi/v1/weixin/${cookie.sns.openid}/phone`, {
        sign: cookie.sns.eleme_key,
        phone
      })
      logger.info('绑定手机号', phone)

      // 领红包
      // eslint-disable-next-line camelcase
      const {data} = await request.post(`/restapi/marketing/promotion/weixin/${cookie.sns.openid}`, {
        device_id: '',
        group_sn: query.sn,
        hardware_id: '',
        method: 'phone',
        phone,
        platform: query.platform,
        sign: cookie.sns.eleme_key,
        track_id: '',
        unionid: 'fuck', // 别问为什么传 fuck，饿了么前端就是这么传的
        weixin_avatar: '',
        weixin_username: ''
      })
      records = data.promotion_records || []
    } catch (e) {
      throw e
    } finally {
      cookie.lock = false
    }

    // 计算剩余第几个为最佳红包
    number = query.lucky_number - records.length

    if (number <= 0) {
      // 有时候领取成功了，但是没有返回 lucky，再调一次就可以了
      const lucky = records.find(r => r.is_lucky) || await lottery(phone)
      logger.info('手气最佳红包已被领取', JSON.stringify(lucky))
      return (lucky && lucky.amount)
        ? `手气最佳红包已被领取\n\n手气最佳：${lucky.sns_username}\n红包金额：${lucky.amount} 元`
        : '红包被人抢完\n或\n服务器繁忙'
    }

    logger.info(`还要领 ${number} 个红包才是手气最佳`)
    return lottery()
  })()
}

function response (options) {
  return new Promise(async resolve => {
    try {
      resolve({message: await request(options)})
    } catch (e) {
      logger.error(e.message)
      resolve({
        message: e.message,
        status: (e.response || {}).status
      })
    }
  })
}

module.exports = async options => {
  let res = await response(options)
  // 400 重试一次
  if (res.status === 400) {
    res = await response(options)
    // 仍然 400
    if (res.status === 400) {
      res.message = '今日领取红包个数达到上限\n或\n服务器繁忙'
    }
  }
  return res
}
