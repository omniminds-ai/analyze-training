import { readFileSync } from "fs";
import { PipelineStage, ProcessedEvent } from "../../shared/types";
import { join } from "path";

type KeyId = 
  | 'Escape' | 'Return' | 'Backspace' | 'Left' | 'Right' | 'Up' | 'Down' | 'Space'
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
  | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z'
  | 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8' | 'F9' | 'F10' | 'F11' | 'F12'
  | 'Zero' | 'One' | 'Two' | 'Three' | 'Four' | 'Five' | 'Six' | 'Seven' | 'Eight' | 'Nine'
  | 'Shift' | 'LeftCtrl' | 'RightCtrl' | 'LeftAlt' | 'RightAlt'
  | 'CapsLock' | 'Pause' | 'PageUp' | 'PageDown' | 'PrintScreen' | 'Insert' | 'End' | 'Home' | 'Delete'
  | 'Add' | 'Subtract' | 'Multiply' | 'Separator' | 'Decimal' | 'Divide'
  | 'BackTick' | 'BackSlash' | 'ForwardSlash' | 'Plus' | 'Minus' | 'FullStop' | 'Comma'
  | 'Tab' | 'Numlock' | 'LeftSquareBracket' | 'RightSquareBracket' | 'SemiColon' | 'Apostrophe' | 'Hash';

interface InputEvent {
  event: string;
  data: {
    x?: number;
    y?: number;
    key?: KeyId;
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
  private symbolMap: { [key in KeyId]?: string } = {
    // Regular symbols
    'Space': ' ',
    'BackTick': '`',
    'BackSlash': '\\',
    'ForwardSlash': '/',
    'Plus': '+',
    'Minus': '-',
    'FullStop': '.',
    'Comma': ',',
    'LeftSquareBracket': '[',
    'RightSquareBracket': ']',
    'SemiColon': ';',
    'Apostrophe': "'",
    'Hash': '#',
    'Add': '+',
    'Subtract': '-',
    'Multiply': '*',
    'Divide': '/',
    'Decimal': '.',
    // Numbers
    'Zero': '0',
    'One': '1',
    'Two': '2',
    'Three': '3',
    'Four': '4',
    'Five': '5',
    'Six': '6',
    'Seven': '7',
    'Eight': '8',
    'Nine': '9'
  };

  private shiftSymbolMap: { [key in KeyId]?: string } = {
    // Shifted numbers
    'Zero': ')',
    'One': '!',
    'Two': '@',
    'Three': '#',
    'Four': '$',
    'Five': '%',
    'Six': '^',
    'Seven': '&',
    'Eight': '*',
    'Nine': '(',
    // Shifted symbols
    'BackTick': '~',
    'Minus': '_',
    'Plus': '+',
    'LeftSquareBracket': '{',
    'RightSquareBracket': '}',
    'BackSlash': '|',
    'SemiColon': ':',
    'Apostrophe': '"',
    'Comma': '<',
    'FullStop': '>',
    'ForwardSlash': '?'
  };

  constructor(private dataDir: string) {}

  private isSpecialKey(key: KeyId): boolean {
    const specialKeys = new Set<KeyId>([
      'Shift',
      'LeftCtrl', 'RightCtrl',
      'LeftAlt', 'RightAlt',
      'Return', 'Backspace', 'Tab', 'Escape',
      'Left', 'Right', 'Up', 'Down',
      'Home', 'End', 'PageUp', 'PageDown',
      'Insert', 'Delete',
      'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
      'CapsLock', 'Pause', 'PrintScreen', 'Numlock',
    ]);
    return specialKeys.has(key);
  }

  private isComboKey(key: KeyId): boolean {
    const specialKeys = new Set<KeyId>([
      'Shift',
      'LeftCtrl', 'RightCtrl',
      'LeftAlt', 'RightAlt'
    ]);
    return specialKeys.has(key);
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
    let activeModifiers = new Set<KeyId>();
    let sequenceModifiers = new Set<KeyId>();
    let currentText = '';
    let textStartTime: number | null = null;
    let lastKeyTime: number | null = null;
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
        sequenceModifiers.clear();
      }
    };

