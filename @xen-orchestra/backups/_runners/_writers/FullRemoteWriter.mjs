import { formatFilenameDate } from '../../_filenameDate.mjs'
import { getOldEntries } from '../../_getOldEntries.mjs'
import { Task } from '../../Task.mjs'

import { MixinRemoteWriter } from './_MixinRemoteWriter.mjs'
import { AbstractFullWriter } from './_AbstractFullWriter.mjs'

export class FullRemoteWriter extends MixinRemoteWriter(AbstractFullWriter) {
  constructor(props) {
    super(props)

    // Task.wrapFnをrunメソッドに戻す
    this.run = Task.wrapFn(
      {
        name: 'export',
        data: {
          id: props.remoteId,
          type: 'remote',
          isFull: true,
        },
      },
      this.run.bind(this)
    )
  }

  // runメソッドで直接_runを呼び出す
  async run(args) {
    return this._run(args)
  }

  async _run({ maxStreamLength, timestamp, sizeContainer, stream, streamLength, vm, vmSnapshot, throttleGenerator }) {
    console.log('[DEBUG] FullRemoteWriter._run - throttleGenerator:', throttleGenerator)
    console.log('[DEBUG] FullRemoteWriter._run - typeof throttleGenerator:', typeof throttleGenerator)

    const settings = this._settings
    const job = this._job
    const scheduleId = this._scheduleId

    const adapter = this._adapter
    let metadata = await this._isAlreadyTransferred(timestamp)
    if (metadata !== undefined) {
      // @todo : should skip backup while being vigilant to not stuck the forked stream
      Task.info('This backup has already been transfered')
    }

    const oldBackups = getOldEntries(
      settings.exportRetention - 1,
      await adapter.listVmBackups(vm.uuid, _ => _.mode === 'full' && _.scheduleId === scheduleId),
      { longTermRetention: settings.longTermRetention, timezone: settings.timezone }
    )
    const deleteOldBackups = () => adapter.deleteFullVmBackups(oldBackups)

    const basename = formatFilenameDate(timestamp)

    const dataBasename = basename + '.xva'
    const dataFilename = this._vmBackupDir + '/' + dataBasename

    metadata = {
      jobId: job.id,
      mode: job.mode,
      scheduleId,
      timestamp,
      version: '2.0.0',
      vm,
      vmSnapshot,
      xva: './' + dataBasename,
    }

    const { deleteFirst } = settings
    if (deleteFirst) {
      await deleteOldBackups()
    }

    await Task.run({ name: 'transfer' }, async () => {
      const outputStreamOptions = {
        maxStreamLength,
        streamLength,
        validator: tmpPath => adapter.isValidXva(tmpPath),
      }

      if (throttleGenerator) {
        outputStreamOptions.throttle = throttleGenerator
      }

      await adapter.outputStream(dataFilename, stream, outputStreamOptions)
      return { size: sizeContainer.size }
    })
    metadata.size = sizeContainer.size
    this._metadataFileName = await adapter.writeVmBackupMetadata(vm.uuid, metadata)

    if (!deleteFirst) {
      await deleteOldBackups()
    }

    // TODO: run cleanup?
  }
}
