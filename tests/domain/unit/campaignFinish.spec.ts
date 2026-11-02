import { shouldFinish } from '../../../src/domain/campaignFinish'

describe('shouldFinish', () => {
  it('finaliza quando está running e não há mensagens queued', () => {
    expect(shouldFinish('running', 0)).toBe(true)
  })

  it('não finaliza quando está running e ainda há queued', () => {
    expect(shouldFinish('running', 1)).toBe(false)
    expect(shouldFinish('running', 50)).toBe(false)
  })

  it('não finaliza campanha draft, mesmo sem queued', () => {
    expect(shouldFinish('draft', 0)).toBe(false)
  })

  it('não finaliza campanha já finished', () => {
    expect(shouldFinish('finished', 0)).toBe(false)
  })
})
