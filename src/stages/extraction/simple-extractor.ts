import { readFileSync } from "fs";
import { PipelineStage, ProcessedEvent } from "../../shared/types";
import { join } from "path";

interface InputEvent {
  event: string;
  data: {
    x?: number;
    y?: number;
    key?: string;
    button?: string;
    delta?: number;
    id?: number;
    axis?: string;
    value?: number;
    output?: string;
  };
  time: number;
}

export class GymDesktopExtractor implements PipelineStage<string, ProcessedEvent[]> {
  constructor(private dataDir: string) {}

  private isSpecialKey(key: string): boolean {
    const specialKeys = new Set([
      'Shift', 'Control', 'Alt', 'Meta',
      'Enter', 'Backspace', 'Tab', 'Escape',
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
      'Home', 'End', 'PageUp', 'PageDown',
      'Insert', 'Delete',
      'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'
    ]);
    return specialKeys.has(key) || key.startsWith('F');
  }

  private resamplePoints(
    points: Array<{ time: number; x: number; y: number }>,
    numPoints: number = 8
  ): Array<{ time: number; x: number; y: number }> {
    if (points.length <= 1) return points;

    // Calculate total path length for parameterization
    let totalLength = 0;
    const segments: number[] = [0];

    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      totalLength += Math.sqrt(dx * dx + dy * dy);
      segments.push(totalLength);
    }

    // Generate evenly spaced points along the path
    const resampled: Array<{ time: number; x: number; y: number }> = [];

    for (let i = 0; i < numPoints; i++) {
      const targetLength = (i / (numPoints - 1)) * totalLength;

      // Find segment containing target length
      let segIdx = 1;
      while (segIdx < segments.length && segments[segIdx] < targetLength) {
        segIdx++;
      }

      // Interpolate within segment
      const prevIdx = segIdx - 1;
      const segmentStart = segments[prevIdx];
      const segmentEnd = segments[segIdx];
      const t = (targetLength - segmentStart) / (segmentEnd - segmentStart);

      const p0 = points[prevIdx];
      const p1 = points[segIdx];

      resampled.push({
        x: Math.floor(p0.x + (p1.x - p0.x) * t),
        y: Math.floor(p0.y + (p1.y - p0.y) * t),
        time: Math.floor(p0.time + (p1.time - p0.time) * t)
      });
    }

    return resampled;
  }

  private processEvents(events: InputEvent[]): ProcessedEvent[] {
    const processedEvents: ProcessedEvent[] = [];
    let mouseDown = false;
    let mouseDownTime: number | null = null;
    let mouseDownPos: { x: number; y: number } | null = null;
    let accumulatedPoints: Array<{ time: number; x: number; y: number }> = [];
    let activeModifiers = new Set<string>();
    let currentText = '';
    let textStartTime: number | null = null;
    let lastKnownPos: { x: number; y: number } | null = null;

    const CLICK_THRESHOLD_PX = 5;
    const CLICK_THRESHOLD_MS = 500;

    const flushText = () => {
      if (currentText && textStartTime !== null) {
        processedEvents.push({
          type: 'type',
          timestamp: textStartTime,
          data: { text: currentText }
        });
        currentText = '';
        textStartTime = null;
      }
    };

    for (const event of events) {
      switch (event.event) {
        case 'mousemove': {
          if (event.data.x !== undefined && event.data.y !== undefined) {
            lastKnownPos = { x: event.data.x, y: event.data.y };
            if (mouseDown) {
              accumulatedPoints.push({
                time: event.time - (mouseDownTime || event.time),
                x: event.data.x,
                y: event.data.y
              });
            }
          }
          break;
        }

        case 'mousedown': {
          if (event.data.button === 'Left' && lastKnownPos) {
            mouseDown = true;
            mouseDownTime = event.time;
            mouseDownPos = { ...lastKnownPos };
            accumulatedPoints = [{
              time: 0,
              x: lastKnownPos.x,
              y: lastKnownPos.y
            }];
          }
          break;
        }

        case 'mouseup': {
          if (event.data.button === 'Left' && mouseDownPos && mouseDownTime && lastKnownPos) {
            const duration = event.time - mouseDownTime;
            const distance = Math.sqrt(
              Math.pow(lastKnownPos.x - mouseDownPos.x, 2) +
              Math.pow(lastKnownPos.y - mouseDownPos.y, 2)
            );

            if (distance <= CLICK_THRESHOLD_PX && duration <= CLICK_THRESHOLD_MS) {
              processedEvents.push({
                type: 'mouseclick',
                timestamp: mouseDownTime,
                data: {
                  x: mouseDownPos.x,
                  y: mouseDownPos.y
                }
              });
            } else if (accumulatedPoints.length > 1) {
              // Resample the path to fixed number of control points
              const splinePoints = this.resamplePoints(accumulatedPoints);
              processedEvents.push({
                type: 'mousedrag',
                timestamp: mouseDownTime,
                data: {
                  coordinates: splinePoints
                }
              });
            }

            mouseDown = false;
            mouseDownTime = null;
            mouseDownPos = null;
            accumulatedPoints = [];
          }
          break;
        }

        case 'keydown': {
          if (event.data.key) {
            if (this.isSpecialKey(event.data.key)) {
              flushText();
              activeModifiers.add(event.data.key);
              
              // Only create hotkey event if it's not just a modifier
              if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.data.key)) {
                const modifiers = Array.from(activeModifiers);
                const hotkeyStr = modifiers.length > 1 
                  ? `${modifiers.slice(0, -1).join('-')}-${modifiers[modifiers.length - 1]}`
                  : modifiers[0];
                
                processedEvents.push({
                  type: 'hotkey',
                  timestamp: event.time,
                  data: { text: hotkeyStr }
                });
              }
            } else if (activeModifiers.size === 0) {
              if (!textStartTime) {
                textStartTime = event.time;
              }
              currentText += event.data.key;
            }
          }
          break;
        }

        case 'keyup': {
          if (event.data.key && this.isSpecialKey(event.data.key)) {
            activeModifiers.delete(event.data.key);
          }
          break;
        }

        case 'mousewheel': {
          if (event.data.delta !== undefined) {
            processedEvents.push({
              type: 'mousewheel',
              timestamp: event.time,
              data: { delta: event.data.delta }
            });
          }
          break;
        }
      }
    }

    // Flush any remaining text
    flushText();

    return processedEvents;
  }

  async process(sessionId: string): Promise<ProcessedEvent[]> {
    const jsonlPath = join(this.dataDir, sessionId, 'input_log.jsonl');

    // Read and parse the JSONL file
    const jsonlContent = readFileSync(jsonlPath, 'utf-8');
    const events: InputEvent[] = jsonlContent
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    return this.processEvents(events);
  }
}
