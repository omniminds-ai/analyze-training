import { test, it, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'path';
import { PaintPipeline } from '../src/pipeline/paint-pipeline';
import { MessageFormatter } from '../src/stages/formatting/message-formatter';
import { visualizeEvents, visualizeMessages } from '../src/shared/utils/visualization';

test('Synthetic Paint Pipeline', () => {
  const DATA_DIR = path.join(__dirname, '../../data');
  const METADATA_PATH = path.join(DATA_DIR, 'jspaint_0.json');

  it(
    'should generate synthetic paint events',
    async () => {
      // Get list of available doodle files
      const doodleDir = path.join(DATA_DIR, 'doodles');
      const doodleFiles = fs
        .readdirSync(doodleDir)
        .filter((f) => f.endsWith('.ndjson') && f.startsWith('whale'))
        .map((f) => f.replace('.ndjson', ''));

      // Initialize pipeline
      const pipeline = new PaintPipeline(DATA_DIR, METADATA_PATH);

      // Generate events for 5 random doodles
      const events = await pipeline.process(doodleFiles, 5);

      // Verify we have events
      expect(events.length).toBeGreaterThan(0);

      // Check we have all expected event types
      expect(events.some((e) => e.type === 'quest')).toBe(true);
      expect(events.some((e) => e.type === 'frame')).toBe(true);
      expect(events.some((e) => e.type === 'mousedrag')).toBe(true);
      expect(events.some((e) => e.type === 'reasoning')).toBe(true);

      // Verify timeline consistency
      const timestamps = events.map((e) => e.timestamp);
      expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));

      // Generate visualization
      const html = visualizeEvents(events);
      fs.writeFileSync(path.join(DATA_DIR, 'synthetic_events.html'), html);

      // Format into messages
      const formatter = new MessageFormatter();
      const messages = await formatter.process(events);

      // Generate message visualization
      const msgHtml = visualizeMessages(messages);
      fs.writeFileSync(path.join(DATA_DIR, 'synthetic_messages.html'), msgHtml);

      // Verify message formatting
      for (const msg of messages) {
        expect(msg).toHaveProperty('role');
        expect(msg).toHaveProperty('content');
        expect(msg).toHaveProperty('timestamp');
      }
    },
    { timeout: 60 * 1000 }
  );
});
