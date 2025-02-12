import fs from 'node:fs';
import path from 'path';
import { GuacInstruction, PipelineStage, ProcessedEvent } from '../../shared/types';

interface KeyEvent {
  type: 'keydown' | 'keyup';
  keyCode: number;
  text?: string;
  timestamp: number;
}

export class GuacExtractor implements PipelineStage<string, ProcessedEvent[]> {
  constructor(
    private dataDir: string,
    private splinePoints: number = 8 // Number of control points for each drag spline
  ) {}

  private parseLength(text: string): [string | null, string] {
    const match = text.match(/^(\d+)\.(.*)/);
    if (!match) return [null, text];

    const length = parseInt(match[1]);
    const remaining = match[2];
    if (remaining.length < length) return [null, text];

    return [remaining.slice(0, length), remaining.slice(length)];
  }

  private parseInstructions(content: string): GuacInstruction[] {
    const instructions: GuacInstruction[] = [];
    const raw = content.split(';');
    let firstSyncTimestamp: number | null = null;

    for (const chunk of raw) {
      if (!chunk.trim()) continue;

      const parts = chunk.trim().split(',');
      if (!parts.length) continue;

      const [opcode] = this.parseLength(parts[0]);
      if (!opcode) continue;

      const parsedParts = parts
        .slice(1)
        .map((part) => {
          const [value] = this.parseLength(part);
          return value || '';
        })
        .filter(Boolean);

      if (!parsedParts.length) continue;

      let args: string[] = [];
      let timestamp = 0;

      switch (opcode) {
        case 'sync': {
          const [rawTimestamp] = parsedParts;
          const parsedTimestamp = parseFloat(rawTimestamp);
          if (firstSyncTimestamp === null) {
            firstSyncTimestamp = parsedTimestamp;
          }
          timestamp = Math.round(parsedTimestamp - (firstSyncTimestamp || 0));
          args = [rawTimestamp];
          break;
        }
        case 'mouse': {
          const [x, y, buttonState, rawTimestamp] = parsedParts;
          timestamp = Math.round(parseFloat(rawTimestamp) - (firstSyncTimestamp || 0));
          args = [x, y, buttonState];
          break;
        }
        case 'key': {
          const [keyCode, pressed, rawTimestamp] = parsedParts;
          timestamp = Math.round(parseFloat(rawTimestamp) - (firstSyncTimestamp || 0));
          args = [keyCode, pressed];
          break;
        }
        default: {
          args = parsedParts;
        }
      }

      instructions.push({ opcode, args, timestamp });
    }

    return instructions;
  }

  private isSpecialKey(keyCode: number): boolean {
    // Check if keyCode corresponds to special keys based on the keydef
    const specialKeyCodes = new Set([
      0xfe03, // AltGr
      0xff08, // Backspace
      0xff09, // Tab
      0xff0d, // Return
      0xff1b, // Escape
      0xff50, // Home
      0xff51, // Left
      0xff52, // Up
      0xff53, // Right
      0xff54, // Down
      0xff55, // Page Up
      0xff56, // Page Down
      0xff57, // End
      0xff63, // Insert
      0xffbe, // F1-F24
      0xffbf,
      0xffc0,
      0xffc1,
      0xffc2,
      0xffc3,
      0xffc4,
      0xffc5,
      0xffc6,
      0xffc7,
      0xffc8,
      0xffc9,
      0xffca,
      0xffcb,
      0xffcc,
      0xffcd,
      0xffce,
      0xffcf,
      0xffd0,
      0xffd1,
      0xffd2,
      0xffd3,
      0xffd4,
      0xffd5,
      0xffe1, // Shift
      0xffe2, // Shift
      0xffe3, // Ctrl
      0xffe4, // Ctrl
      0xffe5, // Caps
      0xffe7, // Meta
      0xffe8, // Meta
      0xffe9, // Alt
      0xffea, // Alt
      0xffeb, // Super
      0xffec, // Super
      0xffff // Delete
    ]);
    return specialKeyCodes.has(keyCode);
  }

  private getKeyName(keyCode: number): string {
    const keyMap: { [key: number]: string } = {
      0xff08: 'backspace',
      0xff09: 'tab',
      0xff0d: 'enter',
      0xff1b: 'escape',
      0xff50: 'home',
      0xff51: 'left',
      0xff52: 'up',
      0xff53: 'right',
      0xff54: 'down',
      0xff55: 'pageup',
      0xff56: 'pagedown',
      0xff57: 'end',
      0xff63: 'insert',
      0xffff: 'delete',
      0xffe1: 'shift',
      0xffe2: 'shift',
      0xffe3: 'ctrl',
      0xffe4: 'ctrl',
      0xffe9: 'alt',
      0xffea: 'alt'
    };

    // Handle F1-F24 keys
    if (keyCode >= 0xffbe && keyCode <= 0xffd5) {
      const fKeyNum = keyCode - 0xffbe + 1;
      return `f${fKeyNum}`;
    }

    return keyMap[keyCode] || `key-${keyCode.toString(16)}`;
  }