    if (events.length === 0) return [];
    const epoch = events[0].time;

    for (const event of events) {
      const time = event.time - epoch;
      
      // Check if we need to flush text based on time since last key
      if (currentText && lastKeyTime !== null && time - lastKeyTime > 1000) {
        flushText();
      }
      
      switch (event.event) {
        case 'mousemove': {
          if (event.data.x !== undefined && event.data.y !== undefined) {
            lastKnownPos = { x: event.data.x, y: event.data.y };
            if (mouseDown) {
              accumulatedPoints.push({
                time: time - (mouseDownTime || time),
                x: event.data.x,
                y: event.data.y
              });
            }
          }
          break;
        }

        case 'mousedown': {
          flushText();
          if (event.data.button === 'Left' && lastKnownPos) {
            mouseDown = true;
            mouseDownTime = time;
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
            const duration = time - mouseDownTime;
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
            if (this.isComboKey(event.data.key)) {
              activeModifiers.add(event.data.key);
              sequenceModifiers.add(event.data.key);
            } else if (activeModifiers.size > 0 && !activeModifiers.has('Shift')) {
              // Only treat as hotkey if we have non-Shift modifiers
              let modifiers = Array.from(activeModifiers);
              const finalKey = event.data.key.toString().toLowerCase();
              const hotkeyStr = [...modifiers, finalKey].join('-');
              
              processedEvents.push({
                type: 'hotkey',
                timestamp: time,
                data: { text: hotkeyStr }
              });
              
              // Clear modifiers after using them
              activeModifiers.clear();
              sequenceModifiers.clear();
            } else if (this.isSpecialKey(event.data.key)) {
              flushText();
              processedEvents.push({
                type: 'hotkey',
                timestamp: time,
                data: { text: event.data.key }
              });
            } else {
              // Handle regular typing, including Shift+letter for capitals
              const hasShift = activeModifiers.has('Shift');
              const mappedKey = hasShift 
                ? this.shiftSymbolMap[event.data.key] || this.symbolMap[event.data.key]
                : this.symbolMap[event.data.key];
                
              if (mappedKey) {
                // Symbol or shifted symbol - output the mapped character
                const charToAdd = mappedKey;
                if (!textStartTime) {
                  textStartTime = time;
                }
                lastKeyTime = time;
                currentText = !currentText ? charToAdd : currentText + charToAdd;
              } else {
                // Letter key - handle case based on Shift
                const isLetter = /^[A-Z]$/.test(event.data.key.toString());
                const hasShift = activeModifiers.has('Shift');
                const charToAdd = isLetter 
                  ? (hasShift ? event.data.key.toString() : event.data.key.toString().toLowerCase())
                  : event.data.key.toString().toLowerCase();
                
                if (!textStartTime) {
                  textStartTime = time;
                }
                lastKeyTime = time;
                currentText = !currentText ? charToAdd : currentText + charToAdd;
              }
            }
          }
          break;
        }

        case 'keyup': {
          if (event.data.key && this.isSpecialKey(event.data.key)) {
            activeModifiers.delete(event.data.key);
            
            // If all modifiers are released and we have a sequence to emit
            if (activeModifiers.size === 0) {
              if(sequenceModifiers.size > 0 && currentText === '') {
                const modifierStr = Array.from(sequenceModifiers).join('-');
                processedEvents.push({
                  type: 'hotkey',
                  timestamp: time,
                  data: { text: modifierStr }
                });
              }
              sequenceModifiers.clear();
            }
          }
          break;
        }

        case 'mousewheel': {
          flushText();
          if (event.data.delta !== undefined) {
            processedEvents.push({
              type: 'mousewheel',
              timestamp: time,
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
