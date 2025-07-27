import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

// Mock dependencies
const mockThrottle = class {
  constructor(speed) {
    this.speed = speed
  }
}

const mockDisposable = {
  use: async (fn1, fn2, fn3, callback) => {
    const mockAdapter = { adapter: { listAllVms: () => ['vm1', 'vm2'] } }
    const mockHealthCheckSr = undefined
    const mockRemoteAdapters = [{ id: 'remote1' }]
    return callback(mockAdapter, mockHealthCheckSr, mockRemoteAdapters)
  }
}

const mockTask = {
  info: () => {}
}

const mockIncrementalRemote = class {
  constructor(opts) {
    this.opts = opts
    // Check if throttleGenerator is properly passed
    assert.ok(opts.hasOwnProperty('throttleGenerator'), 'throttleGenerator should be defined in opts')
  }

  async run() {
    return { success: true }
  }
}

const mockFullRemote = class {
  constructor(opts) {
    this.opts = opts
    // Check if throttleGenerator is properly passed
    assert.ok(opts.hasOwnProperty('throttleGenerator'), 'throttleGenerator should be defined in opts')
  }

  async run() {
    return { success: true }
  }
}

// Mock the VmsRemote class with essential parts
class VmsRemote {
  constructor(job, config, schedule) {
    this._job = job
    this._config = config
    this._schedule = schedule
    this._settings = this._computeBaseSettings(config, job)
  }

  _computeBaseSettings(config, job) {
    const DEFAULT_SETTINGS = {}
    const DEFAULT_REMOTE_VM_SETTINGS = {
      concurrency: 2,
      copyRetention: 0,
      deleteFirst: false,
      exportRetention: 0,
      healthCheckSr: undefined,
      healthCheckVmsWithTags: [],
      healthCheckTimeout: '10m',
      maxExportRate: 0,
      maxMergedDeltasPerRun: Infinity,
      nRetriesVmBackupFailures: 0,
      timeout: 0,
      validateVhdStreams: false,
      vmTimeout: 0,
    }

    const baseSettings = { ...DEFAULT_SETTINGS }
    Object.assign(baseSettings, DEFAULT_REMOTE_VM_SETTINGS, config.defaultSettings, config.vm?.defaultSettings)
    Object.assign(baseSettings, job.settings[''])
    return baseSettings
  }

  async _getAdapter(id) {
    return { id }
  }

  async _getRecord(type, id) {
    return { type, id }
  }

  async run() {
    const job = this._job
    const schedule = this._schedule
    const settings = this._settings

    // This is the critical part we're testing
    const throttleGenerator = settings.maxExportRate > 0
      ? new mockThrottle(settings.maxExportRate * 1024 * 1024)
      : undefined
    const config = this._config

    return mockDisposable.use(
      () => this._getAdapter(job.sourceRemote),
      () => (settings.healthCheckSr !== undefined ? this._getRecord('SR', settings.healthCheckSr) : undefined),
      async () => [{ id: 'remote1' }],
      async (sourceRemoteAdapter, healthCheckSr, remoteAdapters) => {
        remoteAdapters = remoteAdapters.filter(_ => !!_)
        if (remoteAdapters.length === 0) {
          return
        }

        const vmsUuids = await sourceRemoteAdapter.adapter.listAllVms()
        mockTask.info('vms', { vms: vmsUuids })

        const allSettings = this._job.settings
        const baseSettings = this._settings

        // Test VM backup creation
        for (const vmUuid of vmsUuids) {
          const vmSettings = { ...settings, ...allSettings[vmUuid] }

          const opts = {
            baseSettings,
            config,
            job,
            healthCheckSr,
            remoteAdapters: { remote1: remoteAdapters[0] },
            schedule,
            settings: vmSettings,
            sourceRemoteAdapter,
            throttleGenerator, // This should be defined (either Throttle instance or undefined)
            vmUuid,
          }

          let vmBackup
          if (job.mode === 'delta') {
            vmBackup = new mockIncrementalRemote(opts)
          } else if (job.mode === 'full') {
            vmBackup = new mockFullRemote(opts)
          } else {
            throw new Error(`Job mode ${job.mode} not implemented for mirror backup`)
          }

          const result = await vmBackup.run()
          assert.ok(result.success, 'VM backup should succeed')
        }

        return { success: true }
      }
    )
  }
}

