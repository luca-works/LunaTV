/**
 * @jest-environment node
 */

import fs from 'fs';
import path from 'path';

describe('EpisodeSelector source speed layout', () => {
  it('keeps speed, latency, and quality in one non-overlapping row without truncating speed', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/components/EpisodeSelector.tsx'),
      'utf8'
    );
    const start = source.indexOf("data-testid='source-speed-metrics'");
    const end = source.indexOf('{/* 源名称和集数信息', start);
    const metricsBlock = source.slice(start, end);

    expect(source).toContain("data-testid='source-speed-metrics'");
    expect(source).toContain("data-testid='source-quality-badge'");
    expect(metricsBlock).toContain('renderSourceQualityBadge(videoInfo)');
    expect(metricsBlock).toContain('justify-between');
    expect(metricsBlock).not.toContain('truncate');
    expect(metricsBlock).not.toContain('pr-20');
    expect(metricsBlock).not.toContain('absolute bottom-0 right-0');
  });
});