  private processKeyboardEvents(instructions: GuacInstruction[]): ProcessedEvent[] {
    const events: ProcessedEvent[] = [];
    let currentText = '';
    let firstTimestamp: number | null = null; // Track first character timestamp
    let activeModifiers = new Set<string>();

    const flushText = () => {
      if (currentText.length > 0 && firstTimestamp !== null) {
        // console.log('Flushing text:', currentText, 'with timestamp:', firstTimestamp); // Debug log
        events.push({
          type: 'type',
          timestamp: firstTimestamp,
          data: { text: currentText }
        });
        currentText = '';
        firstTimestamp = null; // Reset first timestamp
      }
    };

    const keyEvents: KeyEvent[] = instructions
      .filter((inst) => inst.opcode === 'key' && inst.args.length >= 2)
      .map((inst) => {
        const keyCode = parseInt(inst.args[0]);
        return {
          type: inst.args[1] === '1' ? 'keydown' : 'keyup',
          keyCode: keyCode,
          text: keyCode >= 32 && keyCode <= 126 ? String.fromCharCode(keyCode) : undefined,
          timestamp: inst.timestamp
        };
      });

    for (const event of keyEvents) {
      const isModifier = event.keyCode >= 0xffe1 && event.keyCode <= 0xffee;
      const modifierName = this.getKeyName(event.keyCode);

      if (event.type === 'keydown') {
        if (isModifier) {
          activeModifiers.add(modifierName);
        } else if (this.isSpecialKey(event.keyCode)) {
          flushText();

          const modifiers = Array.from(activeModifiers);
          const keyName = this.getKeyName(event.keyCode);
          const hotkeyStr = modifiers.length ? `${modifiers.join('-')}-${keyName}` : keyName;

          events.push({
            type: 'hotkey',
            timestamp: event.timestamp,
            data: { text: hotkeyStr }
          });
        } else if (event.text && activeModifiers.size === 0) {
          // Only accumulate text when no modifiers are active
          if (currentText.length === 0) {
            firstTimestamp = event.timestamp; // Set timestamp only for first character
          }
          currentText += event.text;
          // console.log('Current text:', currentText, 'first timestamp:', firstTimestamp); // Debug log
        }
      } else if (event.type === 'keyup' && isModifier) {
        activeModifiers.delete(modifierName);
      }
    }

    // Flush any remaining text
    flushText();

    return events;
  }

  private resamplePoints(
    points: Array<{ time: number; x: number; y: number }>,
    numPoints: number
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

  private processMouseEvents(instructions: GuacInstruction[]): ProcessedEvent[] {
    const events: ProcessedEvent[] = [];
    let mouseDownTime: number | null = null;
    let mouseDownPos: { x: number; y: number } | null = null;
    let accumulatedPoints: Array<{ time: number; x: number; y: number }> = [];
    let lastButtonState = '0';

    const CLICK_THRESHOLD_PX = 5;
    const CLICK_THRESHOLD_MS = 500;

    for (const instruction of instructions) {
      if (instruction.opcode !== 'mouse' || instruction.args.length < 3) continue;

      const x = parseInt(instruction.args[0]);
      const y = parseInt(instruction.args[1]);
      const currentButtonState = instruction.args[2];

      if (currentButtonState === '1' && lastButtonState === '0') {
        mouseDownTime = instruction.timestamp;
        mouseDownPos = { x, y };
        accumulatedPoints = [
          {
            time: 0,
            x,
            y
          }
        ];
      } else if (
        currentButtonState === '0' &&
        lastButtonState === '1' &&
        mouseDownTime !== null &&
        mouseDownPos
      ) {
        const duration = instruction.timestamp - mouseDownTime;
        const distance = Math.sqrt(
          Math.pow(x - mouseDownPos.x, 2) + Math.pow(y - mouseDownPos.y, 2)
        );

        if (distance <= CLICK_THRESHOLD_PX && duration <= CLICK_THRESHOLD_MS) {
          events.push({
            type: 'mouseclick',
            timestamp: mouseDownTime,
            data: { x: mouseDownPos.x, y: mouseDownPos.y }
          });
        } else {
          // Resample the path to fixed number of control points
          const splinePoints = this.resamplePoints(accumulatedPoints, this.splinePoints);
          events.push({
            type: 'mousedrag',
            timestamp: mouseDownTime,
            data: {
              coordinates: splinePoints
            }
          });
        }

        mouseDownTime = null;
        mouseDownPos = null;
        accumulatedPoints = [];
      } else if (currentButtonState === '1' && mouseDownTime !== null) {
        accumulatedPoints.push({
          time: instruction.timestamp - mouseDownTime,
          x,
          y
        });
      }

      lastButtonState = currentButtonState;
    }

    return events;
  }

  async process(sessionId: string): Promise<ProcessedEvent[]> {
    const content = fs.readFileSync(path.join(this.dataDir, `${sessionId}.guac`), 'utf8');
    const instructions = this.parseInstructions(content);

    return [...this.processKeyboardEvents(instructions), ...this.processMouseEvents(instructions)];
  }
}