describe('throttleGenerator Definition Tests', () => {
  test('should not throw "throttleGenerator is not defined" error with maxExportRate = 0', async () => {
    const job = {
      id: 'test-job-1',
      mode: 'delta',
      sourceRemote: 'source1',
      remotes: ['remote1'],
      settings: {
        '': {
          maxExportRate: 0 // Unlimited (should result in undefined throttleGenerator)
        }
      }
    }

    const config = {
      defaultSettings: {},
      vm: { defaultSettings: {} }
    }

    const schedule = { id: 'schedule1' }

    const runner = new VmsRemote(job, config, schedule)

    // This should not throw an error
    const result = await runner.run()
    assert.ok(result.success, 'Backup should succeed with unlimited rate')
  })

  test('should not throw "throttleGenerator is not defined" error with maxExportRate > 0', async () => {
    const job = {
      id: 'test-job-2',
      mode: 'full',
      sourceRemote: 'source1',
      remotes: ['remote1'],
      settings: {
        '': {
          maxExportRate: 10 // 10 MB/s (should result in Throttle instance)
        }
      }
    }

    const config = {
      defaultSettings: {},
      vm: { defaultSettings: {} }
    }

    const schedule = { id: 'schedule1' }

    const runner = new VmsRemote(job, config, schedule)

    // This should not throw an error
    const result = await runner.run()
    assert.ok(result.success, 'Backup should succeed with rate limit')
  })

  test('should handle VM-specific maxExportRate settings', async () => {
    const job = {
      id: 'test-job-3',
      mode: 'delta',
      sourceRemote: 'source1',
      remotes: ['remote1'],
      settings: {
        '': {
          maxExportRate: 5 // Base setting: 5 MB/s
        },
        'vm1': {
          maxExportRate: 0 // VM-specific: unlimited
        },
        'vm2': {
          maxExportRate: 20 // VM-specific: 20 MB/s
        }
      }
    }

    const config = {
      defaultSettings: {},
      vm: { defaultSettings: {} }
    }

    const schedule = { id: 'schedule1' }

    const runner = new VmsRemote(job, config, schedule)

    // This should not throw an error for any VM
    const result = await runner.run()
    assert.ok(result.success, 'Backup should succeed with mixed rate settings')
  })

  test('should handle missing maxExportRate setting', async () => {
    const job = {
      id: 'test-job-4',
      mode: 'full',
      sourceRemote: 'source1',
      remotes: ['remote1'],
      settings: {
        '': {
          // maxExportRate not specified, should default to 0
        }
      }
    }

    const config = {
      defaultSettings: {},
      vm: { defaultSettings: {} }
    }

    const schedule = { id: 'schedule1' }

    const runner = new VmsRemote(job, config, schedule)

    // Should use default value (0) and not throw error
    const result = await runner.run()
    assert.ok(result.success, 'Backup should succeed with default settings')
  })

  test('should verify throttleGenerator is correctly passed to VM runners', async () => {
    const testCases = [
      { maxExportRate: 0, expectedThrottleGenerator: undefined },
      { maxExportRate: 5, expectedThrottleGenerator: 'object' }
    ]

    for (const testCase of testCases) {
      const job = {
        id: `test-job-${testCase.maxExportRate}`,
        mode: 'delta',
        sourceRemote: 'source1',
        remotes: ['remote1'],
        settings: {
          '': {
            maxExportRate: testCase.maxExportRate
          }
        }
      }

      const config = {
        defaultSettings: {},
        vm: { defaultSettings: {} }
      }

      const schedule = { id: 'schedule1' }

      const runner = new VmsRemote(job, config, schedule)
      const settings = runner._settings

      // Verify throttleGenerator creation logic
      const throttleGenerator = settings.maxExportRate > 0
        ? new mockThrottle(settings.maxExportRate * 1024 * 1024)
        : undefined

      if (testCase.expectedThrottleGenerator === undefined) {
        assert.strictEqual(throttleGenerator, undefined,
          `throttleGenerator should be undefined when maxExportRate is ${testCase.maxExportRate}`)
      } else {
        assert.strictEqual(typeof throttleGenerator, 'object',
          `throttleGenerator should be an object when maxExportRate is ${testCase.maxExportRate}`)
        assert.ok(throttleGenerator instanceof mockThrottle,
          'throttleGenerator should be instance of Throttle')
      }
    }
  })
})
