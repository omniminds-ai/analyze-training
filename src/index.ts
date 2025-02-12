import { Pipeline } from './pipeline/pipeline';
import { visualizeEvents } from './shared/utils/visualization';
import { DenseCaptionAugmenter } from './stages/augmentation/dense-caption-augmenter';
import { StateTransitionAugmenter } from './stages/augmentation/state-transition-augmenter';
import { StructuredDataAugmenter } from './stages/augmentation/structured-data-augmenter';
import { EventExtractor } from './stages/extraction/event-extractor';
import { GuacExtractor } from './stages/extraction/guac-extractor';
import { VideoExtractor } from './stages/extraction/video-extractor';
import path from 'path';

import { parseArgs } from 'util';

const { values } = parseArgs({
  args: Bun.argv,
  options: {
    data: {
      short: 'd',
      type: 'string'
    },
    out: {
      short: 'o',
      type: 'string'
    },
    sessions: {
      short: 's',
      type: 'string'
    }
  },
  strict: true,
  allowPositionals: true
});

const dataDir = values.data || '.';
const sessions = values.sessions?.split(',') || [];
const outDir = values.out || '.';

const pipeline = new Pipeline({
  dataDir: dataDir,
  outputDir: dataDir,
  sessionIds: sessions,
  extractors: [
    new VideoExtractor(dataDir),
    new GuacExtractor(dataDir),
    new EventExtractor(dataDir)
  ],
  augmenters: [
    new DenseCaptionAugmenter(1),
    new StateTransitionAugmenter(1),
    new StructuredDataAugmenter(1)
  ]
});

for (const session of sessions) {
  const results = await pipeline.process(session);
  const html = visualizeEvents(results);
  await Bun.write(path.join(outDir, `session_${session}.html`), html);
}
