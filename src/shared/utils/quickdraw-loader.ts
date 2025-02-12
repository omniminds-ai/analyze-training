import fs from 'fs';
import { ProcessedEvent } from '../types';

interface QuickDrawStroke {
    x: number[];
    y: number[];
    time: number[];
}

interface QuickDrawData {
    drawing: number[][][];  // Changed to match actual format: array of [x[], y[]] strokes
    word: string;
    timestamp: string;
    recognized: boolean;
    key_id: string;
    countrycode: string;
}

const DRAWING_PROMPTS = [
    "Could you draw a {word} for me?",
    "Show me your best {word}!",
    "Let's see your artistic take on a {word}",
    "Draw a {word} in your own style",
    "Time to sketch a {word}!",
    "Can you illustrate a {word} for me?",
    "Your mission: draw a {word}",
    "Let's get creative - draw a {word}",
];

export class QuickDrawLoader {
    private splinePoints: number = 32;  // Increased for smoother curves

    constructor(private startTime: number = 0) {
        // Ensure startTime is an integer
        this.startTime = Math.floor(startTime);
    }

    private resamplePoints(points: Array<{time: number, x: number, y: number}>, numPoints: number): Array<{time: number, x: number, y: number}> {
        if (points.length <= 1) return points;
        
        let totalLength = 0;
        const segments: number[] = [0];
        
        for (let i = 1; i < points.length; i++) {
            const dx = points[i].x - points[i-1].x;
            const dy = points[i].y - points[i-1].y;
            totalLength += Math.sqrt(dx * dx + dy * dy);
            segments.push(totalLength);
        }

        const resampled: Array<{time: number, x: number, y: number}> = [];
        
        for (let i = 0; i < numPoints; i++) {
            const targetLength = (i / (numPoints - 1)) * totalLength;
            
            let segIdx = 1;
            while (segIdx < segments.length && segments[segIdx] < targetLength) {
                segIdx++;
            }
            
            const prevIdx = segIdx - 1;
            const segmentStart = segments[prevIdx];
            const segmentEnd = segments[segIdx];
            const t = (targetLength - segmentStart) / (segmentEnd - segmentStart);
            
            const p0 = points[prevIdx];
            const p1 = points[segIdx];
            
            // Ensure all values are integers
            const x = Math.floor(p0.x + (p1.x - p0.x) * t);
            const y = Math.floor(p0.y + (p1.y - p0.y) * t);
            const time = Math.floor(p0.time + (p1.time - p0.time) * t);
            
            resampled.push({ x, y, time });
        }

        return resampled;
    }

    private normalizeToBox(points: Array<{time: number, x: number, y: number}>, bbox: {x: number, y: number, width: number, height: number}): Array<{time: number, x: number, y: number}> {
        // Find current bounds
        const minX = Math.min(...points.map(p => p.x));
        const maxX = Math.max(...points.map(p => p.x));
        const minY = Math.min(...points.map(p => p.y));
        const maxY = Math.max(...points.map(p => p.y));
        
        const currentWidth = maxX - minX;
        const currentHeight = maxY - minY;
        
        // Calculate scale factors
        const scaleX = bbox.width / currentWidth;
        const scaleY = bbox.height / currentHeight;
        const scale = Math.min(scaleX, scaleY) * 0.8; // 80% of box to leave margin
        
        // Calculate centering offsets
        const scaledWidth = currentWidth * scale;
        const scaledHeight = currentHeight * scale;
        const offsetX = bbox.x + (bbox.width - scaledWidth) / 2;
        const offsetY = bbox.y + (bbox.height - scaledHeight) / 2;
        
        // Transform points and ensure integer coordinates
        return points.map(p => ({
            time: Math.floor(p.time),
            x: Math.floor((p.x - minX) * scale + offsetX),
            y: Math.floor((p.y - minY) * scale + offsetY)
        }));
    }

    processDrawing(drawing: QuickDrawData, bbox: {x: number, y: number, width: number, height: number}, currentTime: number): ProcessedEvent[] {
        const events: ProcessedEvent[] = [];
        
        // Ensure currentTime starts as an integer
        currentTime = Math.floor(currentTime);

        // Add quest prompt
        const promptTemplate = DRAWING_PROMPTS[Math.floor(Math.random() * DRAWING_PROMPTS.length)];
        events.push({
            type: 'quest',
            timestamp: currentTime,
            data: { message: promptTemplate.replace('{word}', drawing.word) }
        });
        currentTime += 1000; // Add 1 second after prompt

        // Process each stroke
        for (let strokeIdx = 0; strokeIdx < drawing.drawing.length; strokeIdx++) {
            const stroke = drawing.drawing[strokeIdx];
            
            // Validate stroke has required arrays (x and y coordinates)
            if (!Array.isArray(stroke) || stroke.length !== 2 || 
                !Array.isArray(stroke[0]) || !Array.isArray(stroke[1]) || 
                stroke[0].length !== stroke[1].length || stroke[0].length < 2) {
                console.warn(`Invalid stroke data at index ${strokeIdx}, skipping`);
                continue;
            }

            const points: Array<{time: number, x: number, y: number}> = [];
            
            // Convert parallel arrays into point objects with absolute timestamps
            const strokeDuration = stroke[0].length * 20; // 20ms per point
            for (let i = 0; i < stroke[0].length; i++) {
                points.push({
                    x: stroke[0][i],
                    y: stroke[1][i],
                    time: Math.floor(currentTime + (i * strokeDuration / stroke[0].length))
                });
            }

            // Scale points to canvas dimensions
            const scaledPoints = points.map(p => ({
                x: Math.floor(bbox.x + (p.x / 255) * bbox.width),
                y: Math.floor(bbox.y + (p.y / 255) * bbox.height),
                time: Math.floor(p.time)
            }));
            
            // Resample points for consistent density
            const resampledPoints = this.resamplePoints(scaledPoints, this.splinePoints);

            // Create mousedrag event for the stroke
            if (resampledPoints.length > 0) {
                const strokeStartTime = Math.floor(currentTime);
                events.push({
                    type: 'mousedrag',
                    timestamp: strokeStartTime,
                    data: {
                        coordinates: resampledPoints.map(p => ({
                            time: Math.floor(p.time - strokeStartTime), // Convert to relative time
                            x: p.x,
                            y: p.y
                        }))
                    }
                });
            }

            // Update time for next stroke
            if (points.length > 0) {
                currentTime = Math.floor(points[points.length - 1].time + 500); // Add 500ms gap between strokes
            }
        }

        return events;
    }

    async loadRandomDrawingFromNDJSON(filePath: string, bbox: {x: number, y: number, width: number, height: number}, currentTime: number): Promise<ProcessedEvent[]> {
        const ndjson = require('ndjson');
        
        return new Promise<ProcessedEvent[]>((resolve, reject) => {
            const drawings: QuickDrawData[] = [];
            
            // Read all drawings first to filter for recognized ones
            fs.createReadStream(filePath)
                .pipe(ndjson.parse())
                .on('data', (obj: QuickDrawData) => {
                    if (obj.recognized) {  // Only include recognized drawings
                        drawings.push(obj);
                    }
                })
                .on('error', reject)
                .on('end', () => {
                    if (drawings.length === 0) {
                        reject(new Error('No recognized drawings found'));
                        return;
                    }
                    
                    // Pick a random recognized drawing
                    const selectedDrawing = drawings[Math.floor(Math.random() * drawings.length)];
                    const events = this.processDrawing(selectedDrawing, bbox, Math.floor(currentTime));
                    resolve(events);
                });
        });
    }
}
