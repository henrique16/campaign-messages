import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE_URL = __ENV.BASE_URL || 'http://api:3000'

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<300'],
  },
}

export default function () {
  const res = http.get(`${BASE_URL}/health`)
  check(res, {
    'status is 200': (r) => r.status === 200,
    'body status ok': (r) => r.json('status') === 'ok',
  })
  sleep(0.1)
}
