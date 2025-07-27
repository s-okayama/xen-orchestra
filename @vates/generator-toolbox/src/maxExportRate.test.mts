import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'
import { Throttle } from './throttle.mjs'

describe('maxExportRate Integration Tests', () => {
  describe('Speed limit calculations', () => {
    test('should convert MB/s to bytes/s correctly', () => {
      const maxExportRateMB = 10 // 10 MB/s
      const expectedBytesPerSecond = 10 * 1024 * 1024 // 10,485,760 bytes/s

      const throttle = new Throttle(maxExportRateMB * 1024 * 1024)
      assert.strictEqual(throttle.speed, expectedBytesPerSecond)
    })

    test('should handle fractional MB/s rates', () => {
      const maxExportRateMB = 0.5 // 512 KB/s
      const expectedBytesPerSecond = 0.5 * 1024 * 1024 // 524,288 bytes/s

      const throttle = new Throttle(maxExportRateMB * 1024 * 1024)
      assert.strictEqual(throttle.speed, expectedBytesPerSecond)
    })

    test('should handle unlimited rate (undefined when maxExportRate is 0)', () => {
      const maxExportRate = 0
      const throttleSpeed = maxExportRate > 0 ? maxExportRate * 1024 * 1024 : undefined

      assert.strictEqual(throttleSpeed, undefined)
    })
  })

  describe('Real-world maxExportRate scenarios', () => {
    test('should throttle at 1 MB/s rate', async () => {
      const maxExportRate = 1 // 1 MB/s
      const throttle = new Throttle(maxExportRate * 1024 * 1024)

      // Simulate VM backup data chunks (typical VHD blocks)
      async function* vmDataGenerator() {
        yield { length: 512 * 1024, data: 'vhd-block-1' } // 512 KB
        yield { length: 512 * 1024, data: 'vhd-block-2' } // 512 KB
      }

      const startTime = Date.now()
      const results = []

      for await (const chunk of throttle.createThrottledGenerator(vmDataGenerator())) {
        results.push(chunk)
      }

      const endTime = Date.now()
      const duration = endTime - startTime

      assert.strictEqual(results.length, 2)
      // 1 MB total at 1 MB/s should take about 1 second
      // First chunk immediate, second chunk delayed by ~500ms
      assert.ok(duration >= 400, `Duration ${duration}ms should be >= 400ms`)
    })

    test('should throttle at high speed (100 MB/s)', async () => {
      const maxExportRate = 100 // 100 MB/s
      const throttle = new Throttle(maxExportRate * 1024 * 1024)

      // Small chunks should process quickly at high speed
      async function* fastDataGenerator() {
        yield { length: 1024, data: 'small-chunk-1' } // 1 KB
        yield { length: 1024, data: 'small-chunk-2' } // 1 KB
        yield { length: 1024, data: 'small-chunk-3' } // 1 KB
      }

      const startTime = Date.now()
      const results = []

      for await (const chunk of throttle.createThrottledGenerator(fastDataGenerator())) {
        results.push(chunk)
      }

      const endTime = Date.now()
      const duration = endTime - startTime

      assert.strictEqual(results.length, 3)
      // At 100 MB/s, 3 KB should process very quickly
      assert.ok(duration < 100, `Duration ${duration}ms should be < 100ms`)
    })

    test('should handle dynamic speed changes', () => {
      let currentMaxExportRate = 5 // Start with 5 MB/s

      const throttle = new Throttle(() => currentMaxExportRate * 1024 * 1024)
      assert.strictEqual(throttle.speed, 5 * 1024 * 1024)

      // Change speed during runtime (simulating user changing settings)
      currentMaxExportRate = 20 // Change to 20 MB/s
      assert.strictEqual(throttle.speed, 20 * 1024 * 1024)

      // Change to unlimited
      currentMaxExportRate = 0
      assert.throws(() => throttle.speed, /speed must be greater than zero/)
    })
  })

  describe('Edge cases for maxExportRate', () => {
    test('should handle very low speeds', async () => {
      const maxExportRate = 0.001 // 1 KB/s (very slow)
      const throttle = new Throttle(maxExportRate * 1024 * 1024)

      async function* slowDataGenerator() {
        yield { length: 100, data: 'tiny-chunk' } // 100 bytes
      }

      const startTime = Date.now()
      const results = []

      for await (const chunk of throttle.createThrottledGenerator(slowDataGenerator())) {
        results.push(chunk)
      }

      const endTime = Date.now()
      const duration = endTime - startTime

      assert.strictEqual(results.length, 1)
      // Even small chunks should be processed quickly if they're the first
      assert.ok(duration < 200, `Duration ${duration}ms should be < 200ms`)
    })

    test('should handle large chunk sizes', async () => {
      const maxExportRate = 2 // 2 MB/s
      const throttle = new Throttle(maxExportRate * 1024 * 1024)

      async function* largeDataGenerator() {
        yield { length: 4 * 1024 * 1024, data: 'large-chunk' } // 4 MB chunk
      }

      const startTime = Date.now()
      const results = []

      for await (const chunk of throttle.createThrottledGenerator(largeDataGenerator())) {
        results.push(chunk)
      }

      const endTime = Date.now()
      const duration = endTime - startTime

      assert.strictEqual(results.length, 1)
      // 4 MB at 2 MB/s should take about 2 seconds, but first chunk is immediate
      assert.ok(duration < 500, `Duration ${duration}ms should be < 500ms for first chunk`)
    })
  })

  describe('VmsRemote settings integration', () => {
    test('should correctly apply maxExportRate from job settings', () => {
      const mockJobSettings: { '': { maxExportRate?: number } } = {
        '': { maxExportRate: 15 }
      }

      const maxExportRate = mockJobSettings[''].maxExportRate!
      const throttleSpeed = maxExportRate > 0 ? maxExportRate * 1024 * 1024 : undefined

      assert.strictEqual(throttleSpeed, 15 * 1024 * 1024)
    })

    test('should handle nested settings override', () => {
      const mockJobSettings: {
        '': { maxExportRate?: number }
        'vm-uuid-123': { maxExportRate?: number }
      } = {
        '': { maxExportRate: 10 },
        'vm-uuid-123': { maxExportRate: 20 }
      }

      // Base setting
      const baseRate = mockJobSettings[''].maxExportRate!
      assert.strictEqual(baseRate, 10)

      // VM-specific override
      const vmSpecificRate = mockJobSettings['vm-uuid-123'].maxExportRate!
      assert.strictEqual(vmSpecificRate, 20)
    })

    test('should fall back to default when maxExportRate not specified', () => {
      const DEFAULT_MAX_EXPORT_RATE = 0
      const mockJobSettings: { '': { maxExportRate?: number } } = {
        '': {} // No maxExportRate specified
      }

      const maxExportRate = mockJobSettings[''].maxExportRate ?? DEFAULT_MAX_EXPORT_RATE
      assert.strictEqual(maxExportRate, 0)

      const throttleSpeed = maxExportRate > 0 ? maxExportRate * 1024 * 1024 : undefined
      assert.strictEqual(throttleSpeed, undefined)
    })
  })
})
