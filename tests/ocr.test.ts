import { test, it, expect } from 'bun:test';
import { createWorker } from 'tesseract.js';
import path from 'path';
import fs from 'node:fs';

interface Word {
  text: string;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  confidence: number;
}

test('OCR Tests', () => {
  const TEST_IMAGE = path.join(process.cwd(), 'data', 'debug', 'ocr_frame_175000.png');

  it(
    'should extract words with bounding boxes',
    async () => {
      const worker = await createWorker('eng');

      // Get words with bounding boxes
      const { data } = await worker.recognize(TEST_IMAGE);
      const words = data.words as Word[];

      // Save results for analysis
      const debugPath = path.join(process.cwd(), 'data', 'debug');
      fs.writeFileSync(
        path.join(debugPath, 'ocr_words.json'),
        JSON.stringify(
          {
            text: data.text,
            words: words.map((w) => ({
              text: w.text,
              x: w.bbox.x0,
              y: w.bbox.y0,
              width: w.bbox.x1 - w.bbox.x0,
              height: w.bbox.y1 - w.bbox.y0,
              confidence: w.confidence
            }))
          },
          null,
          2
        )
      );

      // Log some stats
      console.log('\nOCR Results:');
      console.log(`Total words found: ${words.length}`);
      console.log('\nSample words with coordinates:');
      words.slice(0, 5).forEach((word) => {
        console.log(
          `"${word.text}" at (${word.bbox.x0},${word.bbox.y0}) confidence: ${word.confidence}%`
        );
      });

      // Group words by y-coordinate to reconstruct lines
      const lineGroups = new Map<number, Word[]>();
      const lineThreshold = 5; // pixels

      words.forEach((word) => {
        let foundLine = false;
        for (const [y, group] of lineGroups.entries()) {
          if (Math.abs(word.bbox.y0 - y) <= lineThreshold) {
            group.push(word);
            foundLine = true;
            break;
          }
        }
        if (!foundLine) {
          lineGroups.set(word.bbox.y0, [word]);
        }
      });

      console.log('\nReconstructed text lines:');
      for (const [y, group] of lineGroups.entries()) {
        const line = group
          .sort((a, b) => a.bbox.x0 - b.bbox.x0)
          .map((w) => w.text)
          .join(' ');
        console.log(`Y=${y}: ${line}`);
      }

      await worker.terminate();

      // Validation
      expect(words.length).toBeGreaterThan(0);
      expect(lineGroups.size).toBeGreaterThan(0);

      // Validate word structure
      words.forEach((word) => {
        expect(word.text).toBeDefined();
        expect(word.bbox).toBeDefined();
        expect(word.bbox.x0).toBeDefined();
        expect(word.bbox.y0).toBeDefined();
        expect(word.bbox.x1).toBeDefined();
        expect(word.bbox.y1).toBeDefined();
        expect(word.confidence).toBeDefined();
      });
    },
    { timeout: 30000 }
  );
});
