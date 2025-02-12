import { test, it, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'path';
import { PaintPipeline } from '../src/pipeline/paint-pipeline';
import { MessageFormatter } from '../src/stages/formatting/message-formatter';
import { OpenAIUtils } from '../src/shared/utils/openai';

// this uses the cached fine-tuning job
// turn this on when recording a demo so you don't have to wait 1 hour
const SKIP_FINETUNING = true;

test('PaintPipeline - Fine-tuning Dataset Generation', () => {
  const NUM_TRAJECTORIES = 1; // Number of trajectories to generate
  const DATA_DIR = path.join(__dirname, '../../data');
  const METADATA_PATH = path.join(DATA_DIR, 'jspaint_0.json');
  const OUTPUT_DIR = path.join(DATA_DIR, 'finetune');

  // Create output directory if it doesn't exist
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  it(
    'should generate fine-tuning dataset',
    async () => {
      // Get list of available doodle files
      const doodleDir = path.join(DATA_DIR, 'doodles');
      const doodleFiles = fs
        .readdirSync(doodleDir)
        .filter((f) => f.endsWith('.ndjson'))
        .map((f) => f.replace('.ndjson', ''));

      // Initialize pipeline and formatter
      const pipeline = new PaintPipeline(DATA_DIR, METADATA_PATH);
      const formatter = new MessageFormatter();

      // Open write stream for JSONL output
      const outputPath = path.join(OUTPUT_DIR, `finetune_${NUM_TRAJECTORIES}_dataset.jsonl`);
      const writeStream = fs.createWriteStream(outputPath);

      // Stats tracking
      let totalMessages = 0;
      let imageMessages = 0;
      let textMessages = 0;
      let validTrajectories = 0;
      let skippedTrajectories = 0;

      // Generate trajectories
      for (let i = 0; i < NUM_TRAJECTORIES; i++) {
        // Generate events for 5 random doodles
        const events = await pipeline.process(doodleFiles, 2);

        // Format into messages
        const messages = await formatter.process(events);

        // Validate messages
        for (const msg of messages) {
          expect(msg).toHaveProperty('role');
          expect(msg).toHaveProperty('content');
          expect(msg).toHaveProperty('timestamp');
        }

        // Convert to OpenAI format
        const openaiMessages = OpenAIUtils.convertToOpenAIFormat(messages);

        // Check token count
        const tokenCount = OpenAIUtils.countConversationTokens(openaiMessages);
        if (tokenCount > OpenAIUtils.MAX_TOKENS) {
          console.log(`Skipping trajectory ${i + 1} - exceeds token limit (${tokenCount} tokens)`);
          skippedTrajectories++;
          continue;
        }

        // Update stats
        totalMessages += messages.length;
        imageMessages += messages.filter(
          (m) => typeof m.content === 'object' && m.content.type === 'image'
        ).length;
        textMessages += messages.filter((m) => typeof m.content === 'string').length;
        validTrajectories++;

        // Write to file
        writeStream.write(JSON.stringify({ messages: openaiMessages }) + '\n');

        // Log progress
        console.log(
          `Generated trajectory ${i + 1}/${NUM_TRAJECTORIES} (${validTrajectories} valid, ${skippedTrajectories} skipped)`
        );
      }

      // Close write stream
      writeStream.end();

      // Generate stats
      const stats = {
        totalTrajectories: validTrajectories,
        skippedTrajectories,
        totalMessages,
        avgMessagesPerTrajectory: totalMessages / validTrajectories,
        imageMessages,
        textMessages
      };

      // Save stats
      const statsPath = path.join(OUTPUT_DIR, `dataset_${NUM_TRAJECTORIES}_stats.json`);
      fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));

      console.log('Dataset generation complete!');
      console.log('Stats:', stats);
      console.log(`Dataset saved to: ${outputPath}`);
      console.log(`Stats saved to: ${statsPath}`);
    },
    { timeout: 20 * 60 * 1000 }
  );

  it(
    'should finetune the painting model',
    async () => {
      if (SKIP_FINETUNING) {
        console.log('fine-tuning skipped: model already exists!');
      } else {
        console.log('fine-tuning via openai lib not yet implemented');
        console.log('please upload the .jsonl to https://platform.openai.com/finetune/');
        return;
      }

      // Load and log finetuning stats
      const statsPath = path.join(DATA_DIR, 'finetuning_stats.json');
      const stats = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));

      console.log('\nFinetuning Stats:');
      console.log('------------------');
      console.log(`Job ID: ${stats.jobId}`);
      console.log(`Model: ${stats.outputModel}`);
      console.log(`Trained Tokens: ${stats.trainedTokens.toLocaleString()}`);
      console.log(`Epochs: ${stats.epochs}`);
      console.log(`Batch Size: ${stats.batchSize}`);
      console.log(`Learning Rate Multiplier: ${stats.lrMultiplier}`);
      console.log(`Training Method: ${stats.trainingMethod}`);
      console.log(`Final Loss: ${stats.finalLoss}`);
      console.log(`Time Taken: ${stats.timeTaken}`);

      console.log('\n🎊 Your model has been trained!\n');

      // Calculate cost
      const costUSD = (stats.trainedTokens / 1_000_000) * 25;
      const costSOL = (costUSD * 0.1) / 25; // $25 = 0.10 SOL conversion
      console.log(`Cost: ${costSOL.toFixed(4)} SOL`);
    },
    { timeout: 120 * 60 * 1000 }
  );
});
