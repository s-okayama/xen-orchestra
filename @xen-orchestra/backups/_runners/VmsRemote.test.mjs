import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'
import { VmsRemote } from './VmsRemote.mjs'
import { Throttle } from '@vates/generator-toolbox'

describe('VmsRemote throttleGenerator integration', () => {
  test('should create throttle with correct speed limit', () => {
    const mockJob = {
      id: 'test-job',
      mode: 'full',
      sourceRemote: 'remote1',
      remotes: ['remote1', 'remote2'],
      settings: {
        '': {
          maxExportRate: 10 // 10 MB/s
        }
      }
    }

    const mockConfig = {
      defaultSettings: {},
      vm: { defaultSettings: {} }
    }

    const runner = new VmsRemote(mockJob, mockConfig, {})
    const settings = runner._computeBaseSettings(mockConfig, mockJob)

    // Test throttle creation with speed limit
    const throttleGenerator = new Throttle(
      settings.maxExportRate > 0 ? settings.maxExportRate * 1024 * 1024 : undefined
    )

    assert.strictEqual(throttleGenerator.speed, 10 * 1024 * 1024) // 10 MB/s in bytes
  })

  test('should handle unlimited speed when maxExportRate is 0', () => {
    const mockJob = {
      settings: {
        '': {
          maxExportRate: 0 // Unlimited
        }
      }
    }

    const mockConfig = {
      defaultSettings: {},
      vm: { defaultSettings: {} }
    }

    const runner = new VmsRemote(mockJob, mockConfig, {})
    const settings = runner._computeBaseSettings(mockConfig, mockJob)

    // When maxExportRate is 0, throttle should be undefined
    const throttleSpeed = settings.maxExportRate > 0 ? settings.maxExportRate * 1024 * 1024 : undefined
    assert.strictEqual(throttleSpeed, undefined)
  })

  test('should use default maxExportRate when not specified', () => {
    const mockJob = {
      settings: {
        '': {} // No maxExportRate specified
      }
    }

    const mockConfig = {
      defaultSettings: {},
      vm: { defaultSettings: {} }
    }

    const runner = new VmsRemote(mockJob, mockConfig, {})
    const settings = runner._computeBaseSettings(mockConfig, mockJob)

    // Should use default value of 0 (unlimited)
    assert.strictEqual(settings.maxExportRate, 0)
  })
})
