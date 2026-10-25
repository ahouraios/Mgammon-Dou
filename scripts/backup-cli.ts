import 'dotenv/config';
import path from 'path';
import { initializeDatabase, resetPool, sanitizeDbErrorMessage } from '../src/server/db';
import {
  createFullBackup,
  listAvailableBackups,
  restoreFromBackupArchive,
  verifyBackupArchive,
} from '../src/server/backup';

async function main() {
  const command = (process.argv[2] || 'create').trim().toLowerCase();
  const argPath = process.argv[3] ? path.resolve(process.cwd(), process.argv[3]) : '';

  try {
    await initializeDatabase();

    if (command === 'create') {
      const result = await createFullBackup();
      console.log(
        JSON.stringify(
          {
            ok: true,
            action: 'BACKUP_CREATED',
            backupId: result.manifest.backupId,
            backupFilePath: result.backupFilePath,
            sqlDumpFilePath: result.sqlDumpFilePath,
            sizeBytes: result.sizeBytes,
            checksum: result.manifest.payloadChecksum,
            tableCounts: result.manifest.tableCounts,
            financialSums: result.manifest.financialSums,
            mediaFilesCount: result.manifest.mediaFilesCount,
          },
          null,
          2
        )
      );
      await resetPool();
      process.exit(0);
    }

    if (command === 'verify') {
      if (!argPath) {
        console.error('Usage: npx tsx scripts/backup-cli.ts verify <path-to-backup.mgbackup.json>');
        process.exit(1);
      }
      const check = verifyBackupArchive(argPath);
      if (!check.valid) {
        console.error(JSON.stringify({ ok: false, reason: check.reason }));
        process.exit(2);
      }
      console.log(JSON.stringify({ ok: true, manifest: check.manifest }, null, 2));
      await resetPool();
      process.exit(0);
    }

    if (command === 'list') {
      const list = listAvailableBackups();
      console.log(JSON.stringify({ ok: true, count: list.length, backups: list }, null, 2));
      await resetPool();
      process.exit(0);
    }

    if (command === 'restore') {
      if (!argPath) {
        console.error('Usage: npx tsx scripts/backup-cli.ts restore <path-to-backup.mgbackup.json> [--confirm-live]');
        process.exit(1);
      }
      const allowLive = process.argv.includes('--confirm-live');
      const restored = await restoreFromBackupArchive(argPath, {
        allowLiveDatabaseRestore: allowLive,
      });
      console.log(
        JSON.stringify(
          {
            ok: true,
            action: 'BACKUP_RESTORED',
            backupId: restored.restoredManifest.backupId,
            restoredMediaFilesCount: restored.restoredMediaFilesCount,
            postRestoreMetrics: restored.postRestoreMetrics,
          },
          null,
          2
        )
      );
      await resetPool();
      process.exit(0);
    }

    console.error(`Unknown command: ${command}. Supported commands: create | verify | list | restore`);
    process.exit(1);
  } catch (err) {
    console.error(
      JSON.stringify({
        ok: false,
        error: sanitizeDbErrorMessage(err),
      })
    );
    await resetPool();
    process.exit(1);
  }
}

main();
