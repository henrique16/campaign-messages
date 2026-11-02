// Provedor de mensagens simulado. Use como está.
//
// sendMessage({ to, body }) -> Promise<{ providerMessageId }>
//
// - Telefones terminados em "0000" -> erro definitivo (err.status = 400)
// - Uma fração das chamadas (FAKE_FAIL_RATE, padrão 0.2) -> erro temporário (err.status = 503)
// - Latência aleatória entre 50 e 200 ms

const crypto = require('crypto');

const FAIL_RATE = Number(process.env.FAKE_FAIL_RATE ?? 0.2);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function providerError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function sendMessage({ to, body }) {
  await sleep(50 + Math.random() * 150);

  if (typeof to !== 'string' || typeof body !== 'string' || body.length === 0) {
    throw providerError(400, 'invalid_payload');
  }
  if (to.endsWith('0000')) {
    throw providerError(400, 'invalid_number');
  }
  if (Math.random() < FAIL_RATE) {
    throw providerError(503, 'provider_unavailable');
  }

  return { providerMessageId: 'pm_' + crypto.randomUUID() };
}

module.exports = { sendMessage };
