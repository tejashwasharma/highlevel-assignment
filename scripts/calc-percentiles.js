const fs = require('fs');

function parseArgs(argv) {
  const [logFile, ...rest] = argv;
  if (!logFile) {
    console.error('Usage: node scripts/calc-percentiles.js <logfile> [--path P] [--workspace ID] [--method M]');
    process.exit(1);
  }

  const filters = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (flag === '--path') filters.path = value;
    else if (flag === '--workspace') filters.workspaceId = value;
    else if (flag === '--method') filters.method = value.toUpperCase();
    else {
      console.error(`Unknown flag: ${flag}`);
      process.exit(1);
    }
  }

  return { logFile, filters };
}

function readDurations(logFile, filters) {
  const lines = fs.readFileSync(logFile, 'utf8').split('\n');
  const durations = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.message !== 'request') continue;
    if (filters.path && entry.path !== filters.path) continue;
    if (filters.workspaceId && entry.workspaceId !== filters.workspaceId) continue;
    if (filters.method && entry.method !== filters.method) continue;

    durations.push(entry.durationMs);
  }

  return durations;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(index, sorted.length - 1)];
}

function main() {
  const { logFile, filters } = parseArgs(process.argv.slice(2));
  const durations = readDurations(logFile, filters).sort((a, b) => a - b);

  if (durations.length === 0) {
    console.error('No matching request log lines found.');
    process.exit(1);
  }

  const sum = durations.reduce((a, b) => a + b, 0);

  console.log(`Requests matched: ${durations.length}`);
  if (Object.keys(filters).length > 0) {
    console.log(`Filters: ${JSON.stringify(filters)}`);
  }
  console.log(`min:  ${durations[0].toFixed(3)} ms`);
  console.log(`p50:  ${percentile(durations, 50).toFixed(3)} ms`);
  console.log(`p95:  ${percentile(durations, 95).toFixed(3)} ms`);
  console.log(`p99:  ${percentile(durations, 99).toFixed(3)} ms`);
  console.log(`max:  ${durations[durations.length - 1].toFixed(3)} ms`);
  console.log(`mean: ${(sum / durations.length).toFixed(3)} ms`);
}

if (require.main === module) {
  main();
}

module.exports = { percentile, readDurations };
