import { loadEnvironmentOnce } from '../src/server/config';
import { formatPreflightReportText, runPreflightDiagnostics } from '../src/server/preflight';

async function main() {
  loadEnvironmentOnce();
  const report = await runPreflightDiagnostics({ checkDb: true });
  console.log(formatPreflightReportText(report));
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error('[MGAMMON Duo Preflight Error]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
