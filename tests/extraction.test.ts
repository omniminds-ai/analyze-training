import { expect, it, test } from 'bun:test';
import { VideoExtractor } from '../src/stages/extraction/video-extractor';
import { GuacExtractor } from '../src/stages/extraction/guac-extractor';
import { EventExtractor } from '../src/stages/extraction/event-extractor';
import { MessageFormatter } from '../src/stages/formatting/message-formatter';
import { visualizeEvents, visualizeMessages } from '../src/shared/utils/visualization';
import { DenseCaptionAugmenter } from '../src/stages/augmentation/dense-caption-augmenter';
import { StateTransitionAugmenter } from '../src/stages/augmentation/state-transition-augmenter';
import { StructuredDataAugmenter } from '../src/stages/augmentation/structured-data-augmenter';
import { Pipeline } from '../src/pipeline/pipeline';
import fs from 'node:fs/promises';
import path from 'path';
import { ProcessedEvent } from '../src/shared/types';

test.todo('Extraction Pipeline', () => {
  const TEST_SESSION_ID = '6792a2a124f444f0e39ce887';
  const DATA_DIR = path.join(__dirname, '../../data');

  it('should extract and visualize video frames', async () => {
    const extractor = new VideoExtractor(DATA_DIR);
    const events = await extractor.process(TEST_SESSION_ID);

    const html = visualizeEvents(events);
    await fs.writeFile(path.join(DATA_DIR, 'video_test.html'), html);

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe('frame');
  });

  it('should extract and visualize guac events', async () => {
    const extractor = new GuacExtractor(DATA_DIR);
    const events = await extractor.process(TEST_SESSION_ID);

    const html = visualizeEvents(events);
    await fs.writeFile(path.join(DATA_DIR, 'guac_test.html'), html);

    // Check for mouse events
    expect(events.some((e) => e.type === 'mouseclick')).toBe(true);
    expect(events.some((e) => e.type === 'mousedrag')).toBe(true);

    // Check for keyboard events
    expect(events.some((e) => e.type === 'hotkey')).toBe(true);
    expect(events.some((e) => e.type === 'type')).toBe(true);
  });

  it('should extract and visualize session events', async () => {
    const extractor = new EventExtractor(DATA_DIR);
    const events = await extractor.process(TEST_SESSION_ID);

    const html = visualizeEvents(events);
    await fs.writeFile(path.join(DATA_DIR, 'events_test.html'), html);

    expect(events.some((e) => e.type === 'quest' || e.type === 'hint')).toBe(true);
  });
});

test.todo('Full Pipeline Integration with Augmentation', () => {
  const TEST_SESSION_ID = '6792a2a124f444f0e39ce887';
  const DATA_DIR = path.join(__dirname, '../../data');

  it(
    'should process and merge all events',
    async () => {
      const pipeline = new Pipeline({
        dataDir: DATA_DIR,
        outputDir: DATA_DIR,
        sessionIds: [TEST_SESSION_ID],
        extractors: [
          new VideoExtractor(DATA_DIR),
          new GuacExtractor(DATA_DIR),
          new EventExtractor(DATA_DIR)
        ],
        augmenters: [
          new DenseCaptionAugmenter(1),
          new StateTransitionAugmenter(1),
          new StructuredDataAugmenter(1)
        ]
      });

      const results = await pipeline.process(TEST_SESSION_ID);
      expect(results.length).toBeGreaterThan(0);

      const html = visualizeEvents(results);
      await fs.writeFile(path.join(DATA_DIR, 'pipeline_test.html'), html);

      // Verify timeline consistency
      const timestamps = results.map((e) => e.timestamp);
      expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));

      // Verify we have synthetic events
      expect(results.some((e: ProcessedEvent) => e.type === 'dense_caption')).toBe(true);
      expect(results.some((e: ProcessedEvent) => e.type === 'state_transition')).toBe(true);
      expect(results.some((e: ProcessedEvent) => e.type === 'structured_data')).toBe(true);
    },
    { timeout: 5 * 60000 }
  );
});

test('Message Formatting', () => {
  const TEST_SESSION_ID = '6792a2a124f444f0e39ce887';
  const DATA_DIR = path.join(__dirname, '../../data');

  it(
    'should format events into messages',
    async () => {
      const pipeline = new Pipeline({
        dataDir: DATA_DIR,
        outputDir: DATA_DIR,
        sessionIds: [TEST_SESSION_ID],
        extractors: [
          new VideoExtractor(DATA_DIR),
          new GuacExtractor(DATA_DIR),
          new EventExtractor(DATA_DIR)
        ],
        augmenters: [
          new DenseCaptionAugmenter(1),
          new StateTransitionAugmenter(1),
          new StructuredDataAugmenter(1)
        ]
      });

      const events = await pipeline.process(TEST_SESSION_ID);
      expect(events.length).toBeGreaterThan(0);

      // Then format them into messages
      const formatter = new MessageFormatter();
      const messages = await formatter.process(events);

      // Write formatted messages visualization
      const html = visualizeMessages(messages);
      await fs.writeFile(path.join(DATA_DIR, 'messages_test.html'), html);

      // Verify message formatting
      for (const msg of messages) {
        expect(msg).toHaveProperty('role');
        expect(msg).toHaveProperty('content');
        expect(msg).toHaveProperty('timestamp');

        if (msg.role === 'user') {
          if (typeof msg.content === 'object') {
            expect(msg.content.type).toBe('image');
            expect(msg.content.data).toBeDefined();
          } else {
            // For hint events
            expect(typeof msg.content).toBe('string');
          }
        }
      }
    },
    { timeout: 5 * 60000 }
  );
});
