import { AbstractRemote } from './_AbstractRemote.mjs'
import { FullRemoteWriter } from '../_writers/FullRemoteWriter.mjs'
import { forkStreamUnpipe } from '../_forkStreamUnpipe.mjs'
import { watchStreamSize } from '../../_watchStreamSize.mjs'

export const FullRemote = class FullRemoteVmBackupRunner extends AbstractRemote {
  constructor(opts) {
    super(opts)
    this._throttleGenerator = opts?.throttleGenerator
  }

  _getRemoteWriter() {
    return FullRemoteWriter
  }

  _filterTransferList(transferList) {
    return transferList.filter(this._filterPredicate)
  }

  async _run() {
    const transferList = await this._computeTransferList(({ mode }) => mode === 'full')

    console.log('[DEBUG] FullRemote._run - this._throttleGenerator:', this._throttleGenerator)

    for (const metadata of transferList) {
      const stream = await this._sourceRemoteAdapter.readFullVmBackup(metadata)
      const sizeContainer = watchStreamSize(stream)

      await this._callWriters(
        writer =>
          writer.run({
            stream: forkStreamUnpipe(stream),
            streamLength: stream.length,
            maxStreamLength: stream.maxStreamLength,
            timestamp: metadata.timestamp,
            vm: metadata.vm,
            vmSnapshot: metadata.vmSnapshot,
            sizeContainer,
            throttleGenerator: this._throttleGenerator || undefined,
          }),
        'writer.run()'
      )
      this._tags = metadata.vm.tags
    }
  }
}
