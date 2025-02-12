import fs from 'node:fs';
import { MongoClient } from 'mongodb';

if (!Bun.env.DB_URI) {
  throw new Error('DB_URI environment variable is required');
}

// MongoDB setup
const client = new MongoClient(Bun.env.DB_URI);

// Retry wrapper
const withRetry = async (fn: () => Promise<any>, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries - 1) throw e;
      console.log(`Retry attempt ${i + 1}/${retries}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
};

// viralmind api - get task prompts
const get_events = async (id: string) => {
  const filepath = `./data/${id}.events.json`;
  if (fs.existsSync(filepath)) {
    console.log(`[${id}] Events exist`);
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  }

  return fetch(`https://viralmind.ai/api/races/export?sessionId=${id}`, {
    signal: AbortSignal.timeout(10000) // 10s timeout
  })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.json();
    })
    .then((events) => {
      fs.writeFileSync(filepath, JSON.stringify(events, null, 2));
      console.log(`[${id}] Events downloaded`);
      return events;
    })
    .catch((e) => {
      if (e.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw e;
    });
};

// viralmind api - get session recording
const downloadGuar = (recording_id: string) =>
  new Promise((resolve) => {
    const filepath = `./data/${recording_id}.guac`;
    let data: Buffer<ArrayBuffer> = Buffer.from([]);
    if (fs.existsSync(filepath)) {
      console.log(`[${recording_id}] Guac exists`);
      return resolve(true);
    }
    console.log(`[${recording_id}] Downloading...`);

    fetch(`https://training-gym.s3.us-east-2.amazonaws.com/recording-${recording_id}`)
      .then(async (res) => {
        if (res.status === 403) {
          console.log(`[${recording_id}] 403 error`);
          return resolve(false);
        }
        return res.arrayBuffer();
      })
      .then((buffer) => {
        if (!buffer) throw Error('No buffer found.');
        data = Buffer.from(new Uint8Array(buffer));
        if (data.includes('AccessDenied')) {
          console.log(`[${recording_id}] Access denied`);
          return resolve(false);
        }
        fs.writeFileSync(filepath, data);
        console.log(`[${recording_id}] Downloaded ${data.length} bytes`);
        resolve(true);
      })
      .catch((e) => {
        console.log(`[${recording_id}] Network error.`);
        console.log(e);
        resolve(false);
      });
  });

// .guac -> .m4v
const encodeVideo = (id: string) =>
  new Promise(async (resolve, reject) => {
    const outPath = `./data/${id}.guac.m4v`;
    if (fs.existsSync(outPath)) return resolve(true);

    const proc = Bun.spawn(['guacenc', '-s', '1280x800', '-r', '6000000', `./data/${id}.guac`], {
      stdout: 'pipe',
      stderr: 'pipe'
    });

    // Handle stdout using ReadableStream
    proc.stdout
      ?.getReader()
      .read()
      .then(function process({ done, value }) {
        if (done) return;
        if (value) console.log(new TextDecoder().decode(value));
        return proc.stdout?.getReader().read().then(process);
      });

    // Handle stderr using ReadableStream
    proc.stderr
      ?.getReader()
      .read()
      .then(function process({ done, value }) {
        if (done) return;
        if (value) console.error(new TextDecoder().decode(value));
        return proc.stderr?.getReader().read().then(process);
      });

    // Handle process completion
    await proc.exited // Bun provides a promise for process completion
      .then((code) => (code === 0 ? resolve(true) : reject(code)));
  });

const processBatch = async (batch: string[]) => {
  return Promise.all(
    batch.map(async (id: string) => {
      try {
        await withRetry(() => get_events(id));
        if (await downloadGuar(id)) {
          await encodeVideo(id);
        }
      } catch (e) {
        console.error(`[${id}] Failed:`, e.message);
      }
    })
  );
};

(async () => {
  try {
    // Connect to MongoDB
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db();

    // Get all race session IDs from MongoDB
    const sessions = await db
      .collection('race_sessions')
      .find({}, { projection: { _id: 1 } })
      .toArray();
    const ids = sessions.map((session) => session._id.toString());

    console.log('loaded %d ids', ids.length);

    const batchSize = 5;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      console.log(`Processing batch ${i / batchSize + 1}/${Math.ceil(ids.length / batchSize)}`);
      await processBatch(batch);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
})();
