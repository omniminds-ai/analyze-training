import fs from 'node:fs';
import path from 'path';
import { PipelineStage, ProcessedEvent, RawEventsFile, RawSession } from '../../shared/types';

export class EventExtractor implements PipelineStage<string, ProcessedEvent[]> {
  constructor(private dataDir: string) {}

  private loadSession(sessionId: string): RawSession {
    const sessionPath = path.join(this.dataDir, 'viralmind.race_sessions.json');
    const sessions: RawSession[] = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    const session = sessions.find((s) => s._id.$oid === sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    return session;
  }

  async process(sessionId: string): Promise<ProcessedEvent[]> {
    const eventPath = path.join(this.dataDir, `${sessionId}.events.json`);
    const rawEvents: RawEventsFile = JSON.parse(fs.readFileSync(eventPath, 'utf8'));

    // Get base timestamp either from events file or session
    let baseTimestamp: number;
    if (rawEvents.timestamp) {
      baseTimestamp = rawEvents.timestamp;
    } else {
      const session = this.loadSession(sessionId);
      baseTimestamp = new Date(session.created_at.$date).getTime();
    }

    return rawEvents.events
      .filter((e) => e.message)
      .map((event) => ({
        type: event.type as 'quest' | 'hint',
        timestamp: event.timestamp - baseTimestamp, // Convert to relative time
        data: { message: event.message }
      }));
  }
}
