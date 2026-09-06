import { describe, expect, it } from 'vitest'
import { loginReturnDestination } from './loginReturn'

describe('login return destination', () => {
  it('preserves the path and query on an explicitly approved origin', () => {
    expect(loginReturnDestination('https://portal.example.test/projects?view=recent', '["https://portal.example.test"]'))
      .toBe('https://portal.example.test/projects?view=recent')
  })
  it.each([
    undefined, null, ['https://portal.example.test/projects'], '',
    'https://other.example.test/projects', 'https://portal.example.test.evil.test/',
    'https://portal.example.test@evil.test/', 'https://user@portal.example.test/',
    'http://portal.example.test/projects', 'https://portal.example.test:444/projects',
    '//portal.example.test/projects', '/projects', 'javascript:alert(1)',
    ' https://portal.example.test/', 'https://portal.example.test/\nprojects',
    'https://portal.example.test\\@evil.test/', 'https://portal.example.test/' + 'x'.repeat(2048),
  ])('uses home for an unapproved or malformed destination: %s', (value) => {
    expect(loginReturnDestination(value, '["https://portal.example.test"]')).toBe('/')
  })
  it.each([undefined, '', 'bad json', '{}', '["*"]', '["https://portal.example.test/path"]', '["https://portal.example.test/?x=1"]'])('fails closed for invalid origin configuration: %s', (config) => {
    expect(loginReturnDestination('https://portal.example.test/projects', config)).toBe('/')
  })
  it('allows a separately configured local HTTP origin and exact port', () => {
    expect(loginReturnDestination('http://localhost:4002/projects', '["http://localhost:4002"]')).toBe('http://localhost:4002/projects')
    expect(loginReturnDestination('http://localhost:4003/projects', '["http://localhost:4002"]')).toBe('/')
  })
})
